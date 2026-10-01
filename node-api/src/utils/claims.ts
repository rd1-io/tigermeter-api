import { PrismaClient } from '@prisma/client';
import { FastifyRequest } from 'fastify';
import { createHash } from 'crypto';
import { config } from '../config.js';

// Attach is limited per service token: integrator and admin requests all come from one backend/IP
export const attachRateLimitKey = (request: FastifyRequest) => {
  const auth = request.headers['authorization'] ?? '';
  return 'attach:' + createHash('sha256').update(auth).digest('hex');
};

export type AttachClaimResult =
  | { ok: true; deviceId: string; tenantId: string }
  | { ok: false; status: 400 | 409; message: string };

// Shared by the tenant attach (manage token, own tenant) and the admin attach (ops token, chosen tenant)
export const attachClaim = async (
  prisma: PrismaClient,
  params: { code: string; tenantId: string; externalUserId: string | null },
): Promise<AttachClaimResult> => {
  if (params.tenantId === config.stagingTenantId) {
    return { ok: false, status: 400, message: 'Tenant is reserved' };
  }

  const claim = await prisma.deviceClaim.findUnique({ where: { code: params.code } });
  if (!claim) return { ok: false, status: 400, message: 'Invalid code' };
  if (claim.expiresAt < new Date()) return { ok: false, status: 400, message: 'Expired code' };
  if (claim.status === 'claimed') return { ok: false, status: 409, message: 'Already claimed' };

  // Conditional update so two concurrent attaches can't both bind the device
  const marked = await prisma.deviceClaim.updateMany({
    where: { code: params.code, status: { not: 'claimed' } },
    data: { status: 'claimed' },
  });
  if (marked.count === 0) return { ok: false, status: 409, message: 'Already claimed' };

  // No welcome instruction — display stays empty until first PUT /display
  await prisma.device.update({
    where: { id: claim.deviceId },
    data: {
      tenantId: params.tenantId,
      externalUserId: params.externalUserId,
      status: 'active',
    },
  });

  return { ok: true, deviceId: claim.deviceId, tenantId: params.tenantId };
};

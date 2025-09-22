import { FastifyInstance } from 'fastify';
import { addSeconds } from 'date-fns';
import { config } from '../config.js';
import { generateDeviceSecret, hashPassword, normalizeMac, verifyClaimHmac } from '../utils/crypto.js';

// Helper to generate a 6-digit code with leading zeros preserved
const generateCode = () => String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');

export default async function deviceClaimsRoutes(app: FastifyInstance) {
  // Issue claim code (unauthenticated, protected by future HMAC validation TODO)
  // TODO: add rate limiting (per IP/MAC) to mitigate brute force
  app.post('/device-claims', {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const body = (request.body as any) || {};
    const rawMac = body.mac as string | undefined;
    if (!rawMac) return reply.code(400).send({ message: 'mac required' });
    const mac = normalizeMac(rawMac);
    if (!mac) {
      return reply.code(400).send({ message: 'invalid mac format' });
    }
    const firmwareVersion = body.firmwareVersion as string | undefined;
    const hmac = body.hmac as string | undefined;
    const timestamp = body.timestamp as number | undefined;
    const ip = body.ip as string | undefined;

    // Verify HMAC to prove device ownership
    if (!hmac || !timestamp) {
      return reply.code(400).send({ message: 'hmac and timestamp required' });
    }
    if (!verifyClaimHmac(mac, hmac, firmwareVersion, timestamp)) {
      return reply.code(401).send({ message: 'invalid hmac' });
    }

    // Device must already exist and be in awaiting_claim state
  const device = await app.prisma.device.findFirst({ where: { mac } });
    if (!device) return reply.code(404).send({ message: 'device not found' });
    if (device.status !== 'awaiting_claim') {
      return reply.code(409).send({ message: 'device not in awaiting_claim' });
    }

    const code = generateCode();
    const expiresAt = addSeconds(new Date(), config.claimCodeTtlSeconds);

    await app.prisma.deviceClaim.create({
      data: {
        code,
        deviceId: device.id,
        mac,
        firmwareVersion,
        ip,
        expiresAt,
      },
    });

    return reply.code(201).send({ code, expiresAt });
  });

  // Attach claim code to authenticated user
  // TODO: enforce max devices per user / abuse controls
  app.post('/device-claims/:code/attach', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const user = await app.requireUser(request);
    const userId = (user as any).sub ?? (user as any).userId ?? 'user';
    const { code } = request.params as any;
    const claim = await app.prisma.deviceClaim.findUnique({ where: { code } });
    if (!claim) return reply.code(400).send({ message: 'Invalid code' });
    if (claim.expiresAt < new Date()) return reply.code(400).send({ message: 'Expired code' });
    if (claim.status === 'claimed') return reply.code(409).send({ message: 'Already claimed' });

    // Bind user & mark claimed
    await app.prisma.deviceClaim.update({ where: { code }, data: { status: 'claimed', userId } });
    await app.prisma.device.update({ where: { id: claim.deviceId }, data: { userId, status: 'active' } });

    return { deviceId: claim.deviceId, message: 'Attached' };
  });

  // Poll claim status (unauthenticated, device side)
  // TODO: add minimal polling backoff headers (e.g. Retry-After) when 202
  app.get('/device-claims/:code/poll', {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const { code } = request.params as any;
    const claim = await app.prisma.deviceClaim.findUnique({ where: { code } });
    if (!claim) return reply.code(404).send({ message: 'Not found' });
    if (claim.expiresAt < new Date()) return reply.code(410).send({ message: 'Expired' });
    if (claim.status !== 'claimed') return reply.code(202).send({ status: claim.status });
    if (claim.secretIssued) return reply.code(404).send({ message: 'Not found' });

    // Lazy secret generation (one-time reveal)
    const device = await app.prisma.device.findUnique({ where: { id: claim.deviceId } });
    if (!device) return reply.code(404).send({ message: 'Not found' });

    const plaintext = generateDeviceSecret();
    const hashed = await hashPassword(plaintext);
    const expiresAt = addSeconds(new Date(), config.deviceSecretTtlDays * 24 * 3600);

    await app.prisma.device.update({
      where: { id: device.id },
      data: {
        currentSecretHash: hashed,
        currentSecretExpiresAt: expiresAt,
      },
    });
    await app.prisma.deviceClaim.update({ where: { code }, data: { secretIssued: true } });

    return {
      deviceId: device.id,
      deviceSecret: plaintext,
      displayHash: device.displayHash ?? '',
      expiresAt,
    };
  });
}

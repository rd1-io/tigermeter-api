import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { addSeconds } from 'date-fns';
import { randomInt } from 'crypto';
import { config } from '../config.js';
import { attachClaim, attachRateLimitKey } from '../utils/claims.js';
import { generateDeviceSecret, hashPassword, normalizeMac, verifyClaimHmac } from '../utils/crypto.js';
import { AUTO_UPGRADE_SETTING, getBoolSetting, parseFirmwareVersion } from '../utils/firmware.js';

// Helper to generate a 6-digit code with leading zeros preserved
const generateCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

const CODE_GENERATION_ATTEMPTS = 10;

const AttachBody = z.object({
  externalUserId: z.string().min(1).max(128),
});

// HMACs accepted within the tolerance window; a repeated one is a replayed request.
// In-memory is enough while the API runs as a single instance.
const usedClaimHmacs = new Map<string, number>();

const markClaimHmacUsed = (hmac: string, now: number): boolean => {
  for (const [key, expiresAt] of usedClaimHmacs) {
    if (expiresAt <= now) usedClaimHmacs.delete(key);
  }
  const key = hmac.toLowerCase();
  if (usedClaimHmacs.has(key)) return false;
  usedClaimHmacs.set(key, now + config.claimHmacToleranceMs);
  return true;
};

const isUniqueViolation = (err: unknown) => (err as any)?.code === 'P2002';

// Polls are limited per code so devices behind one NAT IP don't share a budget; guessing
// codes is limited separately by counting unknown codes per IP.
const pollRateLimitKey = (request: FastifyRequest) => 'poll:' + String((request.params as any)?.code ?? '');

const unknownCodePolls = new Map<string, { count: number; resetAt: number }>();

const unknownCodeBudgetExceeded = (ip: string, now: number): boolean => {
  const entry = unknownCodePolls.get(ip);
  return !!entry && entry.resetAt > now && entry.count >= config.pollUnknownCodesPerIpPerMinute;
};

const recordUnknownCodePoll = (ip: string, now: number) => {
  for (const [key, entry] of unknownCodePolls) {
    if (entry.resetAt <= now) unknownCodePolls.delete(key);
  }
  const entry = unknownCodePolls.get(ip);
  if (entry) entry.count++;
  else unknownCodePolls.set(ip, { count: 1, resetAt: now + 60_000 });
};

export interface DeviceClaimsRoutesOptions {
  // Legacy prefix serves only what old firmware calls (issue + poll)
  deviceOnly?: boolean;
}

export default async function deviceClaimsRoutes(app: FastifyInstance, opts: DeviceClaimsRoutesOptions = {}) {
  const perMacClaimLimit = app.createRateLimit({
    max: config.claimRateLimitPerMacPerMinute,
    timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest) => 'claim-mac:' + normalizeMac(String((req.body as any)?.mac ?? '')),
  });

  // Codes are primary keys and claims are kept after use, so a fresh code can collide
  // with an old row: expired rows are recycled, live ones force another attempt.
  const createClaim = async (data: { deviceId: string; mac: string; firmwareVersion?: string; ip?: string }) => {
    for (let attempt = 0; attempt < CODE_GENERATION_ATTEMPTS; attempt++) {
      const code = generateCode();
      const now = new Date();
      const existing = await app.prisma.deviceClaim.findUnique({ where: { code } });
      if (existing && existing.expiresAt >= now) continue;
      if (existing) await app.prisma.deviceClaim.deleteMany({ where: { code, expiresAt: { lt: now } } });
      const expiresAt = addSeconds(now, config.claimCodeTtlSeconds);
      try {
        await app.prisma.deviceClaim.create({ data: { code, expiresAt, ...data } });
        return { code, expiresAt };
      } catch (err) {
        if (isUniqueViolation(err)) continue;
        throw err;
      }
    }
    throw (app as any).httpErrors.serviceUnavailable('Could not allocate claim code, retry later');
  };

  // --- ISSUE claim code (device, HMAC auth) ---
  app.post('/device-claims', {
    config: {
      rateLimit: {
        max: config.claimRateLimitPerIpPerMinute,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const body = (request.body as any) || {};
    const rawMac = body.mac as string | undefined;
    if (!rawMac) return reply.code(400).send({ message: 'mac required' });
    const mac = normalizeMac(rawMac);
    if (!mac) return reply.code(400).send({ message: 'invalid mac format' });

    const macLimit = await perMacClaimLimit(request);
    if (!macLimit.isAllowed && macLimit.isExceeded) {
      reply.header('retry-after', macLimit.ttlInSeconds);
      return reply.code(429).send({ message: 'Rate limit exceeded, retry later' });
    }

    const firmwareVersion = body.firmwareVersion as string | undefined;
    const hmac = body.hmac as string | undefined;
    const timestamp = body.timestamp as number | undefined;
    const ip = body.ip as string | undefined;

    if (!hmac || !timestamp) {
      return reply.code(400).send({ message: 'hmac and timestamp required' });
    }
    const now = Date.now();
    const hmacCheck = verifyClaimHmac(mac, hmac, firmwareVersion, timestamp, now);
    if (!hmacCheck.ok) {
      return reply.code(401).send({ message: hmacCheck.message });
    }
    if (!markClaimHmacUsed(hmac, now)) {
      return reply.code(401).send({ message: 'hmac already used' });
    }
    if (hmacCheck.legacyTimestamp) {
      request.log.warn({ mac, firmwareVersion }, 'claim signed with legacy uptime timestamp');
    }

    // Outdated firmware on a device no real tenant owns is parked on the staging tenant, so it
    // heartbeats, receives latestFirmwareVersion and updates itself over OTA.
    let device = await app.prisma.device.findFirst({ where: { mac } });
    const reportedVersion = parseFirmwareVersion(firmwareVersion);
    const autoUpgrade =
      reportedVersion !== null &&
      reportedVersion < config.latestFirmwareVersion &&
      (!device || !device.tenantId || device.tenantId === config.stagingTenantId) &&
      (await getBoolSetting(app.prisma, AUTO_UPGRADE_SETTING));

    // Device must already exist and be in awaiting_claim state
    if (!device) {
      const autoProvision = await getBoolSetting(app.prisma, 'autoProvisionNewDevices');
      if (autoProvision || autoUpgrade) {
        device = await app.prisma.device.create({
          data: {
            mac,
            status: 'awaiting_claim',
            firmwareVersion: firmwareVersion || 'unknown',
            ip: ip ?? undefined,
          },
        });
        try {
          await app.prisma.pendingDevice.updateMany({
            where: { mac, status: 'pending' },
            data: { status: 'approved' },
          });
        } catch (_) {}
      } else {
        // Log as pending for admin approval
        try {
          const existing = await app.prisma.pendingDevice.findUnique({ where: { mac } });
          if (existing) {
            await app.prisma.pendingDevice.update({
              where: { mac },
              data: {
                lastSeen: new Date(),
                attemptCount: { increment: 1 },
                ip: ip || existing.ip,
                firmwareVersion: firmwareVersion || existing.firmwareVersion,
                status: 'pending',
              },
            });
          } else {
            await app.prisma.pendingDevice.create({ data: { mac, firmwareVersion, ip } });
          }
        } catch {}
        return reply.code(404).send({ message: 'device not found' });
      }
    }

    if (device.status !== 'awaiting_claim') {
      await app.prisma.device.update({
        where: { id: device.id },
        data: { status: 'awaiting_claim', tenantId: null, externalUserId: null },
      });
    }

    // A device only polls its latest code, so earlier unattached codes are dead weight
    await app.prisma.deviceClaim.deleteMany({ where: { deviceId: device.id, status: 'pending' } });

    const { code, expiresAt } = await createClaim({ deviceId: device.id, mac, firmwareVersion, ip });

    if (autoUpgrade) {
      await app.prisma.deviceClaim.update({ where: { code }, data: { status: 'claimed' } });
      await app.prisma.device.update({
        where: { id: device.id },
        data: {
          tenantId: config.stagingTenantId,
          externalUserId: null,
          status: 'active',
          autoUpdate: true,
          demoMode: false,
          firmwareVersion: firmwareVersion ?? device.firmwareVersion,
          displayFramesJson: null,
          displayHash: null,
        },
      });
      request.log.info(
        { deviceId: device.id, mac, firmwareVersion, latestFirmwareVersion: config.latestFirmwareVersion },
        'auto-upgrade: outdated device attached to staging tenant for OTA',
      );
    }

    return reply.code(201).send({ code, expiresAt });
  });

  // --- ATTACH claim code (tenant service token, replaces old user-JWT attach) ---
  if (!opts.deviceOnly) app.post('/device-claims/:code/attach', {
    config: {
      rateLimit: {
        max: config.attachRateLimitPerMinute,
        timeWindow: '1 minute',
        keyGenerator: attachRateLimitKey,
      },
    },
  }, async (request, reply) => {
    const auth = await app.requireScope(request, 'manage');
    const { code } = request.params as any;
    const body = AttachBody.parse(request.body ?? {});

    const result = await attachClaim(app.prisma, {
      code: String(code),
      tenantId: auth.tenantId,
      externalUserId: body.externalUserId,
    });
    if (!result.ok) return reply.code(result.status).send({ message: result.message });
    return { deviceId: result.deviceId, message: 'Attached', tenantId: result.tenantId };
  });

  // --- POLL claim status (device side, HMAC auth still via future TODO) ---
  app.get('/device-claims/:code/poll', {
    config: {
      rateLimit: {
        max: config.pollRateLimitPerCodePerMinute,
        timeWindow: '1 minute',
        keyGenerator: pollRateLimitKey,
      },
    },
  }, async (request, reply) => {
    const { code } = request.params as any;
    const now = Date.now();
    if (unknownCodeBudgetExceeded(request.ip, now)) {
      return reply.code(429).send({ message: 'Too many unknown claim codes, retry later' });
    }
    const claim = await app.prisma.deviceClaim.findUnique({ where: { code } });
    if (!claim) {
      recordUnknownCodePoll(request.ip, now);
      return reply.code(404).send({ message: 'Not found' });
    }
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
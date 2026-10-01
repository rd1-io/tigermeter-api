import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addSeconds } from 'date-fns';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { generateDeviceSecret, hashPassword } from '../utils/crypto.js';
import { parseFirmwareVersion } from '../utils/firmware.js';
import { DISPLAY_REBOOT_LIMIT } from '../utils/display.js';
import { findFrameByHash, frameToServe, parsePayload } from '../utils/rotation.js';

const HeartbeatSchema = z.object({
  battery: z.number().int().optional(),
  rssi: z.number().int().optional(),
  ip: z.string().optional(),
  firmwareVersion: z.string().optional(),
  uptimeSeconds: z.number().int().optional(),
  displayHash: z.string().optional(),
  // Firmware v38+: boot/heap diagnostics; never rejects the heartbeat, sanitized by sanitizeDiagnostics()
  diag: z.unknown().optional(),
});

// Keep up to 24 flat primitive fields, strings capped, so a bad diag can't bloat the row
const sanitizeDiagnostics = (diag: unknown): Record<string, string | number | boolean> | null => {
  if (!diag || typeof diag !== 'object' || Array.isArray(diag)) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(diag as Record<string, unknown>).slice(0, 24)) {
    if (k.length > 32) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 120);
    else if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') out[k] = v;
  }
  return Object.keys(out).length ? out : null;
};

export interface DeviceRoutesOptions {
  // Legacy prefix serves only what old firmware calls (heartbeat)
  deviceOnly?: boolean;
}

export default async function deviceRoutes(app: FastifyInstance, opts: DeviceRoutesOptions = {}) {
  // Simple device-secret authorization (unchanged)
  app.decorate('requireDevice', async (id: string, authorization?: string) => {
    if (!authorization?.startsWith('Bearer ')) throw (app as any).httpErrors.unauthorized('Missing device secret');
    const token = authorization.slice('Bearer '.length);
    const device = await app.prisma.device.findUnique({ where: { id } });
    if (!device) throw (app as any).httpErrors.notFound('Device not found');
    // Verify against current or previous hash within expiry
    const now = new Date();
    const ok = await bcrypt.compare(token, device.currentSecretHash ?? '')
      .catch(() => false)
      .then(Boolean);
    const okPrev = await bcrypt.compare(token, device.previousSecretHash ?? '')
      .catch(() => false)
      .then(Boolean);
    const validCurrent = ok && !!device.currentSecretExpiresAt && device.currentSecretExpiresAt > now;
    const validPrev = okPrev && !!device.previousSecretExpiresAt && device.previousSecretExpiresAt > now;
    if (!validCurrent && !validPrev) throw (app as any).httpErrors.unauthorized('Invalid or expired secret');
    if (device.status === 'revoked') throw (app as any).httpErrors.forbidden('Device revoked');
    return device;
  });

  // --- HEARTBEAT ---
  // Keyed per device: a whole fleet can heartbeat from one NAT IP
  app.post('/devices/:id/heartbeat', {
    config: {
      rateLimit: {
        max: config.heartbeatRateLimitPerDevicePerMinute,
        timeWindow: '1 minute',
        keyGenerator: (req) => 'hb:' + String((req.params as any)?.id ?? ''),
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as any;
    const device = await app.requireDevice(id, request.headers['authorization']);
    const body = HeartbeatSchema.parse(request.body ?? {});

    // Check for pending factory reset
    if (device.pendingFactoryReset) {
      await app.prisma.device.update({
        where: { id: device.id },
        data: {
          pendingFactoryReset: false,
          lastSeen: new Date(),
        },
      });
      return { factoryReset: true };
    }

    // A staging device that reached the latest firmware is released: 401 makes the firmware
    // drop only its device credentials (WiFi stays) and show a claim code for a customer.
    const reportedVersion = parseFirmwareVersion(body.firmwareVersion);
    if (
      device.tenantId === config.stagingTenantId &&
      reportedVersion !== null &&
      reportedVersion >= config.latestFirmwareVersion
    ) {
      await app.prisma.deviceClaim.deleteMany({ where: { deviceId: device.id, status: 'pending' } });
      await app.prisma.device.update({
        where: { id: device.id },
        data: {
          tenantId: null,
          externalUserId: null,
          status: 'awaiting_claim',
          lastSeen: new Date(),
          battery: body.battery ?? device.battery,
          rssi: body.rssi ?? device.rssi,
          ip: body.ip ?? device.ip,
          firmwareVersion: body.firmwareVersion,
          displayFramesJson: null,
          displayHash: null,
          currentSecretHash: null,
          currentSecretExpiresAt: null,
          previousSecretHash: null,
          previousSecretExpiresAt: null,
        },
      });
      request.log.info(
        { deviceId: device.id, mac: device.mac, firmwareVersion: body.firmwareVersion },
        'auto-upgrade: device updated, released from staging tenant',
      );
      return reply.code(401).send({ message: 'Firmware updated, claim the device again' });
    }

    // The device always holds one frame: rotation over the stored set runs here (utils/rotation.ts).
    // A heartbeat whose hash is any delivery of the frame that is current now changes nothing.
    const now = new Date();
    const payload = parsePayload(device.displayFramesJson);
    const setHash = payload ? device.displayHash : null;
    const cycleStartMs = device.displayUpdatedAt?.getTime() ?? 0;
    const serve = setHash && payload ? frameToServe(setHash, payload, cycleStartMs, now.getTime(), device.displayOneShotMask) : null;
    const reportedFrame = findFrameByHash(setHash, payload, body.displayHash);
    const hashMatches = !!serve && !!reportedFrame && reportedFrame.index === serve.index;

    const fwVersion = parseFirmwareVersion(body.firmwareVersion ?? device.firmwareVersion);
    const framesSupported = fwVersion === null || fwVersion >= config.minFramesFirmwareVersion;

    // The device rebooted after a frame was delivered and before confirming it (uptime is shorter
    // than the time since delivery): count it, and stop serving at the limit
    const deliveredFrame = findFrameByHash(setHash, payload, device.deliveredDisplayHash);
    const rebootedAfterDelivery =
      !reportedFrame &&
      device.displayRebootCount < DISPLAY_REBOOT_LIMIT &&
      !!deliveredFrame &&
      device.reportedDisplayHash !== device.deliveredDisplayHash &&
      !!device.displayDeliveredAt &&
      typeof body.uptimeSeconds === 'number' &&
      body.uptimeSeconds * 1000 < now.getTime() - device.displayDeliveredAt.getTime();
    const displayRebootCount = reportedFrame ? 0 : device.displayRebootCount + (rebootedAfterDelivery ? 1 : 0);
    const displayBlocked = displayRebootCount >= DISPLAY_REBOOT_LIMIT;
    const servesFrames = !!serve && !hashMatches && !displayBlocked && framesSupported;
    const diagnostics = sanitizeDiagnostics(body.diag);
    if (rebootedAfterDelivery) {
      request.log.warn(
        { deviceId: device.id, mac: device.mac, displayHash: device.displayHash, frameIndex: deliveredFrame?.index, displayRebootCount, blocked: displayBlocked, diag: diagnostics },
        'device rebooted after receiving frames without confirming them',
      );
    }

    // Update telemetry; the reported hash only changes on the heartbeat after a delivery,
    // since the device sends the hash of what it shows when the request starts
    await app.prisma.device.update({
      where: { id: device.id },
      data: {
        lastSeen: now,
        battery: body.battery ?? device.battery,
        rssi: body.rssi ?? device.rssi,
        ip: body.ip ?? device.ip,
        firmwareVersion: body.firmwareVersion ?? device.firmwareVersion,
        uptimeSeconds: body.uptimeSeconds ?? device.uptimeSeconds,
        reportedDisplayHash: body.displayHash || null,
        displayRebootCount,
        ...(diagnostics ? { diagnosticsJson: JSON.stringify(diagnostics) } : {}),
        ...(servesFrames
          ? { deliveredDisplayHash: serve!.hash, displayDeliveredAt: now, displayOneShotMask: serve!.oneShotMask }
          : {}),
      },
    });

    // Base response with OTA info
    const baseResponse = {
      ok: true,
      autoUpdate: device.autoUpdate,
      demoMode: device.demoMode,
      latestFirmwareVersion: config.latestFirmwareVersion,
      firmwareDownloadUrl: config.firmwareDownloadUrl,
    };

    if (hashMatches) return baseResponse;

    if (servesFrames) {
      return {
        ...baseResponse,
        frames: [serve!.frame],
        refreshInterval: serve!.refreshInterval,
        displayHash: serve!.hash,
      };
    }

    // No frames yet (or not deliverable) — empty state
    return {
      ...baseResponse,
      frames: [],
      refreshInterval: 60,
      displayHash: null,
    };
  });

  if (opts.deviceOnly) return;

  // --- GET display hash ---
  app.get('/devices/:id/display/hash', async (request, reply) => {
    const { id } = request.params as any;
    const device = await app.requireDevice(id, request.headers['authorization']);
    return { hash: device.displayHash ?? '' };
  });

  // --- GET display full (unchanged, useful for debug) ---
  app.get('/devices/:id/display/full', async (request, reply) => {
    const { id } = request.params as any;
    const device = await app.requireDevice(id, request.headers['authorization']);
    const ifHash = (request.query as any)?.ifHash as string | undefined;
    if (!device.displayFramesJson) return reply.code(404).send({ message: 'Not found' });
    if (ifHash && device.displayHash && ifHash === device.displayHash) return reply.code(304).send();
    return JSON.parse(device.displayFramesJson);
  });

  // --- REFRESH secret ---
  app.post('/devices/:id/secret/refresh', async (request, reply) => {
    const { id } = request.params as any;
    const device = await app.requireDevice(id, request.headers['authorization']);

    const plaintext = generateDeviceSecret();
    const hashed = await hashPassword(plaintext);
    const expiresAt = addSeconds(new Date(), config.deviceSecretTtlDays * 24 * 3600);

    await app.prisma.device.update({
      where: { id: device.id },
      data: {
        previousSecretHash: device.currentSecretHash,
        previousSecretExpiresAt: device.currentSecretExpiresAt,
        currentSecretHash: hashed,
        currentSecretExpiresAt: expiresAt,
      },
    });

    return { deviceId: device.id, deviceSecret: plaintext, displayHash: device.displayHash ?? '', expiresAt };
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    requireDevice(id: string, authorization?: string): Promise<any>;
  }
}
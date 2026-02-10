import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addSeconds } from 'date-fns';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { generateDeviceSecret, hashPassword } from '../utils/crypto.js';

const HeartbeatSchema = z.object({
  battery: z.number().int().optional(),
  rssi: z.number().int().optional(),
  ip: z.string().optional(),
  firmwareVersion: z.string().optional(),
  uptimeSeconds: z.number().int().optional(),
  displayHash: z.string().optional(),
});

export default async function deviceRoutes(app: FastifyInstance) {
  // Simple device-secret authorization
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

  app.post('/devices/:id/heartbeat', async (request, reply) => {
    const { id } = request.params as any;
    const device = await app.requireDevice(id, request.headers['authorization']);
    const body = HeartbeatSchema.parse(request.body ?? {});

    // Check for pending factory reset
    if (device.pendingFactoryReset) {
      // Clear the flag and return reset command
      await app.prisma.device.update({
        where: { id: device.id },
        data: {
          pendingFactoryReset: false,
          lastSeen: new Date(),
        },
      });
      return { factoryReset: true };
    }

    // update telemetry
    await app.prisma.device.update({
      where: { id: device.id },
      data: {
        lastSeen: new Date(),
        battery: body.battery ?? device.battery,
        rssi: body.rssi ?? device.rssi,
        ip: body.ip ?? device.ip,
        firmwareVersion: body.firmwareVersion ?? device.firmwareVersion,
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

    if (body.displayHash && device.displayHash && body.displayHash === device.displayHash) {
      return baseResponse;
    }

    if (device.displayInstructionJson && device.displayHash) {
      const instruction = JSON.parse(device.displayInstructionJson);
      
      // Clear one-time actions after sending (so they don't repeat on reboot)
      if (instruction.beep || instruction.flashCount) {
        const cleanedInstruction = { ...instruction };
        delete cleanedInstruction.beep;
        delete cleanedInstruction.flashCount;
        
        // Update DB without changing hash (so device doesn't see it as "new")
        await app.prisma.device.update({
          where: { id: device.id },
          data: { displayInstructionJson: JSON.stringify(cleanedInstruction) }
        });
      }
      
      return { 
        ...baseResponse,
        instruction, 
        displayHash: device.displayHash 
      };
    }

    return baseResponse;
  });

  app.get('/devices/:id/display/hash', async (request, reply) => {
    const { id } = request.params as any;
    const device = await app.requireDevice(id, request.headers['authorization']);
    return { hash: device.displayHash ?? '' };
  });

  app.get('/devices/:id/display/full', async (request, reply) => {
    const { id } = request.params as any;
    const device = await app.requireDevice(id, request.headers['authorization']);
    const ifHash = (request.query as any)?.ifHash as string | undefined;
    if (!device.displayInstructionJson) return reply.code(404).send({ message: 'Not found' });
    if (ifHash && device.displayHash && ifHash === device.displayHash) return reply.code(304).send();
    return JSON.parse(device.displayInstructionJson);
  });

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









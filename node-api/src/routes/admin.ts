import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const DeviceSettingsSchema = z.object({
  autoUpdate: z.boolean().optional(),
  demoMode: z.boolean().optional(),
});

const AdminSettingsSchema = z.object({
  autoProvisionNewDevices: z.boolean().optional(),
});

const ApproveBody = z.object({
  tenantId: z.string().min(1).max(64),
});

export default async function adminRoutes(app: FastifyInstance) {
  // --- LIST all devices (ops only) ---
  app.get('/devices', async (request) => {
    await app.requireScope(request, 'ops');
    const { tenantId, status, lastSeenBefore, lastSeenAfter } = request.query as any;
    let where: any = {};
    if (tenantId) where.tenantId = tenantId;
    if (status) where.status = status;
    if (lastSeenBefore) where.lastSeen = { lt: new Date(lastSeenBefore) };
    if (lastSeenAfter) where.lastSeen = { ...(where.lastSeen ?? {}), gt: new Date(lastSeenAfter) };
    const devices = await app.prisma.device.findMany({ where });
    return devices.map((d: any) => ({
      id: d.id,
      mac: d.mac,
      name: d.name,
      tenantId: d.tenantId,
      externalUserId: d.externalUserId,
      status: d.status,
      lastSeen: d.lastSeen,
      battery: d.battery,
      rssi: d.rssi,
      firmwareVersion: d.firmwareVersion,
      autoUpdate: d.autoUpdate,
      demoMode: d.demoMode,
      displayHash: d.displayHash,
      displayVersion: d.displayVersion,
      deviceSecretHash: d.currentSecretHash,
      createdAt: d.createdAt,
    }));
  });

  // --- GET device display frames (ops only, for debugging) ---
  app.get('/devices/:id/display', async (request, reply) => {
    await app.requireScope(request, 'ops');
    const { id } = request.params as any;
    const d = await app.prisma.device.findUnique({ where: { id } });
    if (!d) return reply.code(404).send({ message: 'Not found' });
    if (!d.displayFramesJson) return reply.code(404).send({ message: 'No frames' });
    return JSON.parse(d.displayFramesJson);
  });

  // --- REVOKE ---
  app.post('/devices/:id/revoke', async (request, reply) => {
    await app.requireScope(request, 'ops');
    const { id } = request.params as any;
    const d = await app.prisma.device.findUnique({ where: { id } });
    if (!d) return reply.code(404).send({ message: 'Not found' });
    await app.prisma.device.update({
      where: { id },
      data: {
        status: 'revoked',
        displayFramesJson: null,
        displayHash: null,
        currentSecretHash: null,
        currentSecretExpiresAt: null,
        previousSecretHash: null,
        previousSecretExpiresAt: null,
      },
    });
    return { status: 'revoked' };
  });

  // --- DELETE ---
  app.delete('/devices/:id', async (request, reply) => {
    await app.requireScope(request, 'ops');
    const { id } = request.params as any;
    const d = await app.prisma.device.findUnique({ where: { id } });
    if (!d) return reply.code(404).send({ message: 'Not found' });
    await app.prisma.deviceClaim.deleteMany({ where: { deviceId: id } });
    await app.prisma.device.delete({ where: { id } });
    return { deleted: true };
  });

  // --- FACTORY RESET ---
  app.post('/devices/:id/factory-reset', async (request, reply) => {
    await app.requireScope(request, 'ops');
    const { id } = request.params as any;
    const d = await app.prisma.device.findUnique({ where: { id } });
    if (!d) return reply.code(404).send({ message: 'Not found' });
    if (d.status !== 'active') {
      return reply.code(400).send({ message: 'Device must be active to queue factory reset' });
    }
    await app.prisma.device.update({
      where: { id },
      data: {
        pendingFactoryReset: true,
        status: 'awaiting_claim',
        tenantId: null,
        externalUserId: null,
        displayFramesJson: null,
        displayHash: null,
        currentSecretHash: null,
        currentSecretExpiresAt: null,
        previousSecretHash: null,
        previousSecretExpiresAt: null,
      },
    });
    return { queued: true };
  });

  // --- UPDATE device settings ---
  app.patch('/devices/:id/settings', async (request, reply) => {
    await app.requireScope(request, 'ops');
    const { id } = request.params as any;
    const body = DeviceSettingsSchema.parse(request.body ?? {});
    const d = await app.prisma.device.findUnique({ where: { id } });
    if (!d) return reply.code(404).send({ message: 'Not found' });

    const updateData: any = {};
    if (body.autoUpdate !== undefined) updateData.autoUpdate = body.autoUpdate;
    if (body.demoMode !== undefined) updateData.demoMode = body.demoMode;

    if (Object.keys(updateData).length === 0) {
      return reply.code(400).send({ message: 'No settings to update' });
    }

    const updated = await app.prisma.device.update({ where: { id }, data: updateData });
    return { id: updated.id, autoUpdate: updated.autoUpdate, demoMode: updated.demoMode };
  });

  // --- ADMIN SETTINGS ---
  app.get('/settings', async (request) => {
    await app.requireScope(request, 'ops');
    const setting = await app.prisma.setting.findUnique({ where: { key: 'autoProvisionNewDevices' } });
    return { autoProvisionNewDevices: setting?.value === 'true' };
  });

  app.patch('/settings', async (request, reply) => {
    await app.requireScope(request, 'ops');
    const body = AdminSettingsSchema.parse(request.body ?? {});
    if (body.autoProvisionNewDevices !== undefined) {
      await app.prisma.setting.upsert({
        where: { key: 'autoProvisionNewDevices' },
        create: { key: 'autoProvisionNewDevices', value: body.autoProvisionNewDevices ? 'true' : 'false' },
        update: { value: body.autoProvisionNewDevices ? 'true' : 'false' },
      });
      // When enabling, auto-approve all currently pending devices
      if (body.autoProvisionNewDevices) {
        const pending = await app.prisma.pendingDevice.findMany({ where: { status: 'pending' } });
        for (const pd of pending) {
          const exists = await app.prisma.device.findUnique({ where: { mac: pd.mac } });
          if (!exists) {
            await app.prisma.device.create({
              data: {
                mac: pd.mac,
                status: 'awaiting_claim',
                firmwareVersion: pd.firmwareVersion || 'unknown',
                ip: pd.ip,
              },
            });
          }
          await app.prisma.pendingDevice.update({
            where: { id: pd.id },
            data: { status: 'approved' },
          });
        }
      }
    }
    const setting = await app.prisma.setting.findUnique({ where: { key: 'autoProvisionNewDevices' } });
    return { autoProvisionNewDevices: setting?.value === 'true' };
  });

  // --- PENDING DEVICES ---
  app.get('/pending-devices', async (request) => {
    await app.requireScope(request, 'ops');
    const devices = await app.prisma.pendingDevice.findMany({
      where: { status: 'pending' },
      orderBy: { lastSeen: 'desc' },
    });
    return devices;
  });

  // --- APPROVE pending device (with tenant assignment) ---
  app.post('/pending-devices/:id/approve', async (request, reply) => {
    await app.requireScope(request, 'ops');
    const { id } = request.params as any;
    const body = ApproveBody.parse(request.body ?? {});

    const pending = await app.prisma.pendingDevice.findUnique({ where: { id } });
    if (!pending) return reply.code(404).send({ message: 'Not found' });
    if (pending.status !== 'pending') {
      return reply.code(409).send({ message: 'Already processed' });
    }

    const device = await app.prisma.device.create({
      data: {
        mac: pending.mac,
        tenantId: body.tenantId,
        status: 'awaiting_claim',
        firmwareVersion: pending.firmwareVersion || 'unknown',
        ip: pending.ip,
      },
    });

    await app.prisma.pendingDevice.update({
      where: { id },
      data: { status: 'approved' },
    });

    return { device: { id: device.id, mac: device.mac, tenantId: device.tenantId } };
  });

  // --- REJECT pending device ---
  app.post('/pending-devices/:id/reject', async (request, reply) => {
    await app.requireScope(request, 'ops');
    const { id } = request.params as any;
    await app.prisma.pendingDevice.update({
      where: { id },
      data: { status: 'rejected' },
    });
    return { status: 'rejected' };
  });
}
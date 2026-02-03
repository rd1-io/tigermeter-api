import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const DeviceSettingsSchema = z.object({
  autoUpdate: z.boolean().optional(),
  demoMode: z.boolean().optional(),
});

export default async function adminRoutes(app: FastifyInstance) {
  app.get('/devices', async (request) => {
    await app.requireAdmin(request);
    const { userId, status, lastSeenBefore, lastSeenAfter } = request.query as any;
    let where: any = {};
    if (userId) where.userId = userId;
    if (status) where.status = status;
    if (lastSeenBefore) where.lastSeen = { lt: new Date(lastSeenBefore) };
    if (lastSeenAfter) where.lastSeen = { ...(where.lastSeen ?? {}), gt: new Date(lastSeenAfter) };
    const devices = await app.prisma.device.findMany({ where });
    return devices.map((d: any) => ({
      id: d.id,
      mac: d.mac,
      userId: d.userId,
      status: d.status,
      lastSeen: d.lastSeen,
      deviceSecretHash: d.currentSecretHash,
      createdAt: d.createdAt,
      displayHash: d.displayHash,
      battery: d.battery,
      firmwareVersion: d.firmwareVersion,
      autoUpdate: d.autoUpdate,
      demoMode: d.demoMode,
      displayInstructionJson: d.displayInstructionJson,
    }));
  });

  app.post('/devices/:id/revoke', async (request, reply) => {
    await app.requireAdmin(request);
    const { id } = request.params as any;
    const d = await app.prisma.device.findUnique({ where: { id } });
    if (!d) return reply.code(404).send({ message: 'Not found' });
    await app.prisma.device.update({ where: { id }, data: { status: 'revoked' } });
    return { status: 'revoked' };
  });

  app.delete('/devices/:id', async (request, reply) => {
    await app.requireAdmin(request);
    const { id } = request.params as any;
    const d = await app.prisma.device.findUnique({ where: { id } });
    if (!d) return reply.code(404).send({ message: 'Not found' });
    // Delete related claims first
    await app.prisma.deviceClaim.deleteMany({ where: { deviceId: id } });
    await app.prisma.device.delete({ where: { id } });
    return { deleted: true };
  });

  app.post('/devices/:id/factory-reset', async (request, reply) => {
    await app.requireAdmin(request);
    const { id } = request.params as any;
    const d = await app.prisma.device.findUnique({ where: { id } });
    if (!d) return reply.code(404).send({ message: 'Not found' });
    if (d.status !== 'active') {
      return reply.code(400).send({ message: 'Device must be active to queue factory reset' });
    }
    await app.prisma.device.update({
      where: { id },
      data: { pendingFactoryReset: true }
    });
    return { queued: true };
  });

  // Update device settings (autoUpdate, etc.)
  app.patch('/devices/:id/settings', async (request, reply) => {
    await app.requireAdmin(request);
    const { id } = request.params as any;
    const body = DeviceSettingsSchema.parse(request.body ?? {});
    
    const d = await app.prisma.device.findUnique({ where: { id } });
    if (!d) return reply.code(404).send({ message: 'Not found' });
    
    const updateData: any = {};
    if (body.autoUpdate !== undefined) {
      updateData.autoUpdate = body.autoUpdate;
    }
    if (body.demoMode !== undefined) {
      updateData.demoMode = body.demoMode;
    }
    
    if (Object.keys(updateData).length === 0) {
      return reply.code(400).send({ message: 'No settings to update' });
    }
    
    const updated = await app.prisma.device.update({
      where: { id },
      data: updateData,
    });
    
    return { 
      id: updated.id, 
      autoUpdate: updated.autoUpdate,
      demoMode: updated.demoMode,
    };
  });

  app.get('/device-claims/:code', async (request, reply) => {
    await app.requireAdmin(request);
    const { code } = request.params as any;
    const c = await app.prisma.deviceClaim.findUnique({ where: { code } });
    if (!c) return reply.code(404).send({ message: 'Not found' });
    return { code: c.code, status: c.status, deviceId: c.deviceId, mac: c.mac, expiresAt: c.expiresAt };
  });

  // List pending devices
  app.get('/pending-devices', async (request) => {
    await app.requireAdmin(request);
    const devices = await app.prisma.pendingDevice.findMany({
      where: { status: 'pending' },
      orderBy: { lastSeen: 'desc' }
    });
    return devices;
  });

  // Approve pending device (creates Device record)
  app.post('/pending-devices/:id/approve', async (request, reply) => {
    await app.requireAdmin(request);
    const { id } = request.params as any;
    
    const pending = await app.prisma.pendingDevice.findUnique({ where: { id } });
    if (!pending) return reply.code(404).send({ message: 'Not found' });
    if (pending.status !== 'pending') {
      return reply.code(409).send({ message: 'Already processed' });
    }
    
    // Create actual Device
    const device = await app.prisma.device.create({
      data: {
        mac: pending.mac,
        status: 'awaiting_claim',
        firmwareVersion: pending.firmwareVersion || 'unknown',
        ip: pending.ip
      }
    });
    
    // Mark as approved
    await app.prisma.pendingDevice.update({
      where: { id },
      data: { status: 'approved' }
    });
    
    return { device };
  });

  // Reject pending device
  app.post('/pending-devices/:id/reject', async (request, reply) => {
    await app.requireAdmin(request);
    const { id } = request.params as any;
    
    await app.prisma.pendingDevice.update({
      where: { id },
      data: { status: 'rejected' }
    });
    
    return { status: 'rejected' };
  });
}

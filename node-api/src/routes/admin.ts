import { FastifyInstance } from 'fastify';
import { z } from 'zod';

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

  app.get('/device-claims/:code', async (request, reply) => {
    await app.requireAdmin(request);
    const { code } = request.params as any;
    const c = await app.prisma.deviceClaim.findUnique({ where: { code } });
    if (!c) return reply.code(404).send({ message: 'Not found' });
    return { code: c.code, status: c.status, deviceId: c.deviceId, mac: c.mac, expiresAt: c.expiresAt };
  });
}

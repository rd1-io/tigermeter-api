import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DisplayFramesPayload, deviceDto, deviceStateDto, setDeviceDisplay } from '../utils/display.js';

// PATCH device body
const DevicePatchSchema = z.object({
  name: z.string().max(128).optional(),
  autoUpdate: z.boolean().optional(),
  demoMode: z.boolean().optional(),
});

export default async function portalRoutes(app: FastifyInstance) {
  // --- LIST devices (tenant-scoped) ---
  app.get('/devices', async (request) => {
    const auth = await app.requireScope(request, 'manage');
    const devices = await app.prisma.device.findMany({ where: { tenantId: auth.tenantId } });
    return devices.map(deviceDto);
  });

  // --- GET single device (tenant-scoped) ---
  app.get('/devices/:id', async (request, reply) => {
    const auth = await app.requireScope(request, 'manage');
    const { id } = request.params as any;
    const d = await app.prisma.device.findUnique({ where: { id } });
    if (!d || d.tenantId !== auth.tenantId) return reply.code(404).send({ message: 'Not found' });
    return deviceStateDto(d);
  });

  // --- GET current display frames (tenant-scoped) ---
  app.get('/devices/:id/display', async (request, reply) => {
    const auth = await app.requireScope(request, 'manage');
    const { id } = request.params as any;
    const d = await app.prisma.device.findUnique({ where: { id } });
    if (!d || d.tenantId !== auth.tenantId) return reply.code(404).send({ message: 'Not found' });
    if (!d.displayFramesJson) return reply.code(404).send({ message: 'No frames' });
    return JSON.parse(d.displayFramesJson);
  });

  // --- PATCH device settings (tenant-scoped) ---
  app.patch('/devices/:id', async (request, reply) => {
    const auth = await app.requireScope(request, 'manage');
    const { id } = request.params as any;
    const d = await app.prisma.device.findUnique({ where: { id } });
    if (!d || d.tenantId !== auth.tenantId) return reply.code(404).send({ message: 'Not found' });

    const body = DevicePatchSchema.parse(request.body ?? {});
    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.autoUpdate !== undefined) updateData.autoUpdate = body.autoUpdate;
    if (body.demoMode !== undefined) updateData.demoMode = body.demoMode;
    if (Object.keys(updateData).length === 0) {
      return reply.code(400).send({ message: 'No fields to update' });
    }

    const updated = await app.prisma.device.update({ where: { id }, data: updateData });
    return {
      id: updated.id,
      name: updated.name,
      autoUpdate: updated.autoUpdate,
      demoMode: updated.demoMode,
    };
  });

  // --- PUT display frames (tenant-scoped) ---
  app.put('/devices/:id/display', async (request, reply) => {
    const auth = await app.requireScope(request, 'manage');
    const { id } = request.params as any;
    const d = await app.prisma.device.findUnique({ where: { id } });
    if (!d || d.tenantId !== auth.tenantId) return reply.code(404).send({ message: 'Not found' });

    const payload = DisplayFramesPayload.parse(request.body);
    return setDeviceDisplay(app.prisma, d, payload);
  });

  // --- REVOKE device (tenant-scoped) ---
  app.post('/devices/:id/revoke', async (request, reply) => {
    const auth = await app.requireScope(request, 'manage');
    const { id } = request.params as any;
    const d = await app.prisma.device.findUnique({ where: { id } });
    if (!d || d.tenantId !== auth.tenantId) return reply.code(404).send({ message: 'Not found' });

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
}
import { z } from 'zod';
import { displayPayloadHash } from '../utils/crypto.js';
// Per-frame LED/beep enums
const LedColor = z.enum(['green', 'red', 'blue', 'yellow', 'cyan', 'magenta', 'white', 'rainbow', 'off']);
const LedBrightness = z.enum(['low', 'mid', 'high', 'off']);
// Single display frame
const DisplayFrame = z.strictObject({
    bitmap: z.string().refine((val) => {
        try {
            const decoded = Buffer.from(val, 'base64');
            return decoded.length === 8064;
        }
        catch {
            return false;
        }
    }, { message: 'bitmap must be valid base64 of exactly 8064 bytes (384x168 1-bit packed)' }),
    ledColor: LedColor,
    ledBrightness: LedBrightness,
    durationSec: z.number().int().min(1).max(86400),
    beep: z.boolean().optional(),
    flashCount: z.number().int().min(0).max(10).optional(),
});
// Full display payload
const DisplayFramesPayload = z.strictObject({
    frames: z.array(DisplayFrame).min(1).max(8),
    refreshInterval: z.number().int().min(10).max(3600),
});
// PATCH device body
const DevicePatchSchema = z.object({
    name: z.string().max(128).optional(),
    autoUpdate: z.boolean().optional(),
    demoMode: z.boolean().optional(),
});
export default async function portalRoutes(app) {
    // --- LIST devices (tenant-scoped) ---
    app.get('/devices', async (request) => {
        const auth = await app.requireScope(request, 'manage');
        const devices = await app.prisma.device.findMany({ where: { tenantId: auth.tenantId } });
        return devices.map((d) => ({
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
            createdAt: d.createdAt,
        }));
    });
    // --- GET single device (tenant-scoped) ---
    app.get('/devices/:id', async (request, reply) => {
        const auth = await app.requireScope(request, 'manage');
        const { id } = request.params;
        const d = await app.prisma.device.findUnique({ where: { id } });
        if (!d || d.tenantId !== auth.tenantId)
            return reply.code(404).send({ message: 'Not found' });
        return {
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
            createdAt: d.createdAt,
        };
    });
    // --- PATCH device settings (tenant-scoped) ---
    app.patch('/devices/:id', async (request, reply) => {
        const auth = await app.requireScope(request, 'manage');
        const { id } = request.params;
        const d = await app.prisma.device.findUnique({ where: { id } });
        if (!d || d.tenantId !== auth.tenantId)
            return reply.code(404).send({ message: 'Not found' });
        const body = DevicePatchSchema.parse(request.body ?? {});
        const updateData = {};
        if (body.name !== undefined)
            updateData.name = body.name;
        if (body.autoUpdate !== undefined)
            updateData.autoUpdate = body.autoUpdate;
        if (body.demoMode !== undefined)
            updateData.demoMode = body.demoMode;
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
        const { id } = request.params;
        const d = await app.prisma.device.findUnique({ where: { id } });
        if (!d || d.tenantId !== auth.tenantId)
            return reply.code(404).send({ message: 'Not found' });
        const payload = DisplayFramesPayload.parse(request.body);
        const displayHash = displayPayloadHash(payload);
        await app.prisma.device.update({
            where: { id },
            data: {
                displayFramesJson: JSON.stringify(payload),
                displayHash,
                displayVersion: (d.displayVersion ?? 0) + 1,
            },
        });
        return { displayHash, displayVersion: (d.displayVersion ?? 0) + 1 };
    });
    // --- REVOKE device (tenant-scoped) ---
    app.post('/devices/:id/revoke', async (request, reply) => {
        const auth = await app.requireScope(request, 'manage');
        const { id } = request.params;
        const d = await app.prisma.device.findUnique({ where: { id } });
        if (!d || d.tenantId !== auth.tenantId)
            return reply.code(404).send({ message: 'Not found' });
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

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
export default async function deviceRoutes(app) {
    // Simple device-secret authorization (unchanged)
    app.decorate('requireDevice', async (id, authorization) => {
        if (!authorization?.startsWith('Bearer '))
            throw app.httpErrors.unauthorized('Missing device secret');
        const token = authorization.slice('Bearer '.length);
        const device = await app.prisma.device.findUnique({ where: { id } });
        if (!device)
            throw app.httpErrors.notFound('Device not found');
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
        if (!validCurrent && !validPrev)
            throw app.httpErrors.unauthorized('Invalid or expired secret');
        if (device.status === 'revoked')
            throw app.httpErrors.forbidden('Device revoked');
        return device;
    });
    // --- HEARTBEAT ---
    app.post('/devices/:id/heartbeat', async (request, reply) => {
        const { id } = request.params;
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
        // Update telemetry
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
        // Hash match — no new content (empty frames means no content yet, NOT a match)
        if (device.displayHash && body.displayHash && body.displayHash === device.displayHash) {
            return baseResponse;
        }
        // Hash mismatch or missing — serve frames
        if (device.displayFramesJson && device.displayHash) {
            const payload = JSON.parse(device.displayFramesJson);
            return {
                ...baseResponse,
                frames: payload.frames,
                refreshInterval: payload.refreshInterval,
                displayHash: device.displayHash,
            };
        }
        // No frames yet — empty state
        return {
            ...baseResponse,
            frames: [],
            refreshInterval: 60,
            displayHash: null,
        };
    });
    // --- GET display hash ---
    app.get('/devices/:id/display/hash', async (request, reply) => {
        const { id } = request.params;
        const device = await app.requireDevice(id, request.headers['authorization']);
        return { hash: device.displayHash ?? '' };
    });
    // --- GET display full (unchanged, useful for debug) ---
    app.get('/devices/:id/display/full', async (request, reply) => {
        const { id } = request.params;
        const device = await app.requireDevice(id, request.headers['authorization']);
        const ifHash = request.query?.ifHash;
        if (!device.displayFramesJson)
            return reply.code(404).send({ message: 'Not found' });
        if (ifHash && device.displayHash && ifHash === device.displayHash)
            return reply.code(304).send();
        return JSON.parse(device.displayFramesJson);
    });
    // --- REFRESH secret ---
    app.post('/devices/:id/secret/refresh', async (request, reply) => {
        const { id } = request.params;
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

import { z } from 'zod';
import { addSeconds } from 'date-fns';
import { config } from '../config.js';
import { generateDeviceSecret, hashPassword, normalizeMac, verifyClaimHmac } from '../utils/crypto.js';
// Helper to generate a 6-digit code with leading zeros preserved
const generateCode = () => String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
const AttachBody = z.object({
    externalUserId: z.string().min(1).max(128),
});
export default async function deviceClaimsRoutes(app) {
    // --- ISSUE claim code (device, HMAC auth) ---
    app.post('/device-claims', {
        config: {
            rateLimit: {
                max: 20,
                timeWindow: '1 minute',
            },
        },
    }, async (request, reply) => {
        const body = request.body || {};
        const rawMac = body.mac;
        if (!rawMac)
            return reply.code(400).send({ message: 'mac required' });
        const mac = normalizeMac(rawMac);
        if (!mac)
            return reply.code(400).send({ message: 'invalid mac format' });
        const firmwareVersion = body.firmwareVersion;
        const hmac = body.hmac;
        const timestamp = body.timestamp;
        const ip = body.ip;
        if (!hmac || !timestamp) {
            return reply.code(400).send({ message: 'hmac and timestamp required' });
        }
        if (!verifyClaimHmac(mac, hmac, firmwareVersion, timestamp)) {
            return reply.code(401).send({ message: 'invalid hmac' });
        }
        // Device must already exist and be in awaiting_claim state
        let device = await app.prisma.device.findFirst({ where: { mac } });
        if (!device) {
            const setting = await app.prisma.setting.findUnique({ where: { key: 'autoProvisionNewDevices' } });
            const autoProvision = setting?.value === 'true';
            if (autoProvision) {
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
                }
                catch (_) { }
            }
            else {
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
                    }
                    else {
                        await app.prisma.pendingDevice.create({ data: { mac, firmwareVersion, ip } });
                    }
                }
                catch { }
                return reply.code(404).send({ message: 'device not found' });
            }
        }
        if (device.status !== 'awaiting_claim') {
            await app.prisma.device.update({
                where: { id: device.id },
                data: { status: 'awaiting_claim', tenantId: null, externalUserId: null },
            });
        }
        const code = generateCode();
        const expiresAt = addSeconds(new Date(), config.claimCodeTtlSeconds);
        await app.prisma.deviceClaim.create({
            data: { code, deviceId: device.id, mac, firmwareVersion, ip, expiresAt },
        });
        return reply.code(201).send({ code, expiresAt });
    });
    // --- ATTACH claim code (tenant service token, replaces old user-JWT attach) ---
    app.post('/device-claims/:code/attach', {
        config: {
            rateLimit: {
                max: 5, // strict: 5 attempts per minute per IP (anti-brute-force on 6-digit code)
                timeWindow: '1 minute',
            },
        },
    }, async (request, reply) => {
        const auth = await app.requireScope(request, 'manage');
        const { code } = request.params;
        const body = AttachBody.parse(request.body ?? {});
        const claim = await app.prisma.deviceClaim.findUnique({ where: { code } });
        if (!claim)
            return reply.code(400).send({ message: 'Invalid code' });
        if (claim.expiresAt < new Date())
            return reply.code(400).send({ message: 'Expired code' });
        if (claim.status === 'claimed')
            return reply.code(409).send({ message: 'Already claimed' });
        // Mark claim as used
        await app.prisma.deviceClaim.update({ where: { code }, data: { status: 'claimed' } });
        // Bind device to tenant (no welcome instruction — display stays empty until first PUT /display)
        await app.prisma.device.update({
            where: { id: claim.deviceId },
            data: {
                tenantId: auth.tenantId,
                externalUserId: body.externalUserId,
                status: 'active',
            },
        });
        return { deviceId: claim.deviceId, message: 'Attached', tenantId: auth.tenantId };
    });
    // --- POLL claim status (device side, HMAC auth still via future TODO) ---
    app.get('/device-claims/:code/poll', {
        config: {
            rateLimit: {
                max: 60,
                timeWindow: '1 minute',
            },
        },
    }, async (request, reply) => {
        const { code } = request.params;
        const claim = await app.prisma.deviceClaim.findUnique({ where: { code } });
        if (!claim)
            return reply.code(404).send({ message: 'Not found' });
        if (claim.expiresAt < new Date())
            return reply.code(410).send({ message: 'Expired' });
        if (claim.status !== 'claimed')
            return reply.code(202).send({ status: claim.status });
        if (claim.secretIssued)
            return reply.code(404).send({ message: 'Not found' });
        // Lazy secret generation (one-time reveal)
        const device = await app.prisma.device.findUnique({ where: { id: claim.deviceId } });
        if (!device)
            return reply.code(404).send({ message: 'Not found' });
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

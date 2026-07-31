import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { ZodError } from 'zod';
import prismaPlugin from './plugins/prisma.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import authPlugin from './plugins/auth.js';
import deviceClaimsRoutes from './routes/device-claims.js';
import deviceRoutes from './routes/devices.js';
import portalRoutes from './routes/portal.js';
import adminRoutes from './routes/admin.js';
import devicesProvisionRoutes from './routes/devices-provision.js';
// admin-logos.ts removed — logos feature deleted
import { V5_PREFIX } from './config.js';
const buildServer = () => {
    const app = Fastify({ logger: true });
    app.register(prismaPlugin);
    app.register(sensible);
    // Cast cors plugin to any to avoid strict generic mismatch across versions
    app.register(fastifyCors, {
        origin: (origin, cb) => {
            if (!origin)
                return cb(null, true);
            const allowedPatterns = [
                /^http:\/\/localhost:\d+$/,
                /^http:\/\/127\.0\.0\.1:\d+$/,
                /^https:\/\/[\w-]+\.rd1\.io$/, // rd1.io subdomains
            ];
            if (allowedPatterns.some((r) => r.test(origin)))
                return cb(null, true);
            const envOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            if (envOrigins.includes(origin))
                return cb(null, true);
            cb(new Error('CORS not allowed'), false);
        },
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        credentials: false
    });
    app.register(rateLimitPlugin);
    app.register(authPlugin);
    app.get('/healthz', async () => ({ status: 'ok' }));
    // Global error handler: map ZodError → 400 with readable message
    app.setErrorHandler((err, request, reply) => {
        if (err instanceof ZodError) {
            const issues = err.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`);
            return reply.code(400).send({ message: issues.join('; ') });
        }
        // Fastify's own errors (rate limit, body parse, etc.) keep their statusCode
        const status = err.statusCode ?? 500;
        reply.code(status).send({ message: err.message || 'Internal Server Error' });
    });
    // v5 routes (old unversioned registrations removed)
    app.register(deviceClaimsRoutes, { prefix: V5_PREFIX });
    app.register(deviceRoutes, { prefix: V5_PREFIX });
    app.register(portalRoutes, { prefix: V5_PREFIX });
    app.register(adminRoutes, { prefix: V5_PREFIX + '/admin' });
    // admin-logos removed
    app.register(devicesProvisionRoutes);
    return app;
};
if (import.meta.url === `file://${process.argv[1]}`) {
    const app = buildServer();
    const port = Number(process.env.PORT || 3001);
    app
        .listen({ port, host: '0.0.0.0' })
        .then(() => app.log.info({ port }, 'server started'))
        .catch((err) => {
        app.log.error(err);
        process.exit(1);
    });
}
export default buildServer;

import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import prismaPlugin from './plugins/prisma.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import authPlugin from './plugins/auth.js';
import deviceClaimsRoutes from './routes/device-claims.js';
import deviceRoutes from './routes/devices.js';
import portalRoutes from './routes/portal.js';
import adminRoutes from './routes/admin.js';
import devicesProvisionRoutes from './routes/devices-provision.js';

const buildServer = () => {
  const app = Fastify({ logger: true });

  app.register(prismaPlugin);
  app.register(fastifyCors, {
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      // Allow undefined origin (curl, server-side) and localhost dev ports
      if (!origin) return cb(null, true);
      const allowed = [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];
      if (allowed.some((r) => r.test(origin))) return cb(null, true);
      cb(new Error('CORS not allowed'), false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: false
  });
  app.register(rateLimitPlugin);
  app.register(authPlugin);

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.register(deviceClaimsRoutes, { prefix: '/api' });
  app.register(deviceRoutes, { prefix: '/api' });
  app.register(portalRoutes, { prefix: '/api' });
  app.register(adminRoutes, { prefix: '/api/admin' });
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

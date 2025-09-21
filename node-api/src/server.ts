import Fastify from 'fastify';
import prismaPlugin from './plugins/prisma.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import authPlugin from './plugins/auth.js';
import deviceClaimsRoutes from './routes/device-claims.js';
import deviceRoutes from './routes/devices.js';
import portalRoutes from './routes/portal.js';
import adminRoutes from './routes/admin.js';

const buildServer = () => {
  const app = Fastify({ logger: true });

  app.register(prismaPlugin);
  app.register(rateLimitPlugin);
  app.register(authPlugin);

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.register(deviceClaimsRoutes, { prefix: '/api' });
  app.register(deviceRoutes, { prefix: '/api' });
  app.register(portalRoutes, { prefix: '/api' });
  app.register(adminRoutes, { prefix: '/api/admin' });

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

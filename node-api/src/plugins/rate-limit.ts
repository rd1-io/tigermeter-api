import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';

// Global rate limiting plugin.
// Defaults: 100 requests / 60s per IP; override per-route as needed.
export default fp(async (app) => {
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    addHeadersOnSuccess: true,
    ban: 0,
    continueExceeding: false,
  keyGenerator: (req: any) => req.ip,
  });
});

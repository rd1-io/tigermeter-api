import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';

// Global rate limiting plugin.
// Defaults: 100 requests / 60s per IP; override per-route as needed. Device routes (claim, poll,
// heartbeat) set their own limits and keys, since a fleet can share one NAT IP.
// No `ban`: it turns over-limit responses into 403, which firmware treats as "device revoked"
// and wipes its credentials. Over-limit must stay 429.
export default fp(async (app) => {
  await app.register(rateLimit as any, {
    max: 100,
    timeWindow: '1 minute',
    continueExceeding: false,
    keyGenerator: (req: any) => req.ip,
  } as any);
});

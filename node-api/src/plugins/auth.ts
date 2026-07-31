import fp from 'fastify-plugin';
import { FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { z } from 'zod';

// Service token schema from env config
const ServiceTokenConfig = z.object({
  token: z.string(),
  tenantId: z.string(),
  scope: z.enum(['ops', 'manage']),
});
const ServiceTokensConfig = z.array(ServiceTokenConfig);

export interface ServiceAuth {
  tenantId: string;
  scope: 'ops' | 'manage';
}

export default fp(async (app) => {
  // Parse service tokens from env (fail-fast on bad config)
  let serviceTokens: z.infer<typeof ServiceTokensConfig> = [];
  try {
    const raw = config.serviceTokensJson;
    if (raw) {
      serviceTokens = ServiceTokensConfig.parse(JSON.parse(raw));
    }
  } catch (err: any) {
    throw new Error(`Invalid SERVICE_TOKENS env: ${err.message}`);
  }

  // requireService — lookup token in env config, attach serviceAuth to request
  app.decorate('requireService', async (request: FastifyRequest) => {
    const auth = request.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) {
      throw (app as any).httpErrors.unauthorized('Missing service token');
    }
    const token = auth.slice('Bearer '.length);
    const found = serviceTokens.find((t) => t.token === token);
    if (!found) {
      throw (app as any).httpErrors.unauthorized('Invalid service token');
    }
    (request as any).serviceAuth = { tenantId: found.tenantId, scope: found.scope } satisfies ServiceAuth;
    return (request as any).serviceAuth as ServiceAuth;
  });

  // requireScope — requireService + scope check
  app.decorate('requireScope', async (request: FastifyRequest, scope: 'ops' | 'manage') => {
    const auth = await app.requireService(request);
    if (auth.scope !== 'ops' && auth.scope !== scope) {
      throw (app as any).httpErrors.forbidden(`Scope '${scope}' required, got '${auth.scope}'`);
    }
    return auth;
  });

  // GET /api/v5/admin/me — return current service auth info
  app.get('/api/v5/admin/me', async (request) => {
    const auth = await app.requireService(request);
    return { tenantId: auth.tenantId, scope: auth.scope };
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    requireService(request: FastifyRequest): Promise<ServiceAuth>;
    requireScope(request: FastifyRequest, scope: 'ops' | 'manage'): Promise<ServiceAuth>;
  }
}
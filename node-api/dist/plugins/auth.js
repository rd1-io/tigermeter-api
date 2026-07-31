import fp from 'fastify-plugin';
import { config } from '../config.js';
import { z } from 'zod';
// Service token schema from env config
const ServiceTokenConfig = z.object({
    token: z.string(),
    tenantId: z.string(),
    scope: z.enum(['ops', 'manage']),
});
const ServiceTokensConfig = z.array(ServiceTokenConfig);
export default fp(async (app) => {
    // Parse service tokens from env (fail-fast on bad config)
    let serviceTokens = [];
    try {
        const raw = config.serviceTokensJson;
        if (raw) {
            serviceTokens = ServiceTokensConfig.parse(JSON.parse(raw));
        }
    }
    catch (err) {
        throw new Error(`Invalid SERVICE_TOKENS env: ${err.message}`);
    }
    // requireService — lookup token in env config, attach serviceAuth to request
    app.decorate('requireService', async (request) => {
        const auth = request.headers['authorization'];
        if (!auth?.startsWith('Bearer ')) {
            throw app.httpErrors.unauthorized('Missing service token');
        }
        const token = auth.slice('Bearer '.length);
        const found = serviceTokens.find((t) => t.token === token);
        if (!found) {
            throw app.httpErrors.unauthorized('Invalid service token');
        }
        request.serviceAuth = { tenantId: found.tenantId, scope: found.scope };
        return request.serviceAuth;
    });
    // requireScope — requireService + scope check
    app.decorate('requireScope', async (request, scope) => {
        const auth = await app.requireService(request);
        if (auth.scope !== 'ops' && auth.scope !== scope) {
            throw app.httpErrors.forbidden(`Scope '${scope}' required, got '${auth.scope}'`);
        }
        return auth;
    });
    // GET /api/v5/admin/me — return current service auth info
    app.get('/api/v5/admin/me', async (request) => {
        const auth = await app.requireService(request);
        return { tenantId: auth.tenantId, scope: auth.scope };
    });
});

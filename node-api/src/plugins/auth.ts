import fp from 'fastify-plugin';
import { verifyJwt } from '../utils/crypto.js';
import { FastifyRequest } from 'fastify';

export interface UserToken {
  sub?: string;
  role?: 'user' | 'admin';
  userId?: string;
}

export default fp(async (app) => {
  app.decorate('requireUser', async (request: FastifyRequest) => {
    const auth = request.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) {
      throw app.httpErrors.unauthorized('Missing token');
    }
    const token = auth.slice('Bearer '.length);
    try {
      const payload = (await verifyJwt(token)) as UserToken;
      if (!payload.role || (payload.role !== 'user' && payload.role !== 'admin')) {
        throw app.httpErrors.forbidden('Forbidden');
      }
      return payload;
    } catch {
      throw app.httpErrors.unauthorized('Invalid token');
    }
  });

  app.decorate('requireAdmin', async (request: FastifyRequest) => {
    const payload = await app.requireUser(request);
    if (payload.role !== 'admin') {
      throw app.httpErrors.forbidden('Admin only');
    }
    return payload;
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    requireUser(request: FastifyRequest): Promise<UserToken>;
    requireAdmin(request: FastifyRequest): Promise<UserToken>;
  }
}









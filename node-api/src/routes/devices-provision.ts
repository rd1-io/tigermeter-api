import { FastifyInstance } from 'fastify';
import { normalizeMac } from '../utils/crypto.js';

export async function devicesProvisionRoutes(app: FastifyInstance) {
  app.post('/api/devices/provision', {
    schema: {
      tags: ['devices'],
      summary: 'Provision a device (no auth, dev-only)',
      body: {
        type: 'object',
        required: ['mac', 'firmwareVersion'],
        properties: {
          mac: { type: 'string', description: 'MAC address AA:BB:CC:DD:EE:FF' },
          firmwareVersion: { type: 'string' }
        }
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            mac: { type: 'string' },
            status: { type: 'string' }
          }
        },
        409: {
          type: 'object',
          properties: { message: { type: 'string' } }
        },
        400: {
          type: 'object',
          properties: { message: { type: 'string' } }
        }
      }
    }
  }, async (req, reply) => {
    const { mac, firmwareVersion } = req.body as any;
    if (!mac || typeof mac !== 'string') {
      return reply.code(400).send({ message: 'mac required' });
    }
    const norm = normalizeMac(mac);
    if (!norm) {
      return reply.code(400).send({ message: 'invalid mac format' });
    }

    const existing = await app.prisma.device.findUnique({ where: { mac: norm } });
    if (existing) {
      return reply.code(409).send({ message: 'device already exists' });
    }

    const created = await app.prisma.device.create({
      data: {
        mac: norm,
        status: 'awaiting_claim',
        firmwareVersion: firmwareVersion || 'dev-firmware'
      }
    });
    return reply.code(201).send({ id: created.id, mac: created.mac, status: created.status });
  });
}

export default devicesProvisionRoutes;
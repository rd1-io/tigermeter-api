import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { instructionHash } from '../utils/crypto.js';

// Enum definitions
const FontSize = z.number().int().min(10).max(40); // 10-40px font size
const TextAlign = z.enum(['left', 'center', 'right']);
const LedColor = z.enum(['blue', 'green', 'red', 'yellow', 'purple', 'rainbow']);
const LedBrightness = z.enum(['off', 'low', 'mid', 'high']);

// Display instruction schema
const DisplayInstruction = z.object({
  // Metadata
  version: z.number().int(),
  hash: z.string(),
  
  // Required fields
  symbol: z.string(),
  mainText: z.string(),
  
  // Symbol (left bar)
  symbolFontSize: FontSize.optional().default(24),
  
  // Top line
  topLine: z.string().optional(),
  topLineFontSize: FontSize.optional().default(16),
  topLineAlign: TextAlign.optional(),
  topLineShowDate: z.boolean().optional(),
  
  // Main text
  mainTextFontSize: FontSize.optional().default(32),
  mainTextAlign: TextAlign.optional(),
  
  // Bottom line
  bottomLine: z.string().optional(),
  bottomLineFontSize: FontSize.optional().default(16),
  bottomLineAlign: TextAlign.optional(),
  
  // LED control
  ledColor: LedColor.optional(),
  ledBrightness: LedBrightness.optional(),
  
  // One-time actions
  beep: z.boolean().optional(),
  flashCount: z.number().int().min(0).optional(),
  
  // Device behavior
  refreshInterval: z.number().int().min(5).optional(),
  timezoneOffset: z.number().min(-12).max(14).optional(), // Hours from UTC
  
  // Future extensions
  extensions: z.record(z.any()).optional(),
});

export default async function portalRoutes(app: FastifyInstance) {
  app.get('/devices', async (request) => {
    const user = await app.requireUser(request);
    const userId = user.sub ?? user.userId ?? 'user';
    const devices = await app.prisma.device.findMany({ where: { userId } });
    return devices.map((d: any) => ({ id: d.id, name: null, status: d.status, lastSeen: d.lastSeen }));
  });

  app.get('/devices/:id', async (request, reply) => {
    const user = await app.requireUser(request);
    const userId = user.sub ?? user.userId ?? 'user';
    const { id } = request.params as any;
    const d = await app.prisma.device.findUnique({ where: { id } });
    if (!d) return reply.code(404).send({ message: 'Not found' });
    if (d.userId !== userId) return reply.code(403).send({ message: 'Forbidden' });
    
    // Parse display instruction if available
    let displayInstruction = null;
    if (d.displayInstructionJson) {
      try {
        displayInstruction = JSON.parse(d.displayInstructionJson);
      } catch {
        // ignore parse errors
      }
    }
    
    return {
      id: d.id,
      status: d.status,
      lastSeen: d.lastSeen,
      mac: d.mac,
      userId: d.userId,
      battery: d.battery,
      secretExpiresAt: d.currentSecretExpiresAt,
      displayHash: d.displayHash,
      displayInstruction,
    };
  });

  app.post('/devices/:id/revoke', async (request, reply) => {
    const user = await app.requireUser(request);
    const userId = user.sub ?? user.userId ?? 'user';
    const { id } = request.params as any;
    const d = await app.prisma.device.findUnique({ where: { id } });
    if (!d) return reply.code(404).send({ message: 'Not found' });
    if (d.userId !== userId) return reply.code(403).send({ message: 'Forbidden' });
    await app.prisma.device.update({
      where: { id },
      data: {
        status: 'revoked',
        displayInstructionJson: null,
        displayHash: null,
        currentSecretHash: null,
        currentSecretExpiresAt: null,
        previousSecretHash: null,
        previousSecretExpiresAt: null,
      }
    });
    return { status: 'revoked' };
  });

  app.put('/devices/:id/display', async (request, reply) => {
    const user = await app.requireUser(request);
    const userId = user.sub ?? user.userId ?? 'user';
    const { id } = request.params as any;
    const d = await app.prisma.device.findUnique({ where: { id } });
    if (!d) return reply.code(404).send({ message: 'Not found' });
    if (d.userId !== userId) return reply.code(403).send({ message: 'Forbidden' });

    const instruction = DisplayInstruction.parse(request.body);
    const computed = instructionHash(instruction);
    if (instruction.hash !== computed) {
      return reply.code(400).send({ message: 'Hash mismatch', expected: computed });
    }

    await app.prisma.device.update({
      where: { id },
      data: {
        displayInstructionJson: JSON.stringify(instruction),
        displayHash: computed,
        displayVersion: (d.displayVersion ?? 0) + 1,
      },
    });

    return { displayHash: computed };
  });
}

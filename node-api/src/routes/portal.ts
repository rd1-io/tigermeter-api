import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { instructionHash } from '../utils/crypto.js';

const DisplaySingle = z.object({
  name: z.string(),
  price: z.number(),
  currencySymbol: z.string(),
  timestamp: z.string(),
  ledColor: z.enum(['blue', 'green', 'red', 'yellow', 'purple']).optional(),
  beep: z.boolean().optional(),
  flashCount: z.number().int().min(0).optional(),
  ledBrightness: z.enum(['off', 'low', 'mid', 'high']).optional(),
  portfolioValue: z.number().optional(),
  portfolioChangeAbsolute: z.number().optional(),
  portfolioChangePercent: z.number().optional(),
  extensions: z.record(z.any()).optional(),
});

const DisplayPlaylist = z.object({
  items: z.array(DisplaySingle),
  displaySeconds: z.number().int().min(1),
  extensions: z.record(z.any()).optional(),
});

const DisplayInstruction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('single'), version: z.number().int(), hash: z.string(), extensions: z.record(z.any()).optional(), single: DisplaySingle }),
  z.object({ type: z.literal('playlist'), version: z.number().int(), hash: z.string(), extensions: z.record(z.any()).optional(), playlist: DisplayPlaylist }),
]);

export default async function portalRoutes(app: FastifyInstance) {
  app.get('/devices', async (request) => {
    const user = await app.requireUser(request);
    const userId = user.sub ?? user.userId ?? 'user';
    const devices = await app.prisma.device.findMany({ where: { userId } });
    return devices.map((d) => ({ id: d.id, name: null, status: d.status, lastSeen: d.lastSeen }));
  });

  app.get('/devices/:id', async (request, reply) => {
    const user = await app.requireUser(request);
    const userId = user.sub ?? user.userId ?? 'user';
    const { id } = request.params as any;
    const d = await app.prisma.device.findUnique({ where: { id } });
    if (!d) return reply.code(404).send({ message: 'Not found' });
    if (d.userId !== userId) return reply.code(403).send({ message: 'Forbidden' });
    // Prefer stored ledBrightness; fallback to parsing legacy if null after migration phase
    // @ts-ignore new column
    let derivedLed: string | null = (d as any).ledBrightness ? ((d as any).ledBrightness === 'mid' ? 'middle' : (d as any).ledBrightness) : null;
    if (!derivedLed && d.displayInstructionJson) {
      try {
        const instr = JSON.parse(d.displayInstructionJson);
        if (instr && instr.type === 'single' && instr.single && instr.single.ledBrightness) {
          const lb = instr.single.ledBrightness as string;
          derivedLed = lb === 'mid' ? 'middle' : lb;
        } else if (instr && instr.type === 'playlist' && instr.playlist?.items?.length) {
          const first = instr.playlist.items[0];
          if (first.ledBrightness) {
            const lb = first.ledBrightness as string;
            derivedLed = lb === 'mid' ? 'middle' : lb;
          }
        }
      } catch {
        // ignore parse errors
      }
    }
    return {
      id: d.id,
      name: null,
      status: d.status,
      lastSeen: d.lastSeen,
      mac: d.mac,
      userId: d.userId,
      currentDisplayType: d.currentDisplayType as any,
      battery: d.battery,
      led: derivedLed, // derive from single display instruction if available
      secretExpiresAt: d.currentSecretExpiresAt,
      displayHash: d.displayHash,
    };
  });

  app.post('/devices/:id/revoke', async (request, reply) => {
    const user = await app.requireUser(request);
    const userId = user.sub ?? user.userId ?? 'user';
    const { id } = request.params as any;
    const d = await app.prisma.device.findUnique({ where: { id } });
    if (!d) return reply.code(404).send({ message: 'Not found' });
    if (d.userId !== userId) return reply.code(403).send({ message: 'Forbidden' });
    await app.prisma.device.update({ where: { id }, data: { status: 'revoked' } });
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
    const hash = computed;

    // Derive led brightness (single or first playlist item)
    let ledBrightness: string | null = null;
    if (instruction.type === 'single' && instruction.single.ledBrightness) {
      ledBrightness = instruction.single.ledBrightness;
    } else if (instruction.type === 'playlist' && instruction.playlist.items.length > 0) {
      const first = instruction.playlist.items[0];
      if (first.ledBrightness) ledBrightness = first.ledBrightness;
    }

  // @ts-ignore - ledBrightness added to schema; regenerate prisma client after migration
  await app.prisma.device.update({
      where: { id },
      data: {
        displayInstructionJson: JSON.stringify(instruction),
        displayHash: hash,
        currentDisplayType: instruction.type,
        displayVersion: (d.displayVersion ?? 0) + 1,
  // @ts-ignore
  ledBrightness: ledBrightness ? (ledBrightness === 'mid' ? 'middle' : ledBrightness) : d.ledBrightness,
      },
    });

    return { displayHash: hash };
  });
}









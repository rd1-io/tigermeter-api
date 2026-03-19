import { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import sharp from 'sharp';

// Predefined logo names that are built into firmware (no bitmap transfer needed)
const PREDEFINED_LOGOS = ['binance', 'dollar', 'euro', 'pound', 'yuan', 'ruble', 'bitcoin', 'eth'];

/**
 * Convert image buffer (SVG/PNG/JPG) to 1-bit monochrome bitmap base64.
 * Output: 64x64 pixels, packed into bytes (1=white, 0=black), base64 encoded.
 */
async function imageToBitmapBase64(buffer: Buffer, mimeType: string): Promise<string> {
  // For SVG, sharp needs the buffer as-is; for raster, also fine
  let img = sharp(buffer);

  // If SVG, set density for clean rendering
  if (mimeType === 'image/svg+xml') {
    img = sharp(buffer, { density: 300 });
  }

  // Resize to 64x64, fit inside, white background
  const raw = await img
    .resize(64, 64, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .greyscale()
    .threshold(128)
    .raw()
    .toBuffer();

  // Pack into 1-bit: each pixel is 0 or 255 in raw greyscale
  // Bitmap format: 1 = white, 0 = black (matching firmware BinanceLogo.h format)
  const bytes: number[] = [];
  for (let i = 0; i < 64 * 64; i += 8) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit++) {
      const pixelIdx = i + bit;
      if (pixelIdx < raw.length && raw[pixelIdx] > 128) {
        byte |= (1 << (7 - bit)); // white = 1
      }
    }
    bytes.push(byte);
  }

  return Buffer.from(bytes).toString('base64');
}

export default async function adminLogosRoutes(app: FastifyInstance) {
  // Register multipart support
  app.register(multipart, { limits: { fileSize: 1024 * 1024 } }); // 1MB max

  // List all logos
  app.get('/logos', async (request) => {
    await app.requireAdmin(request);
    const logos = await app.prisma.logo.findMany({
      select: { id: true, name: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return logos;
  });

  // Upload new logo
  app.post('/logos', async (request, reply) => {
    await app.requireAdmin(request);

    const data = await request.file();
    if (!data) return reply.code(400).send({ message: 'No file uploaded' });

    const name = (data.fields as any)?.name?.value as string;
    if (!name || name.length < 1 || name.length > 50) {
      return reply.code(400).send({ message: 'Name required (1-50 chars)' });
    }

    // Check name doesn't conflict with predefined logos
    if (PREDEFINED_LOGOS.includes(name.toLowerCase())) {
      return reply.code(409).send({ message: `Name "${name}" conflicts with a predefined logo` });
    }

    // Check uniqueness
    const existing = await app.prisma.logo.findUnique({ where: { name } });
    if (existing) {
      return reply.code(409).send({ message: `Logo "${name}" already exists` });
    }

    const buffer = await data.toBuffer();
    const mime = data.mimetype;

    if (!['image/svg+xml', 'image/png', 'image/jpeg', 'image/bmp'].includes(mime)) {
      return reply.code(400).send({ message: 'Unsupported format. Use SVG, PNG, JPG, or BMP.' });
    }

    try {
      const bitmapBase64 = await imageToBitmapBase64(buffer, mime);

      const logo = await app.prisma.logo.create({
        data: { name, bitmapBase64 },
      });

      return reply.code(201).send({ id: logo.id, name: logo.name });
    } catch (err: any) {
      return reply.code(500).send({ message: 'Image conversion failed: ' + err.message });
    }
  });

  // Get logo bitmap (for preview)
  app.get('/logos/:id/bitmap', async (request, reply) => {
    await app.requireAdmin(request);
    const { id } = request.params as any;
    const logo = await app.prisma.logo.findUnique({ where: { id } });
    if (!logo) return reply.code(404).send({ message: 'Not found' });
    return { name: logo.name, bitmapBase64: logo.bitmapBase64 };
  });

  // Delete logo
  app.delete('/logos/:id', async (request, reply) => {
    await app.requireAdmin(request);
    const { id } = request.params as any;
    const logo = await app.prisma.logo.findUnique({ where: { id } });
    if (!logo) return reply.code(404).send({ message: 'Not found' });
    await app.prisma.logo.delete({ where: { id } });
    return { deleted: true };
  });
}

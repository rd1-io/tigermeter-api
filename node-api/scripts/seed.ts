import { PrismaClient } from '../generated/prisma';

const prisma = new PrismaClient();

async function main() {
  const mac = 'AA:BB:CC:DD:EE:FF';
  const hmacKey = 'dev_hmac_secret_123';
  const firmwareVersion = '1.0.0';

  const device = await prisma.device.upsert({
    where: { mac },
    create: {
      mac,
      status: 'awaiting_claim',
      hmacKey,
      firmwareVersion,
    },
    update: {
      hmacKey,
      firmwareVersion,
      status: 'awaiting_claim',
    },
  });

  console.log('Seeded device:', { id: device.id, mac: device.mac, hmacKey: device.hmacKey });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { PrismaClient } from '@prisma/client';

// Firmware reports its version as "v36"; plain "36" is accepted too
export const parseFirmwareVersion = (raw: unknown): number | null => {
  if (typeof raw !== 'string') return null;
  const m = /^v?(\d{1,6})$/i.exec(raw.trim());
  return m ? parseInt(m[1], 10) : null;
};

export const AUTO_UPGRADE_SETTING = 'autoUpgradeOutdatedDevices';

export const getBoolSetting = async (prisma: PrismaClient, key: string): Promise<boolean> => {
  const setting = await prisma.setting.findUnique({ where: { key } });
  return setting?.value === 'true';
};

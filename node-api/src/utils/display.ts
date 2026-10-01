import { PrismaClient, Device } from '@prisma/client';
import { z } from 'zod';
import { config } from '../config.js';
import { displayPayloadHash } from './crypto.js';

// 384x168 1-bit, MSB-first, rows top to bottom; 1 = white, 0 = black
export const DISPLAY_BITMAP_BYTES = 8064;

// After this many reboots right after receiving the same frames (never confirmed), the heartbeat
// stops serving them: a device that crashes on frames would otherwise refetch them on every boot.
export const DISPLAY_REBOOT_LIMIT = 2;

// Per-frame LED/beep enums
export const LedColor = z.enum(['green', 'red', 'blue', 'yellow', 'cyan', 'magenta', 'white', 'rainbow', 'off']);
export const LedBrightness = z.enum(['low', 'mid', 'high', 'off']);

// Single display frame
export const DisplayFrame = z.strictObject({
  bitmap: z.string().refine(
    (val) => {
      try {
        const decoded = Buffer.from(val, 'base64');
        return decoded.length === DISPLAY_BITMAP_BYTES;
      } catch { return false; }
    },
    { message: 'bitmap must be valid base64 of exactly 8064 bytes (384x168 1-bit packed)' }
  ),
  ledColor: LedColor,
  ledBrightness: LedBrightness,
  durationSec: z.number().int().min(1).max(86400),
  beep: z.boolean().optional(),
  flashCount: z.number().int().min(0).max(10).optional(),
});

// Full display payload
export const DisplayFramesPayload = z.strictObject({
  frames: z.array(DisplayFrame).min(1).max(8),
  refreshInterval: z.number().int().min(10).max(3600),
});

export type DisplayFramesPayloadType = z.infer<typeof DisplayFramesPayload>;

export const setDeviceDisplay = async (prisma: PrismaClient, device: Device, payload: DisplayFramesPayloadType) => {
  const displayHash = displayPayloadHash(payload);
  const displayVersion = (device.displayVersion ?? 0) + 1;
  await prisma.device.update({
    where: { id: device.id },
    data: {
      displayFramesJson: JSON.stringify(payload),
      displayHash,
      displayVersion,
      displayUpdatedAt: new Date(),
      displayRebootCount: 0,
    },
  });
  return { displayHash, displayVersion };
};

export const deviceDto = (d: Device) => ({
  id: d.id,
  mac: d.mac,
  name: d.name,
  tenantId: d.tenantId,
  externalUserId: d.externalUserId,
  status: d.status,
  lastSeen: d.lastSeen,
  battery: d.battery,
  rssi: d.rssi,
  firmwareVersion: d.firmwareVersion,
  autoUpdate: d.autoUpdate,
  demoMode: d.demoMode,
  displayHash: d.displayHash,
  displayVersion: d.displayVersion,
  createdAt: d.createdAt,
});

// Single-device view: telemetry plus display delivery state, so a caller can see whether the
// device has fetched (delivered) and applied (reported back on the next heartbeat) the current frames
export const deviceStateDto = (d: Device) => {
  let frameCount = 0;
  let refreshInterval: number | null = null;
  if (d.displayFramesJson) {
    try {
      const payload = JSON.parse(d.displayFramesJson);
      frameCount = Array.isArray(payload.frames) ? payload.frames.length : 0;
      refreshInterval = typeof payload.refreshInterval === 'number' ? payload.refreshInterval : null;
    } catch {}
  }
  return {
    ...deviceDto(d),
    ip: d.ip,
    uptimeSeconds: d.uptimeSeconds,
    displayUpdatedAt: d.displayUpdatedAt,
    deliveredDisplayHash: d.deliveredDisplayHash,
    displayDeliveredAt: d.displayDeliveredAt,
    reportedDisplayHash: d.reportedDisplayHash,
    displayRebootCount: d.displayRebootCount,
    displayBlocked: !!d.displayHash && d.displayRebootCount >= DISPLAY_REBOOT_LIMIT,
    frameCount,
    refreshInterval,
    pendingFactoryReset: d.pendingFactoryReset,
    latestFirmwareVersion: config.latestFirmwareVersion,
  };
};

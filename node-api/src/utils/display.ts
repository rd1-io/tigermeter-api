import { PrismaClient, Device } from '@prisma/client';
import { z } from 'zod';
import { config } from '../config.js';
import { displayPayloadHash } from './crypto.js';
import { parseFirmwareVersion } from './firmware.js';
import { effectiveDurations, findFrameByHash, parsePayload, rotationAt } from './rotation.js';

// 384x168 1-bit, MSB-first, rows top to bottom; 1 = white, 0 = black
export const DISPLAY_BITMAP_BYTES = 8064;

// After this many reboots right after receiving the same frames (never confirmed), the heartbeat
// stops serving them: a device that crashes on frames would otherwise refetch them on every boot.
export const DISPLAY_REBOOT_LIMIT = 2;

// Per-frame LED/beep enums
export const LedColor = z.enum(['green', 'red', 'blue', 'yellow', 'cyan', 'magenta', 'white', 'rainbow', 'off']);
export const LedBrightness = z.enum(['low', 'mid', 'high', 'off']);
// Screen refresh for the frame (firmware v39+, ignored by older): auto = partial when replacing a
// frame with periodic full refreshes, full = always full (flashes), partial = partial whenever possible
export const RefreshMode = z.enum(['auto', 'full', 'partial']);

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
  refreshMode: RefreshMode.optional(),
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
      displayOneShotMask: 0,
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

const parseDiagnostics = (json: string | null): Record<string, string | number | boolean> | null => {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
};

// Single-device view: telemetry plus display delivery state. The device holds one frame of the set
// at a time (server-side rotation): `rotation` is the schedule now, `deliveredFrameIndex` the frame
// last sent, `deviceFrameIndex` the frame the device reported in its last heartbeat (= applied).
export const deviceStateDto = (d: Device) => {
  const payload = parsePayload(d.displayFramesJson);
  const setHash = payload ? d.displayHash : null;
  const now = Date.now();
  const point = payload ? rotationAt(payload, d.displayUpdatedAt?.getTime() ?? 0, now) : null;
  const delivered = findFrameByHash(setHash, payload, d.deliveredDisplayHash);
  const reported = findFrameByHash(setHash, payload, d.reportedDisplayHash);
  const fw = parseFirmwareVersion(d.firmwareVersion);
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
    diagnostics: parseDiagnostics(d.diagnosticsJson),
    framesSupported: fw === null || fw >= config.minFramesFirmwareVersion,
    live: {
      active: !!d.liveUntil && d.liveUntil.getTime() > now && !!d.liveIntervalSec,
      until: d.liveUntil,
      intervalSec: d.liveIntervalSec,
    },
    deliveredRefreshInterval: d.deliveredRefreshInterval,
    minFramesFirmwareVersion: config.minFramesFirmwareVersion,
    rotation: payload && point
      ? {
          currentIndex: point.index,
          cycleSec: point.cycleSec,
          nextSwitchInSec: point.secondsToNext == null ? null : Math.round(point.secondsToNext),
          effectiveDurations: effectiveDurations(payload.frames),
          minFrameSec: config.rotationMinFrameSec,
        }
      : null,
    deliveredFrameIndex: delivered?.index ?? null,
    deviceFrameIndex: reported?.index ?? null,
    frameCount: payload?.frames.length ?? 0,
    refreshInterval: payload?.refreshInterval ?? null,
    pendingFactoryReset: d.pendingFactoryReset,
    latestFirmwareVersion: config.latestFirmwareVersion,
  };
};

import { createHash } from 'crypto';
import { config } from '../config.js';

// Server-side frame rotation: devices (no PSRAM) hold one frame, so a stored set of up to 8 frames
// is played by the server — each heartbeat gets the frame that is current by wall clock, and the
// returned refreshInterval brings the device back right after the next switch.

export interface StoredFrame {
  bitmap: string;
  ledColor: string;
  ledBrightness: string;
  durationSec: number;
  beep?: boolean;
  flashCount?: number;
}

export interface StoredPayload {
  frames: StoredFrame[];
  refreshInterval: number;
}

// The device redraws a frame when its durationSec expires; one held frame must not expire
export const DEVICE_HOLD_SEC = 86400;

export const parsePayload = (json: string | null): StoredPayload | null => {
  if (!json) return null;
  try {
    const p = JSON.parse(json);
    return Array.isArray(p?.frames) && p.frames.length > 0 ? p : null;
  } catch {
    return null;
  }
};

export const hasOneShot = (f: StoredFrame) => !!f.beep || (f.flashCount ?? 0) > 0;

// Shorter frames are stretched: a heartbeat more often than this isn't worth the traffic
export const effectiveDurations = (frames: StoredFrame[]) =>
  frames.map((f) => Math.max(f.durationSec, config.rotationMinFrameSec));

export interface RotationPoint {
  index: number;
  count: number;
  cycleSec: number | null;     // null for a single frame (no rotation)
  secondsToNext: number | null; // from `atMs` to the next switch
}

export const rotationAt = (payload: StoredPayload, cycleStartMs: number, atMs: number): RotationPoint => {
  const count = payload.frames.length;
  if (count <= 1) return { index: 0, count, cycleSec: null, secondsToNext: null };
  const d = effectiveDurations(payload.frames);
  const cycleSec = d.reduce((a, b) => a + b, 0);
  let t = (Math.max(0, atMs - cycleStartMs) / 1000) % cycleSec;
  let index = 0;
  while (index < count - 1 && t >= d[index]) {
    t -= d[index];
    index++;
  }
  return { index, count, cycleSec, secondsToNext: d[index] - t };
};

// Hash of a frame as delivered to the device. A single frame keeps the set hash, so for one-frame
// sets reportedDisplayHash === displayHash still means "applied". The one-shot variant differs
// because its content (beep/flash) differs.
export const frameDeliveryHash = (setHash: string, count: number, index: number, withOneShot: boolean) => {
  if (count <= 1) return setHash;
  const h = createHash('sha256').update(`${setHash}#${index}${withOneShot ? '!' : ''}`).digest('hex');
  return `sha256:${h}`;
};

// Which frame of the current set a delivery hash refers to
export const findFrameByHash = (setHash: string | null, payload: StoredPayload | null, hash: string | null | undefined) => {
  if (!setHash || !payload || !hash) return null;
  const count = payload.frames.length;
  for (let i = 0; i < count; i++) {
    if (frameDeliveryHash(setHash, count, i, false) === hash) return { index: i, withOneShot: false };
    if (hasOneShot(payload.frames[i]) && frameDeliveryHash(setHash, count, i, true) === hash) return { index: i, withOneShot: true };
  }
  return null;
};

// Interval for the next heartbeat. The firmware keeps the interval from the last delivery while the
// hash matches, so split the wait into equal steps of at most refreshInterval that end just after
// the switch.
export const heartbeatInterval = (refreshInterval: number, secondsUntilSwitch: number | null) => {
  if (secondsUntilSwitch == null) return refreshInterval;
  const floor = Math.min(config.rotationMinFrameSec, refreshInterval);
  const target = Math.ceil(secondsUntilSwitch + config.rotationMarginSec);
  const steps = Math.max(1, Math.ceil(target / refreshInterval));
  return Math.max(floor, Math.ceil(target / steps));
};

export interface FrameToServe {
  index: number;
  count: number;
  hash: string;
  withOneShot: boolean;
  frame: StoredFrame;          // as sent to the device
  refreshInterval: number;
  oneShotMask: number;         // updated mask of frames whose beep/flash was already delivered
}

// The frame to send now. Switches up to rotationEarlySwitchSec early, so a heartbeat that arrives a
// little before the switch doesn't keep the old frame for a whole extra interval.
export const frameToServe = (
  setHash: string,
  payload: StoredPayload,
  cycleStartMs: number,
  nowMs: number,
  oneShotMask: number,
): FrameToServe => {
  const early = payload.frames.length > 1 ? config.rotationEarlySwitchSec : 0;
  const point = rotationAt(payload, cycleStartMs, nowMs + early * 1000);
  const src = payload.frames[point.index];
  const bit = 1 << point.index;
  const withOneShot = hasOneShot(src) && (oneShotMask & bit) === 0;
  const frame: StoredFrame = {
    ...src,
    durationSec: DEVICE_HOLD_SEC,
    beep: withOneShot ? !!src.beep : false,
    flashCount: withOneShot ? src.flashCount ?? 0 : 0,
  };
  return {
    index: point.index,
    count: point.count,
    hash: frameDeliveryHash(setHash, point.count, point.index, withOneShot),
    withOneShot,
    frame,
    refreshInterval: heartbeatInterval(payload.refreshInterval, point.secondsToNext == null ? null : point.secondsToNext + early),
    oneShotMask: withOneShot ? oneShotMask | bit : oneShotMask,
  };
};

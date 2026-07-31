import { createHash, randomBytes, timingSafeEqual, createHmac } from 'crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';

// Recursively sort all keys in an object for deterministic JSON
const sortObjectKeys = (obj: unknown): unknown => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
};

// displayPayloadHash: recursive sorted-keys JSON → sha256
// Hash covers ALL fields including beep/flashCount (no strip logic).
export const displayPayloadHash = (obj: unknown): string => {
  // Create a copy without the hash field to avoid circular dependency
  const copy = { ...(obj as Record<string, unknown>) };
  delete copy.hash;
  // Sort ALL keys recursively for deterministic hashing
  const sorted = sortObjectKeys(copy);
  const json = JSON.stringify(sorted);
  const hash = createHash('sha256').update(json).digest('hex');
  return `sha256:${hash}`;
};

export const hashPassword = async (plaintext: string): Promise<string> => bcrypt.hash(plaintext, 10);
export const verifyPassword = async (plaintext: string, hashed: string): Promise<boolean> => bcrypt.compare(plaintext, hashed);

export const generateDeviceSecret = (): string => {
  const raw = randomBytes(config.deviceSecretLength / 2).toString('hex');
  return `${config.deviceSecretPrefix}${raw}`;
};

export const normalizeMac = (raw: string): string | null => {
  if (!raw) return null;
  const hex = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g)!.join(':');
};

export const createClaimHmac = (mac: string, firmwareVersion?: string, timestamp?: number): string => {
  const ts = timestamp || Date.now();
  const payload = `${mac}:${firmwareVersion || ''}:${ts}`;
  return createHmac('sha256', config.hmacKey).update(payload).digest('hex');
};

export const verifyClaimHmac = (mac: string, hmac: string, firmwareVersion?: string, timestamp?: number, toleranceMs: number = 300000): boolean => {
  const ts = timestamp || Date.now();
  const expected = createClaimHmac(mac, firmwareVersion, ts);
  return timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'));
};
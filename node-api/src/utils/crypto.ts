import { createHash, randomBytes, timingSafeEqual, createHmac } from 'crypto';
import * as jose from 'jose';
import bcrypt from 'bcrypt';
import { config } from '../config.js';

export const canonicalJson = (obj: unknown): string => JSON.stringify(obj, Object.keys(obj as object).sort(), 0).replace(/\s+/g, '');

export const instructionHash = (obj: unknown): string => {
  const json = JSON.stringify(obj, Object.keys(obj as object).sort());
  const hash = createHash('sha256').update(json).digest('hex');
  return `sha256:${hash}`;
};

export const hashPassword = async (plaintext: string): Promise<string> => bcrypt.hash(plaintext, 10);
export const verifyPassword = async (plaintext: string, hashed: string): Promise<boolean> => bcrypt.compare(plaintext, hashed);

export const generateDeviceSecret = (): string => {
  const raw = randomBytes(config.deviceSecretLength / 2).toString('hex');
  return `${config.deviceSecretPrefix}${raw}`;
};

export const signJwt = async (payload: object): Promise<string> => {
  const key = new TextEncoder().encode(config.jwtSecret);
  return new jose.SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).sign(key);
};

export const verifyJwt = async (token: string): Promise<Record<string, any>> => {
  const key = new TextEncoder().encode(config.jwtSecret);
  const { payload } = await jose.jwtVerify(token, key);
  return payload as Record<string, any>;
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









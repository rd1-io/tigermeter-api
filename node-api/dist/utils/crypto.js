import { createHash, randomBytes, timingSafeEqual, createHmac } from 'crypto';
import * as jose from 'jose';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
export const canonicalJson = (obj) => JSON.stringify(obj, Object.keys(obj).sort(), 0).replace(/\s+/g, '');
// Recursively sort all keys in an object for deterministic JSON
const sortObjectKeys = (obj) => {
    if (obj === null || typeof obj !== 'object')
        return obj;
    if (Array.isArray(obj))
        return obj.map(sortObjectKeys);
    const sorted = {};
    for (const key of Object.keys(obj).sort()) {
        sorted[key] = sortObjectKeys(obj[key]);
    }
    return sorted;
};
export const instructionHash = (obj) => {
    // Create a copy without the hash field to avoid circular dependency
    const copy = { ...obj };
    delete copy.hash;
    // Sort ALL keys recursively for deterministic hashing
    const sorted = sortObjectKeys(copy);
    const json = JSON.stringify(sorted);
    const hash = createHash('sha256').update(json).digest('hex');
    return `sha256:${hash}`;
};
export const hashPassword = async (plaintext) => bcrypt.hash(plaintext, 10);
export const verifyPassword = async (plaintext, hashed) => bcrypt.compare(plaintext, hashed);
export const generateDeviceSecret = () => {
    const raw = randomBytes(config.deviceSecretLength / 2).toString('hex');
    return `${config.deviceSecretPrefix}${raw}`;
};
export const signJwt = async (payload) => {
    const key = new TextEncoder().encode(config.jwtSecret);
    return new jose.SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).sign(key);
};
export const verifyJwt = async (token) => {
    const key = new TextEncoder().encode(config.jwtSecret);
    const { payload } = await jose.jwtVerify(token, key);
    return payload;
};
export const normalizeMac = (raw) => {
    if (!raw)
        return null;
    const hex = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    if (hex.length !== 12)
        return null;
    return hex.match(/.{2}/g).join(':');
};
export const createClaimHmac = (mac, firmwareVersion, timestamp) => {
    const ts = timestamp || Date.now();
    const payload = `${mac}:${firmwareVersion || ''}:${ts}`;
    return createHmac('sha256', config.hmacKey).update(payload).digest('hex');
};
export const verifyClaimHmac = (mac, hmac, firmwareVersion, timestamp, toleranceMs = 300000) => {
    const ts = timestamp || Date.now();
    const expected = createClaimHmac(mac, firmwareVersion, ts);
    return timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'));
};

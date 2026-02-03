// JWT utilities for emulator testing
// Note: In production, JWT tokens would be obtained through proper authentication flow

import { SignJWT } from 'jose';

// This should match the backend's JWT secret
// Read from env variable for production, fallback to dev default
const JWT_SECRET = import.meta.env.VITE_JWT_SECRET || 'change-me-dev';

export interface UserPayload {
  sub?: string;
  userId?: string;
  role: 'user' | 'admin';
}

/**
 * Create a JWT token for emulator testing
 * In production, this would be handled by the authentication service
 */
export async function createTestJWT(payload: UserPayload): Promise<string> {
  const key = new TextEncoder().encode(JWT_SECRET);
  
  return new SignJWT({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
  })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(key);
}

/**
 * Create a test user JWT token
 */
export async function createTestUserToken(userId: string = 'test-user-123'): Promise<string> {
  return createTestJWT({
    sub: userId,
    userId,
    role: 'user'
  });
}

/**
 * Create a test admin JWT token
 */
export async function createTestAdminToken(userId: string = 'test-admin-456'): Promise<string> {
  return createTestJWT({
    sub: userId,
    userId,
    role: 'admin'
  });
}
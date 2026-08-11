import { randomBytes } from 'node:crypto';

import { compare, hash } from 'bcryptjs';

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return compare(password, passwordHash);
}

// Used by POST /api/users (admin-created users): this app has no outbound email/SMTP
// integration, so rather than a password field on the request, a cryptographically random
// temporary password is generated server-side and returned once in the response body
// instead. base64url keeps it JSON/URL-safe; 18 random bytes -> 24 chars, comfortably within
// [8, 72] (registerSchema's bcrypt-input-cap range) with no schema changes needed to accept it.
export function generateTemporaryPassword(): string {
  return randomBytes(18).toString('base64url');
}

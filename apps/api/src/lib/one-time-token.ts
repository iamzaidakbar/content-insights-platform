import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 24 * 60 * 60 * 1000;

export function generateOneTimeToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashOneTimeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

import { redisConnection } from './queue.js';

// Server-side refresh-token registry: every issued refresh token's jti is stored in
// Redis for its lifetime; a refresh token that isn't in the store is rejected even if
// its JWT signature is valid. This is what makes logout / password-change revocation
// and one-time-use rotation real rather than cosmetic.

export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // keep in sync with jwt.ts's '7d'

const tokenKey = (jti: string): string => `refresh:${jti}`;
const userSetKey = (userId: string): string => `refresh_user:${userId}`;

export async function registerRefreshToken(jti: string, userId: string): Promise<void> {
  await redisConnection
    .multi()
    .set(tokenKey(jti), userId, 'EX', REFRESH_TOKEN_TTL_SECONDS)
    .sadd(userSetKey(userId), jti)
    .expire(userSetKey(userId), REFRESH_TOKEN_TTL_SECONDS)
    .exec();
}

// One-time-use consumption (rotation): atomically fetch-and-delete. Returns false if the
// token was never registered, already used, or revoked — callers treat that as a hard 401.
export async function consumeRefreshToken(jti: string, userId: string): Promise<boolean> {
  const stored = await redisConnection.getdel(tokenKey(jti));
  await redisConnection.srem(userSetKey(userId), jti);
  return stored === userId;
}

export async function revokeAllRefreshTokensForUser(userId: string): Promise<void> {
  const jtis = await redisConnection.smembers(userSetKey(userId));
  const pipeline = redisConnection.multi();
  for (const jti of jtis) {
    pipeline.del(tokenKey(jti));
  }
  pipeline.del(userSetKey(userId));
  await pipeline.exec();
}

// ---------------------------------------------------------------------------
// Login attempt lockout
// ---------------------------------------------------------------------------

const LOCKOUT_WINDOW_SECONDS = 15 * 60;
const LOCKOUT_MAX_ATTEMPTS = 5;

const attemptsKey = (email: string): string => `login_fail:${email.toLowerCase().trim()}`;

/** Returns true when the account is locked out (too many recent failures). */
export async function isLockedOut(email: string): Promise<boolean> {
  const attempts = await redisConnection.get(attemptsKey(email));
  return attempts !== null && Number(attempts) >= LOCKOUT_MAX_ATTEMPTS;
}

export async function recordFailedLogin(email: string): Promise<void> {
  const key = attemptsKey(email);
  const attempts = await redisConnection.incr(key);
  if (attempts === 1) {
    await redisConnection.expire(key, LOCKOUT_WINDOW_SECONDS);
  }
}

export async function clearFailedLogins(email: string): Promise<void> {
  await redisConnection.del(attemptsKey(email));
}

// ---------------------------------------------------------------------------
// OIDC state (CSRF) tokens
// ---------------------------------------------------------------------------

const OIDC_STATE_TTL_SECONDS = 10 * 60;
const oidcStateKey = (state: string): string => `oidc_state:${state}`;

export async function storeOidcState(state: string): Promise<void> {
  await redisConnection.set(oidcStateKey(state), '1', 'EX', OIDC_STATE_TTL_SECONDS);
}

export async function consumeOidcState(state: string): Promise<boolean> {
  const stored = await redisConnection.getdel(oidcStateKey(state));
  return stored === '1';
}

import { redisConnection } from './queue.js';

// Server-side refresh-token registry: every issued refresh token's jti is stored in
// Redis for its lifetime; a refresh token that isn't in the store is rejected even if
// its JWT signature is valid. This is what makes logout / password-change revocation
// and one-time-use rotation real rather than cosmetic.

export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // keep in sync with jwt.ts's '7d'

const tokenKey = (jti: string): string => `refresh:${jti}`;
const userSetKey = (userId: string): string => `refresh_user:${userId}`;

export interface RefreshSessionRecord {
  userId: string;
  createdAt: string;
  userAgent?: string;
  ip?: string;
}

function parseSessionRecord(raw: string | null, fallbackUserId?: string): RefreshSessionRecord | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as RefreshSessionRecord;
    if (parsed && typeof parsed.userId === 'string') {
      return parsed;
    }
  } catch {
    // Pre-migration values were a bare userId string.
    if (fallbackUserId && raw === fallbackUserId) {
      return { userId: raw, createdAt: new Date().toISOString() };
    }
    if (!raw.startsWith('{')) {
      return { userId: raw, createdAt: new Date().toISOString() };
    }
  }
  return null;
}

export async function registerRefreshToken(
  jti: string,
  userId: string,
  meta?: { userAgent?: string; ip?: string },
): Promise<void> {
  const record: RefreshSessionRecord = {
    userId,
    createdAt: new Date().toISOString(),
    ...(meta?.userAgent ? { userAgent: meta.userAgent } : {}),
    ...(meta?.ip ? { ip: meta.ip } : {}),
  };
  await redisConnection
    .multi()
    .set(tokenKey(jti), JSON.stringify(record), 'EX', REFRESH_TOKEN_TTL_SECONDS)
    .sadd(userSetKey(userId), jti)
    .expire(userSetKey(userId), REFRESH_TOKEN_TTL_SECONDS)
    .exec();
}

// One-time-use consumption (rotation): atomically fetch-and-delete. Returns false if the
// token was never registered, already used, or revoked — callers treat that as a hard 401.
export async function consumeRefreshToken(jti: string, userId: string): Promise<boolean> {
  const stored = await redisConnection.getdel(tokenKey(jti));
  await redisConnection.srem(userSetKey(userId), jti);
  const record = parseSessionRecord(stored, userId);
  return record?.userId === userId;
}

export async function listRefreshSessions(
  userId: string,
): Promise<Array<RefreshSessionRecord & { jti: string }>> {
  const jtis = await redisConnection.smembers(userSetKey(userId));
  if (jtis.length === 0) {
    return [];
  }
  const values = await redisConnection.mget(jtis.map(tokenKey));
  const sessions: Array<RefreshSessionRecord & { jti: string }> = [];
  for (let i = 0; i < jtis.length; i += 1) {
    const jti = jtis[i];
    if (!jti) continue;
    const record = parseSessionRecord(values[i] ?? null, userId);
    if (record?.userId === userId) {
      sessions.push({ ...record, jti });
    }
  }
  sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return sessions;
}

export async function revokeRefreshToken(jti: string, userId: string): Promise<boolean> {
  const stored = await redisConnection.get(tokenKey(jti));
  const record = parseSessionRecord(stored, userId);
  if (!record || record.userId !== userId) {
    return false;
  }
  await redisConnection.multi().del(tokenKey(jti)).srem(userSetKey(userId), jti).exec();
  return true;
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

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';

import type { ApiError } from '@content-insights/shared';

import { redisConnection } from '../lib/queue.js';

const MINUTE_MS = 60_000;

function createRedisStore(prefix: string): RedisStore {
  // rate-limit-redis speaks to Redis via raw commands; ioredis's `.call(command, ...args)`
  // splits the command name from its arguments (rather than one flat array), so the
  // incoming args tuple is split accordingly. Reuses the same ioredis connection BullMQ
  // already holds open rather than opening a second Redis client.
  return new RedisStore({
    sendCommand: (...args: string[]) => {
      const [command, ...rest] = args;
      if (!command) {
        throw new Error('rate-limit-redis called sendCommand with no command');
      }
      return redisConnection.call(command, ...rest) as ReturnType<RedisStore['sendCommand']>;
    },
    prefix,
  });
}

function rateLimitedResponse(res: import('express').Response, message: string, requestId: string): void {
  res.status(429).json({
    success: false,
    message,
    code: 'RATE_LIMITED',
    requestId,
  } satisfies ApiError);
}

// 100 requests/minute per IP, applied to the whole /api/auth surface — protects
// login/register/refresh against credential-stuffing and brute-force attempts.
export const authRateLimiter = rateLimit({
  windowMs: MINUTE_MS,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore('rl:auth:'),
  handler: (req, res) => {
    rateLimitedResponse(res, 'Too many authentication requests. Please try again later.', req.id);
  },
});

// 300 requests/minute per ORG (not per IP) — a shared office/NAT IP shouldn't throttle
// every user in a different org, and one heavy org shouldn't be able to starve search
// for everyone else sharing an IP. Falls back to IP-based keying only for the (should be
// unreachable, since this runs after `authenticate`) case of an unauthenticated caller.
export const searchRateLimiter = rateLimit({
  windowMs: MINUTE_MS,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore('rl:search:'),
  keyGenerator: (req) => req.user?.orgId ?? ipKeyGenerator(req.ip ?? 'unknown'),
  handler: (req, res) => {
    rateLimitedResponse(
      res,
      'Too many search requests for this organization. Please try again later.',
      req.id,
    );
  },
});

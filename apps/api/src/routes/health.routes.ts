import express from 'express';
import mongoose from 'mongoose';

import { esClient } from '../lib/elasticsearch.js';
import { redisConnection } from '../lib/queue.js';
import { logger } from '../lib/logger.js';

export const healthRouter = express.Router();

type PingStatus = 'ok' | 'degraded';

const PING_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ping timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

async function pingMongo(): Promise<PingStatus> {
  try {
    const db = mongoose.connection.db;
    if (mongoose.connection.readyState !== 1 || !db) {
      return 'degraded';
    }
    await withTimeout(db.admin().ping(), PING_TIMEOUT_MS);
    return 'ok';
  } catch (err) {
    logger.warn({ err }, 'mongo health ping failed');
    return 'degraded';
  }
}

async function pingElasticsearch(): Promise<PingStatus> {
  try {
    const alive = await withTimeout(esClient.ping(), PING_TIMEOUT_MS);
    return alive ? 'ok' : 'degraded';
  } catch (err) {
    logger.warn({ err }, 'elasticsearch health ping failed');
    return 'degraded';
  }
}

async function pingRedis(): Promise<PingStatus> {
  try {
    const reply = await withTimeout(redisConnection.ping(), PING_TIMEOUT_MS);
    return reply === 'PONG' ? 'ok' : 'degraded';
  } catch (err) {
    logger.warn({ err }, 'redis health ping failed');
    return 'degraded';
  }
}

// Deliberately unauthenticated and unrated-limited — orchestrators/load balancers hit
// this without credentials, and it must stay responsive even under abuse elsewhere.
healthRouter.get('/', async (_req, res) => {
  const [mongo, elasticsearch, redis] = await Promise.all([
    pingMongo(),
    pingElasticsearch(),
    pingRedis(),
  ]);

  const status: PingStatus = mongo === 'ok' && elasticsearch === 'ok' && redis === 'ok' ? 'ok' : 'degraded';

  res.status(200).json({ status, mongo, elasticsearch, redis });
});

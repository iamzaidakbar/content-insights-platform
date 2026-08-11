// Must run before any module that imports lib/config.ts.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/ci-test';
process.env.ELASTICSEARCH_URL = process.env.ELASTICSEARCH_URL ?? 'http://127.0.0.1:9200';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-access-secret-at-least-32-chars';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-at-least-32-chars';

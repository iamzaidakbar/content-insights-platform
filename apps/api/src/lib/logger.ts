import pino from 'pino';

// JSON in production (the default pino behavior — cheap to produce, easy for log
// aggregators to ingest); pretty-printed in every other environment for human eyes.
// LOG_LEVEL is read at process start — no runtime reconfiguration needed for this app.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(process.env.NODE_ENV !== 'production'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
});

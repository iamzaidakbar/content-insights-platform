import 'dotenv/config';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type Request, type Response } from 'express';
import helmet from 'helmet';

import { NotFoundError } from './lib/errors.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { requestLogger } from './middleware/requestLogger.js';
import { authRouter } from './routes/auth.routes.js';
import { documentRouter } from './routes/document.routes.js';
import { healthRouter } from './routes/health.routes.js';
import { projectRouter } from './routes/project.routes.js';
import { roleRouter } from './routes/role.routes.js';
import { searchRouter } from './routes/search.routes.js';
import { settingsRouter } from './routes/settings.routes.js';
import { userRouter } from './routes/user.routes.js';

export function createApp(): Express {
  const app = express();

  // Must run before everything else — every subsequent middleware/handler (including
  // the error handler) relies on req.id/req.log already being set.
  app.use(requestId);
  app.use(requestLogger);

  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());

  // Plain liveness probe — kept separate from /api/health's dependency pings so a
  // container orchestrator's basic "is the process up" check never itself depends on
  // Mongo/ES/Redis being reachable.
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });
  app.use('/api/health', healthRouter);

  app.use('/api/auth', authRouter);
  app.use('/api/documents', documentRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/projects', projectRouter);
  app.use('/api/roles', roleRouter);
  app.use('/api/users', userRouter);
  app.use('/api/settings', settingsRouter);

  // No route matched — respond with the same JSON envelope every other error uses,
  // instead of Express's default HTML 404 page.
  app.use((req: Request, _res: Response) => {
    throw new NotFoundError(`Cannot ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND');
  });

  app.use(errorHandler);

  return app;
}

export default createApp;

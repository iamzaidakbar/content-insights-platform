import 'dotenv/config';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type Request, type Response } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { errorHandler } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.routes.js';
import { documentRouter } from './routes/document.routes.js';
import { projectRouter } from './routes/project.routes.js';
import { roleRouter } from './routes/role.routes.js';
import { searchRouter } from './routes/search.routes.js';
import { userRouter } from './routes/user.routes.js';

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
      credentials: true,
    }),
  );
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  app.use(express.json());
  app.use(cookieParser());

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/documents', documentRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/projects', projectRouter);
  app.use('/api/roles', roleRouter);
  app.use('/api/users', userRouter);

  app.use(errorHandler);

  return app;
}

export default createApp;

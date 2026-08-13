import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { NotFoundError } from '../lib/errors.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { requestId } from '../middleware/requestId.js';
import { userRouter } from './user.routes.js';

const SAMPLE_USER_ID = '507f1f77bcf86cd799439011';

function usersApp() {
  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.use('/api/users', userRouter);
  app.use((req: Request, _res: Response) => {
    throw new NotFoundError(`Cannot ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND');
  });
  app.use(errorHandler);
  return app;
}

describe('user status routes', () => {
  const app = usersApp();

  it('registers PATCH /api/users/:id/activate', async () => {
    const res = await request(app).patch(`/api/users/${SAMPLE_USER_ID}/activate`);
    expect(res.body.code).not.toBe('ROUTE_NOT_FOUND');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('registers PATCH /api/users/:id/deactivate', async () => {
    const res = await request(app).patch(`/api/users/${SAMPLE_USER_ID}/deactivate`);
    expect(res.body.code).not.toBe('ROUTE_NOT_FOUND');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('registers PATCH /api/users/:id/status', async () => {
    const res = await request(app).patch(`/api/users/${SAMPLE_USER_ID}/status`).send({ isActive: true });
    expect(res.body.code).not.toBe('ROUTE_NOT_FOUND');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });
});

import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { NotFoundError } from '../lib/errors.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { requestId } from '../middleware/requestId.js';
import { groupRouter } from './group.routes.js';

const SAMPLE_GROUP_ID = '507f1f77bcf86cd799439011';
const SAMPLE_PROJECT_ID = '507f1f77bcf86cd799439012';

function groupsApp() {
  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.use('/api/groups', groupRouter);
  app.use((req: Request, _res: Response) => {
    throw new NotFoundError(`Cannot ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND');
  });
  app.use(errorHandler);
  return app;
}

describe('group default-query routes', () => {
  const app = groupsApp();

  it('registers GET /api/groups/:id/default-queries', async () => {
    const res = await request(app).get(`/api/groups/${SAMPLE_GROUP_ID}/default-queries`);
    expect(res.body.code).not.toBe('ROUTE_NOT_FOUND');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('registers PUT /api/groups/:id/default-query', async () => {
    const res = await request(app)
      .put(`/api/groups/${SAMPLE_GROUP_ID}/default-query`)
      .send({ projectId: SAMPLE_PROJECT_ID, savedSearchId: null });
    expect(res.body.code).not.toBe('ROUTE_NOT_FOUND');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });
});

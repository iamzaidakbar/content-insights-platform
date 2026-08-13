import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { NotFoundError } from '../lib/errors.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { requestId } from '../middleware/requestId.js';
import { auditRouter } from './audit.routes.js';
import { teamsRouter } from './teams.routes.js';

function mountApp(path: string, router: express.Router) {
  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.use(path, router);
  app.use((req: Request, _res: Response) => {
    throw new NotFoundError(`Cannot ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND');
  });
  app.use(errorHandler);
  return app;
}

describe('audit export route', () => {
  const app = mountApp('/api/audit', auditRouter);

  it('registers GET /api/audit/export', async () => {
    const res = await request(app).get('/api/audit/export');
    expect(res.body.code).not.toBe('ROUTE_NOT_FOUND');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });
});

describe('teams share history route', () => {
  const app = mountApp('/api/teams', teamsRouter);

  it('registers GET /api/teams/shares', async () => {
    const res = await request(app).get('/api/teams/shares');
    expect(res.body.code).not.toBe('ROUTE_NOT_FOUND');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });
});

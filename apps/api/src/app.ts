import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type Request, type Response } from 'express';
import helmet from 'helmet';

import { config } from './lib/config.js';
import { NotFoundError } from './lib/errors.js';
import { errorHandler } from './middleware/errorHandler.js';
import { apiRateLimiter } from './middleware/rateLimiters.js';
import { requestId } from './middleware/requestId.js';
import { requestLogger } from './middleware/requestLogger.js';
import { adminRouter } from './routes/admin.routes.js';
import { articleRouter } from './routes/article.routes.js';
import { auditRouter } from './routes/audit.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { channelRouter } from './routes/channel.routes.js';
import { conceptRouter } from './routes/concept.routes.js';
import { dashboardRouter } from './routes/dashboard.routes.js';
import { entityMappingRouter } from './routes/entityMapping.routes.js';
import { groupRouter } from './routes/group.routes.js';
import { healthRouter } from './routes/health.routes.js';
import { insightRouter } from './routes/insight.routes.js';
import { notificationRouter } from './routes/notification.routes.js';
import { organizationRouter } from './routes/organization.routes.js';
import { projectRouter } from './routes/project.routes.js';
import { roleRouter } from './routes/role.routes.js';
import { savedSearchRouter } from './routes/savedSearch.routes.js';
import { searchRouter } from './routes/search.routes.js';
import { settingsRouter } from './routes/settings.routes.js';
import { teamsRouter } from './routes/teams.routes.js';
import { userRouter } from './routes/user.routes.js';
import { userTagRouter } from './routes/userTag.routes.js';

export function createApp(): Express {
  const app = express();

  // Must run before everything else — every subsequent middleware/handler (including
  // the error handler) relies on req.id/req.log already being set.
  app.use(requestId);
  app.use(requestLogger);

  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigin,
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

  // Global per-IP backstop for the whole API surface; endpoint-specific limiters
  // (auth, search, upload) still apply their own tighter budgets on top.
  app.use('/api', apiRateLimiter);

  app.use('/api/auth', authRouter);
  app.use('/api/articles', articleRouter);
  app.use('/api/projects', projectRouter);
  app.use('/api/concepts', conceptRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/groups', groupRouter);
  app.use('/api/organizations', organizationRouter);
  app.use('/api/roles', roleRouter);
  app.use('/api/users', userRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/user-tags', userTagRouter);
  app.use('/api/saved-searches', savedSearchRouter);
  app.use('/api/channels', channelRouter);
  app.use('/api/insights', insightRouter);
  app.use('/api/dashboards', dashboardRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/notifications', notificationRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/entity-mapping', entityMappingRouter);
  app.use('/api/teams', teamsRouter);

  // No route matched — respond with the same JSON envelope every other error uses,
  // instead of Express's default HTML 404 page.
  app.use((req: Request, _res: Response) => {
    throw new NotFoundError(`Cannot ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND');
  });

  app.use(errorHandler);

  return app;
}

export default createApp;

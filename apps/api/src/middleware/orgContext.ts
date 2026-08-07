import type { NextFunction, Request, Response } from 'express';

import { asyncHandler } from '../lib/async-handler.js';
import { AppError } from '../lib/errors.js';
import { toOrganizationDTO } from '../lib/serializers.js';
import { OrganizationModel } from '../models/organization.model.js';

async function orgContextHandler(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!req.orgId) {
    next(new AppError(401, 'UNAUTHORIZED', 'Missing authenticated organization context'));
    return;
  }

  const orgDoc = await OrganizationModel.findById(req.orgId);
  if (!orgDoc) {
    next(new AppError(404, 'ORG_NOT_FOUND', 'Organization no longer exists'));
    return;
  }

  req.org = toOrganizationDTO(orgDoc);
  next();
}

export const orgContext = asyncHandler(orgContextHandler);

import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/jwt.js';

const BEARER_PREFIX = 'Bearer ';

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    next(new AppError(401, 'UNAUTHORIZED', 'Missing bearer token'));
    return;
  }

  const token = header.slice(BEARER_PREFIX.length);

  try {
    const claims = verifyAccessToken(token);
    req.user = {
      id: claims.sub,
      orgId: claims.orgId,
      roles: claims.roles,
      permissions: claims.permissions,
    };
    req.orgId = claims.orgId;
    next();
  } catch {
    next(new AppError(401, 'UNAUTHORIZED', 'Invalid or expired access token'));
  }
}

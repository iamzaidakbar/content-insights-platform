import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppError } from '../lib/errors.js';

export function requirePermission(permissionKey: string): RequestHandler {
  return function requirePermissionMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void {
    const permissions = req.user?.permissions ?? [];
    if (permissions.includes('*') || permissions.includes(permissionKey)) {
      next();
      return;
    }

    next(new AppError(403, 'FORBIDDEN', `Missing required permission: ${permissionKey}`));
  };
}

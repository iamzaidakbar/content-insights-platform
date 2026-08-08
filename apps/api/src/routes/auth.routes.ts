import express from 'express';

import {
  asOrgId,
  asUserId,
  loginSchema,
  registerSchema,
  type AuthSession,
  type UserId,
} from '@content-insights/shared';

import { asyncHandler } from '../lib/async-handler.js';
import { clearRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from '../lib/cookies.js';
import { AppError } from '../lib/errors.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { flattenPermissions } from '../lib/permissions.js';
import { success } from '../lib/response.js';
import { toOrganizationDTO, toUserDTO } from '../lib/serializers.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { OrganizationModel, type OrganizationDocument } from '../models/organization.model.js';
import { RoleModel, type RoleDocument } from '../models/role.model.js';
import { UserModel, type UserDocument } from '../models/user.model.js';
import { createOrganization } from '../services/organization.service.js';

export const authRouter = express.Router();

interface IssuedSession {
  authSession: AuthSession;
  refreshToken: string;
}

function issueSession(
  user: UserDocument,
  org: OrganizationDocument,
  roles: RoleDocument[],
): IssuedSession {
  const userId = asUserId(user._id.toString());
  const orgId = asOrgId(org._id.toString());
  const permissions = flattenPermissions(roles);

  const accessToken = signAccessToken({
    sub: userId,
    orgId,
    roles: roles.map((role) => role.name),
    permissions,
  });
  const refreshToken = signRefreshToken(userId);

  return {
    authSession: {
      accessToken,
      user: toUserDTO(user),
      org: toOrganizationDTO(org),
      permissions,
    },
    refreshToken,
  };
}

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message ?? 'Invalid request body',
      );
    }

    const { email, password, orgName } = parsed.data;
    const passwordHash = await hashPassword(password);

    const created = await createOrganization({ orgName, email, passwordHash });

    const { authSession, refreshToken } = issueSession(created.user, created.org, created.roles);
    setRefreshCookie(res, refreshToken);
    res.status(201).json(success(authSession));
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message ?? 'Invalid request body',
      );
    }

    const { email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase().trim();

    const user = await UserModel.findOne({ email: normalizedEmail });
    if (!user) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const passwordValid = await verifyPassword(password, user.passwordHash);
    if (!passwordValid) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const [org, roles] = await Promise.all([
      OrganizationModel.findById(user.orgId),
      RoleModel.find({ _id: { $in: user.roles } }),
    ]);
    if (!org) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Associated organization no longer exists');
    }

    const { authSession, refreshToken } = issueSession(user, org, roles);
    setRefreshCookie(res, refreshToken);
    res.status(200).json(success(authSession));
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const cookieToken: unknown = req.cookies[REFRESH_COOKIE_NAME];
    if (typeof cookieToken !== 'string' || cookieToken.length === 0) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Missing refresh token');
    }

    let userId: UserId;
    try {
      userId = verifyRefreshToken(cookieToken);
    } catch {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token');
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'User no longer exists');
    }

    const [org, roles] = await Promise.all([
      OrganizationModel.findById(user.orgId),
      RoleModel.find({ _id: { $in: user.roles } }),
    ]);
    if (!org) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Associated organization no longer exists');
    }

    const { authSession, refreshToken } = issueSession(user, org, roles);
    setRefreshCookie(res, refreshToken);
    res.status(200).json(success(authSession));
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (_req, res) => {
    clearRefreshCookie(res);
    res.status(200).json(success(null));
  }),
);

authRouter.get(
  '/me',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user || !req.org) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const user = await UserModel.findById(req.user.id);
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User no longer exists');
    }

    res.status(200).json(
      success({
        user: toUserDTO(user),
        org: req.org,
        permissions: req.user.permissions,
      }),
    );
  }),
);

import { randomUUID } from 'node:crypto';

import express from 'express';

import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
} from '@content-insights/shared';

import { getAuthProvider } from '../lib/auth-providers/index.js';
import type { LocalCredentials } from '../lib/auth-providers/local.provider.js';
import {
  buildAuthorizationUrl,
  exchangeCodeForIdentity,
} from '../lib/auth-providers/oidc.provider.js';
import { audit, auditAs } from '../lib/audit.js';
import { asyncHandler } from '../lib/async-handler.js';
import { config, isOidcConfigured } from '../lib/config.js';
import { clearRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from '../lib/cookies.js';
import { AppError } from '../lib/errors.js';
import { verifyRefreshToken, type RefreshTokenClaims } from '../lib/jwt.js';
import { logger } from '../lib/logger.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import {
  clearFailedLogins,
  consumeOidcState,
  consumeRefreshToken,
  isLockedOut,
  recordFailedLogin,
  revokeAllRefreshTokensForUser,
  storeOidcState,
} from '../lib/refresh-store.js';
import { resolveUserDTO } from '../lib/role-assignment-lookup.js';
import { success } from '../lib/response.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { authRateLimiter } from '../middleware/rateLimiters.js';
import { validate } from '../middleware/validate.js';
import { OrganizationModel } from '../models/organization.model.js';
import { RoleModel } from '../models/role.model.js';
import { UserModel, type UserDocument } from '../models/user.model.js';
import { createOrganization } from '../services/organization.service.js';
import { issueSession } from '../services/session.service.js';

export const authRouter = express.Router();

// 100 req/min per IP across the whole auth surface (register/login/refresh/logout/me).
authRouter.use(authRateLimiter);

async function loadOrgAndRoles(user: UserDocument) {
  const roleIds = Array.from(new Set(user.roleAssignments.map((assignment) => assignment.roleId.toString())));
  const [org, roles] = await Promise.all([
    OrganizationModel.findById(user.orgId),
    RoleModel.find({ _id: { $in: roleIds }, orgId: user.orgId }),
  ]);
  return { org, roles };
}

authRouter.post(
  '/register',
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const { email, password, orgName } = req.body as RegisterInput;
    const passwordHash = await hashPassword(password);

    const created = await createOrganization({ orgName, email, passwordHash });

    const { authSession, refreshToken } = await issueSession(created.user, created.org, created.roles);
    setRefreshCookie(res, refreshToken);

    auditAs(
      req,
      { orgId: created.org._id.toString(), userId: created.user._id.toString(), email: created.user.email },
      { action: 'auth.register', entityType: 'user', entityId: created.user._id.toString(), details: { orgName } },
    );

    res.status(201).json(success(authSession));
  }),
);

authRouter.post(
  '/login',
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as LoginInput;
    const normalizedEmail = email.toLowerCase().trim();

    // Lockout runs BEFORE credential verification so a locked account can't keep being
    // brute-forced (and each attempt during lockout doesn't leak validity information).
    if (await isLockedOut(normalizedEmail)) {
      throw new AppError(
        429,
        'ACCOUNT_LOCKED',
        'Too many failed login attempts. Try again in a few minutes.',
      );
    }

    try {
      await getAuthProvider('local').authenticate({ email, password } satisfies LocalCredentials);
    } catch (err) {
      await recordFailedLogin(normalizedEmail);
      // Best-effort audit of the failure when the account actually exists.
      const attemptedUser = await UserModel.findOne({ email: normalizedEmail }, { orgId: 1, email: 1 });
      if (attemptedUser) {
        auditAs(
          req,
          { orgId: attemptedUser.orgId.toString(), userId: attemptedUser._id.toString(), email: normalizedEmail },
          { action: 'auth.login_failed', entityType: 'user', entityId: attemptedUser._id.toString() },
        );
      }
      throw err;
    }

    // The provider only validates credentials and returns a lightweight identity (see its
    // own comment) — re-fetch the full User doc by email for org/roles/session issuance.
    const user = await UserModel.findOne({ email: normalizedEmail });
    if (!user) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    if (!user.isActive) {
      throw new AppError(403, 'ACCOUNT_INACTIVE', 'This account has been deactivated');
    }

    const { org, roles } = await loadOrgAndRoles(user);
    if (!org) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Associated organization no longer exists');
    }

    await clearFailedLogins(normalizedEmail);

    const { authSession, refreshToken } = await issueSession(user, org, roles);
    setRefreshCookie(res, refreshToken);

    auditAs(
      req,
      { orgId: org._id.toString(), userId: user._id.toString(), email: user.email },
      { action: 'auth.login', entityType: 'user', entityId: user._id.toString() },
    );

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

    let claims: RefreshTokenClaims;
    try {
      claims = verifyRefreshToken(cookieToken);
    } catch {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token');
    }

    // Rotation: each refresh token is single-use. A token that fails consumption despite
    // a valid signature was already used (possible theft/replay) or revoked — revoke the
    // user's entire refresh-token family as a precaution.
    const consumed = await consumeRefreshToken(claims.jti, claims.userId);
    if (!consumed) {
      await revokeAllRefreshTokensForUser(claims.userId);
      clearRefreshCookie(res);
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is no longer valid');
    }

    const user = await UserModel.findById(claims.userId);
    if (!user) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'User no longer exists');
    }
    if (!user.isActive) {
      clearRefreshCookie(res);
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'This account has been deactivated');
    }

    const { org, roles } = await loadOrgAndRoles(user);
    if (!org) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Associated organization no longer exists');
    }

    const { authSession, refreshToken } = await issueSession(user, org, roles);
    setRefreshCookie(res, refreshToken);
    res.status(200).json(success(authSession));
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    // Best-effort server-side revocation of the presented refresh token — the cookie is
    // cleared regardless.
    const cookieToken: unknown = req.cookies[REFRESH_COOKIE_NAME];
    if (typeof cookieToken === 'string' && cookieToken.length > 0) {
      try {
        const claims = verifyRefreshToken(cookieToken);
        await consumeRefreshToken(claims.jti, claims.userId);
        const user = await UserModel.findById(claims.userId, { orgId: 1, email: 1 });
        if (user) {
          auditAs(
            req,
            { orgId: user.orgId.toString(), userId: claims.userId, email: user.email },
            { action: 'auth.logout', entityType: 'user', entityId: claims.userId },
          );
        }
      } catch {
        // Expired/garbage token — nothing to revoke.
      }
    }
    clearRefreshCookie(res);
    res.status(200).json(success(null));
  }),
);

authRouter.post(
  '/change-password',
  authenticate,
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const { currentPassword, newPassword } = req.body as ChangePasswordInput;

    const user = await UserModel.findById(req.user.id);
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const currentValid = await verifyPassword(currentPassword, user.passwordHash);
    if (!currentValid) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
    }

    user.passwordHash = await hashPassword(newPassword);
    await user.save();

    // Every other session's refresh token is now dead — a stolen credential can't keep
    // silently refreshing after the owner rotates their password.
    await revokeAllRefreshTokensForUser(user._id.toString());

    audit(req, { action: 'auth.password_change', entityType: 'user', entityId: req.user.id });

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
        user: await resolveUserDTO(req.user.orgId, user),
        org: req.org,
        permissions: req.user.globalPermissions,
      }),
    );
  }),
);

// ---------------------------------------------------------------------------
// OIDC SSO
// ---------------------------------------------------------------------------

// Feature-detection for the login page's "Sign in with SSO" button.
authRouter.get('/sso/status', (_req, res) => {
  res.status(200).json(success({ enabled: isOidcConfigured() }));
});

authRouter.get(
  '/sso/login',
  asyncHandler(async (_req, res) => {
    if (!isOidcConfigured()) {
      throw new AppError(404, 'SSO_NOT_CONFIGURED', 'SSO is not configured for this deployment');
    }
    const state = randomUUID();
    await storeOidcState(state);
    res.redirect(await buildAuthorizationUrl(state));
  }),
);

authRouter.get(
  '/sso/callback',
  asyncHandler(async (req, res) => {
    if (!isOidcConfigured()) {
      throw new AppError(404, 'SSO_NOT_CONFIGURED', 'SSO is not configured for this deployment');
    }
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state || !(await consumeOidcState(state))) {
      throw new AppError(401, 'SSO_INVALID_STATE', 'Invalid or expired SSO state');
    }

    const identity = await exchangeCodeForIdentity(code);

    let user = await UserModel.findOne({ email: identity.email });
    if (!user) {
      // Auto-provision: an org may claim an email domain (Organization.ssoDomain);
      // first-time SSO users land there with the least-privileged seeded role.
      const domain = identity.email.split('@')[1] ?? '';
      const org = domain ? await OrganizationModel.findOne({ ssoDomain: domain }) : null;
      if (!org) {
        throw new AppError(
          403,
          'SSO_USER_NOT_PROVISIONED',
          'No account exists for this email and no organization claims its domain',
        );
      }
      const analystRole = await RoleModel.findOne({ orgId: org._id, name: 'Analyst' });
      user = await UserModel.create({
        email: identity.email,
        // SSO-provisioned users have no usable local password — a random unguessable
        // hash input keeps the schema satisfied without enabling password login.
        passwordHash: await hashPassword(randomUUID() + randomUUID()),
        ...(identity.displayName !== undefined ? { displayName: identity.displayName } : {}),
        orgId: org._id,
        // Least-privileged seeded role, global scope, no time bound — same starting point
        // as any other org member added later via the (not-yet-built) role-assignment
        // routes.
        roleAssignments: analystRole
          ? [{ roleId: analystRole._id, groupId: null, startDate: null, endDate: null }]
          : [],
      });
      logger.info({ email: identity.email, orgId: org._id.toString() }, 'SSO auto-provisioned user');
    }

    const { org, roles } = await loadOrgAndRoles(user);
    if (!org) {
      throw new AppError(401, 'SSO_ORG_MISSING', 'Associated organization no longer exists');
    }

    const { refreshToken } = await issueSession(user, org, roles);
    setRefreshCookie(res, refreshToken);

    auditAs(
      req,
      { orgId: org._id.toString(), userId: user._id.toString(), email: user.email },
      { action: 'auth.sso_login', entityType: 'user', entityId: user._id.toString() },
    );

    // The SPA boots, finds the refresh cookie, and silently exchanges it for an access
    // token — same flow as a returning local-login user.
    res.redirect(config.corsOrigin);
  }),
);

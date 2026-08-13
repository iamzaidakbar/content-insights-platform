import express from 'express';
import { z } from 'zod';

import {
  assignUserRoleSchema,
  createUserSchema,
  setCurrentGroupSchema,
  setCurrentProjectSchema,
  setUserActiveSchema,
  setUserStatusReasonSchema,
  updateRoleAssignmentEndDateSchema,
  updateUserSchema,
  type AssignUserRoleInput,
  type CreateUserInput,
  type CreateUserResult,
  type InviteLinkResult,
  type PasswordResetLinkResult,
  type PaginatedResult,
  type Permission,
  type SetCurrentGroupInput,
  type SetCurrentProjectInput,
  type SetUserActiveInput,
  type SetUserStatusReasonInput,
  type UpdateRoleAssignmentEndDateInput,
  type UpdateUserInput,
  type User,
  type UserSummary,
} from '@content-insights/shared';
import { asUserId } from '@content-insights/shared';

import { audit } from '../lib/audit.js';
import { asyncHandler } from '../lib/async-handler.js';
import { clearRefreshCookie } from '../lib/cookies.js';
import { AppError, ConflictError, ForbiddenError, ValidationError, isDuplicateKeyError } from '../lib/errors.js';
import { groupIdFromBody, groupIdFromUserRoleAssignment } from '../lib/group-scope.js';
import { parseObjectIdParam } from '../lib/objectId.js';
import { pageQuerySchema } from '../lib/pagination.js';
import { generateTemporaryPassword, hashPassword } from '../lib/password.js';
import { generateOneTimeToken, hashOneTimeToken, INVITE_TTL_MS, PASSWORD_RESET_TTL_MS } from '../lib/one-time-token.js';
import { config } from '../lib/config.js';
import {
  assertPermission,
  canAssignRole,
  isRoleAssignmentActive,
  validateRoleAssignmentInput,
  type RoleAssignmentActorContext,
} from '../lib/permissions.js';
import { revokeAllRefreshTokensForUser } from '../lib/refresh-store.js';
import { resolveUserDTO, resolveUserDTOs } from '../lib/role-assignment-lookup.js';
import { success } from '../lib/response.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { requireScopedPermission } from '../middleware/requireScopedPermission.js';
import { validate } from '../middleware/validate.js';
import { GroupModel } from '../models/group.model.js';
import { ProjectModel } from '../models/project.model.js';
import { RoleModel } from '../models/role.model.js';
import { UserModel } from '../models/user.model.js';
import type { AuthenticatedUser } from '../types/express.js';
import { notify } from '../services/notification.service.js';

export const userRouter = express.Router();

const SEARCH_RESULT_LIMIT = 20;
const PAGE_SIZE = 20;

// `email` (not `search`) per the brief — this is specifically "search users by email".
const userListQuerySchema = pageQuerySchema.extend({
  email: z.string().trim().max(200).optional(),
  roleId: z.string().min(1).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  sort: z.enum(['email', 'createdAt', 'lastLoginAt']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});
type UserListQuery = z.infer<typeof userListQuerySchema>;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function publicAppUrl(path: string): string {
  return `${config.corsOrigin}${path}`;
}

function issueInviteForUser(): { token: string; hash: string; expiresAt: Date } {
  const token = generateOneTimeToken();
  return {
    token,
    hash: hashOneTimeToken(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  };
}

const APPLICATION_ADMIN_ROLE_NAME = 'Application Admin';

async function assertNotLastApplicationAdmin(orgId: string, targetId: string): Promise<void> {
  const adminRole = await RoleModel.findOne({ orgId, name: APPLICATION_ADMIN_ROLE_NAME });
  if (!adminRole) {
    return;
  }
  const target = await UserModel.findOne({ _id: targetId, orgId });
  if (!target) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }
  const isTargetAdmin = target.roleAssignments.some(
    (assignment) =>
      assignment.roleId.toString() === adminRole._id.toString() &&
      assignment.groupId === null &&
      isRoleAssignmentActive(assignment),
  );
  if (!isTargetAdmin) {
    return;
  }
  const now = new Date();
  const remaining = await UserModel.countDocuments({
    orgId,
    isActive: true,
    _id: { $ne: target._id },
    roleAssignments: {
      $elemMatch: {
        roleId: adminRole._id,
        groupId: null,
        $and: [
          { $or: [{ startDate: null }, { startDate: { $exists: false } }, { startDate: { $lte: now } }] },
          { $or: [{ endDate: null }, { endDate: { $exists: false } }, { endDate: { $gte: now } }] },
        ],
      },
    },
  });
  if (remaining === 0) {
    throw new ConflictError('Cannot deactivate or delete the last Application Admin', 'LAST_ADMIN');
  }
}

function statusReasonDetails(email: string, reason: string | undefined): Record<string, unknown> {
  return reason ? { email, reason } : { email };
}

// Resolves the acting user's currently-active GLOBAL-scope role names — not derivable from
// the JWT alone (only roleIds are embedded there, see AccessTokenRoleAssignment's own
// comment in lib/jwt.ts) — so canAssignRole's "is the actor themselves an Application Admin"
// check has something to compare against.
async function loadActingRoleContext(user: AuthenticatedUser): Promise<RoleAssignmentActorContext> {
  const globalRoleIds = Array.from(
    new Set(
      user.roleAssignments
        .filter((assignment) => assignment.groupId === null && isRoleAssignmentActive(assignment))
        .map((assignment) => assignment.roleId),
    ),
  );
  const roles =
    globalRoleIds.length > 0
      ? await RoleModel.find({ _id: { $in: globalRoleIds }, orgId: user.orgId }, { name: 1 })
      : [];
  return {
    globalPermissions: user.globalPermissions,
    globalRoleNames: roles.map((role) => role.name),
  };
}

// This one route serves two distinct consumers with two distinct response shapes, branched
// on whether `page` is present:
//  - No `page` (typeahead, e.g. "assign this user to my group"): no gate beyond org
//    membership — a scoped User Group Admin must still be able to search candidates for
//    their own group even though they hold no org-wide `users:read` grant — empty/missing
//    `email` -> [], else a capped-at-20 UserSummary[] match list (id/email only).
//  - `page` present (the admin roster): a materially more sensitive read (every member's
//    email + full role assignments, not a bounded id/email match list) — gated on
//    `users:read`, and genuinely paginated since an org roster has no natural size cap.
userRouter.get(
  '/',
  authenticate,
  orgContext,
  validate({ query: userListQuerySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const { email, page, roleId, isActive, sort, order } = req.query as unknown as UserListQuery;

    if (!page) {
      if (!email) {
        res.status(200).json(success([] as UserSummary[]));
        return;
      }
      const escaped = escapeRegex(email);
      const users = await UserModel.find({
        orgId: req.user.orgId,
        email: { $regex: escaped, $options: 'i' },
      }).limit(SEARCH_RESULT_LIMIT);

      const results: UserSummary[] = users.map((u) => ({
        id: asUserId(u._id.toString()),
        email: u.email,
        ...(u.displayName !== undefined ? { displayName: u.displayName } : {}),
      }));
      res.status(200).json(success(results));
      return;
    }

    assertPermission(req.user, 'users:read' satisfies Permission);

    const filter: Record<string, unknown> = { orgId: req.user.orgId };
    if (email) {
      filter.email = { $regex: escapeRegex(email), $options: 'i' };
    }
    if (roleId) {
      filter['roleAssignments.roleId'] = roleId;
    }
    if (isActive === 'true') {
      filter.isActive = true;
    } else if (isActive === 'false') {
      filter.isActive = false;
    }

    const sortField = sort ?? 'email';
    const sortDir = order === 'desc' ? -1 : 1;

    const [users, total] = await Promise.all([
      UserModel.find(filter)
        .sort({ [sortField]: sortDir })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE),
      UserModel.countDocuments(filter),
    ]);

    const result: PaginatedResult<User> = {
      items: await resolveUserDTOs(req.user.orgId, users),
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / PAGE_SIZE),
    };
    res.status(200).json(success(result));
  }),
);

// Creates a new User directly in the caller's org — the only way to add a member besides
// registering a brand-new org (POST /api/auth/register) or SSO auto-provisioning
// (GET /api/auth/sso/callback). There is no outbound email/SMTP integration in this app, so
// rather than the new member choosing their own password, a secure one is generated
// server-side and returned exactly once in the response body; the caller is responsible for
// relaying it out of band. The created user starts with no role assignments (global scope,
// no group, no permissions) — granting access is a separate step via
// POST /:id/role-assignments below, same as any other user.
userRouter.post(
  '/',
  authenticate,
  orgContext,
  requirePermission('users:manage' satisfies Permission),
  validate({ body: createUserSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const { email, displayName } = req.body as CreateUserInput;
    const normalizedEmail = email.toLowerCase().trim();
    const passwordHash = await hashPassword(generateTemporaryPassword());
    const invite = issueInviteForUser();

    let user;
    try {
      user = await UserModel.create({
        email: normalizedEmail,
        passwordHash,
        orgId: req.user.orgId,
        provisioning: 'invite_pending',
        inviteTokenHash: invite.hash,
        inviteExpiresAt: invite.expiresAt,
        ...(displayName !== undefined ? { displayName } : {}),
      });
    } catch (err) {
      if (isDuplicateKeyError(err) && err.keyPattern?.email) {
        throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
      }
      throw err;
    }

    audit(req, {
      action: 'user.create',
      entityType: 'user',
      entityId: user._id.toString(),
      details: { email: normalizedEmail },
    });

    const result: CreateUserResult = {
      user: await resolveUserDTO(req.user.orgId, user),
      inviteUrl: publicAppUrl(`/accept-invite?token=${invite.token}`),
    };

    res.status(201).json(success(result));
  }),
);

userRouter.patch(
  '/me',
  authenticate,
  validate({ body: updateUserSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const { displayName } = req.body as UpdateUserInput;
    const user = await UserModel.findByIdAndUpdate(req.user.id, { displayName }, { new: true });
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    res.status(200).json(success(await resolveUserDTO(req.user.orgId, user)));
  }),
);

// PATCH /api/users/me/current-group — the "last-selected navbar group" preference that
// resolveArticleSearchGrants (lib/article-access.ts), userTag.routes.ts's bulk-apply
// ownerGroupId resolution, etc. all read fresh from this same field. Membership-gated (you
// can only switch INTO a group you actually hold an active roleAssignment in) except for a
// global '*' holder (Application Admin), who may switch into any group in the org to
// preview its scope. Passing null clears it back to "no current group".
userRouter.patch(
  '/me/current-group',
  authenticate,
  orgContext,
  validate({ body: setCurrentGroupSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const { groupId } = req.body as SetCurrentGroupInput;

    if (groupId !== null) {
      const group = await GroupModel.findOne({ _id: groupId, orgId: req.user.orgId }, { _id: 1 });
      if (!group) {
        throw new AppError(404, 'GROUP_NOT_FOUND', 'Group not found');
      }
      const isMember = req.user.roleAssignments.some(
        (assignment) => assignment.groupId === groupId && isRoleAssignmentActive(assignment),
      );
      if (!isMember && !req.user.globalPermissions.includes('*')) {
        throw new ForbiddenError('You are not a member of this group');
      }
    }

    const user = await UserModel.findByIdAndUpdate(
      req.user.id,
      { currentGroupId: groupId },
      { new: true },
    );
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    res.status(200).json(success(await resolveUserDTO(req.user.orgId, user)));
  }),
);

// PATCH /api/users/me/current-project — pairs with current-group above (see User.currentProjectId's
// own comment in @content-insights/shared). Only existence-checked, not further
// access-restricted: the search/facets grants derived from the caller's current group are
// the actual enforcement point, this is just a UI preference for which project's content
// (and cardContentLines setting) to default to.
userRouter.patch(
  '/me/current-project',
  authenticate,
  orgContext,
  validate({ body: setCurrentProjectSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const { projectId } = req.body as SetCurrentProjectInput;

    if (projectId !== null) {
      const project = await ProjectModel.findOne({ _id: projectId, orgId: req.user.orgId }, { _id: 1 });
      if (!project) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
      }
    }

    const user = await UserModel.findByIdAndUpdate(
      req.user.id,
      { currentProjectId: projectId },
      { new: true },
    );
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    res.status(200).json(success(await resolveUserDTO(req.user.orgId, user)));
  }),
);

userRouter.delete(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    audit(req, { action: 'user.delete', entityType: 'user', entityId: req.user.id });

    await UserModel.findByIdAndDelete(req.user.id);
    // Server-side refresh revocation plus cookie clearing — the deleted user's session
    // can't be silently refreshed into a 401 loop from any device.
    await revokeAllRefreshTokensForUser(req.user.id);
    clearRefreshCookie(res);
    res.status(200).json(success(null));
  }),
);

// users:delete is deliberately a distinct, more sensitive permission than users:read/manage
// — only ever granted at global scope in practice (typically Application Admin's `*`), but
// that's enforced by which roles hold it in SYSTEM_ROLE_PERMISSIONS, not a role-name check
// here. Both endpoints below reject targeting yourself ("no self-delete"/"no
// self-deactivate") so an org can never be left without anyone able to administer it.
userRouter.delete(
  '/:id',
  authenticate,
  orgContext,
  requirePermission('users:delete' satisfies Permission),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'User not found', 'USER_NOT_FOUND');
    if (id === req.user.id) {
      throw new ValidationError('You cannot delete your own account via this endpoint');
    }

    await assertNotLastApplicationAdmin(req.user.orgId, id);

    const user = await UserModel.findOneAndDelete({ _id: id, orgId: req.user.orgId });
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }
    await revokeAllRefreshTokensForUser(id);

    audit(req, {
      action: 'user.delete',
      entityType: 'user',
      entityId: id,
      details: { email: user.email },
    });

    res.status(200).json(success(null));
  }),
);

async function setOrgUserActive(
  actorId: string,
  orgId: string,
  targetId: string,
  isActive: boolean,
) {
  if (targetId === actorId) {
    throw new ValidationError(
      isActive ? 'You cannot change the status of your own account' : 'You cannot deactivate your own account',
    );
  }

  if (!isActive) {
    await assertNotLastApplicationAdmin(orgId, targetId);
  }

  const user = await UserModel.findOneAndUpdate(
    { _id: targetId, orgId },
    { $set: { isActive } },
    { new: true },
  );
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }
  // A deactivated account's live sessions shouldn't keep silently refreshing.
  if (!isActive) {
    await revokeAllRefreshTokensForUser(targetId);
  }
  return user;
}

userRouter.patch(
  '/:id/status',
  authenticate,
  orgContext,
  requirePermission('users:delete' satisfies Permission),
  validate({ body: setUserActiveSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'User not found', 'USER_NOT_FOUND');
    const { isActive, reason } = req.body as SetUserActiveInput;
    const user = await setOrgUserActive(req.user.id, req.user.orgId, id, isActive);

    audit(req, {
      action: isActive ? 'user.activate' : 'user.deactivate',
      entityType: 'user',
      entityId: id,
      details: statusReasonDetails(user.email, reason),
    });

    res.status(200).json(success(await resolveUserDTO(req.user.orgId, user)));
  }),
);

userRouter.patch(
  '/:id/deactivate',
  authenticate,
  orgContext,
  requirePermission('users:delete' satisfies Permission),
  validate({ body: setUserStatusReasonSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'User not found', 'USER_NOT_FOUND');
    const { reason } = req.body as SetUserStatusReasonInput;
    const user = await setOrgUserActive(req.user.id, req.user.orgId, id, false);

    audit(req, {
      action: 'user.deactivate',
      entityType: 'user',
      entityId: id,
      details: statusReasonDetails(user.email, reason),
    });

    res.status(200).json(success(await resolveUserDTO(req.user.orgId, user)));
  }),
);

userRouter.patch(
  '/:id/activate',
  authenticate,
  orgContext,
  requirePermission('users:delete' satisfies Permission),
  validate({ body: setUserStatusReasonSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'User not found', 'USER_NOT_FOUND');
    const { reason } = req.body as SetUserStatusReasonInput;
    const user = await setOrgUserActive(req.user.id, req.user.orgId, id, true);

    audit(req, {
      action: 'user.activate',
      entityType: 'user',
      entityId: id,
      details: statusReasonDetails(user.email, reason),
    });

    res.status(200).json(success(await resolveUserDTO(req.user.orgId, user)));
  }),
);

userRouter.post(
  '/:id/invite',
  authenticate,
  orgContext,
  requirePermission('users:manage' satisfies Permission),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'User not found', 'USER_NOT_FOUND');
    const invite = issueInviteForUser();
    const user = await UserModel.findOneAndUpdate(
      { _id: id, orgId: req.user.orgId },
      {
        $set: {
          provisioning: 'invite_pending',
          inviteTokenHash: invite.hash,
          inviteExpiresAt: invite.expiresAt,
        },
      },
      { new: true },
    );
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }
    audit(req, {
      action: 'user.invite',
      entityType: 'user',
      entityId: id,
      details: { email: user.email },
    });
    const result: InviteLinkResult = { inviteUrl: publicAppUrl(`/accept-invite?token=${invite.token}`) };
    res.status(200).json(success(result));
  }),
);

userRouter.post(
  '/:id/reset-password',
  authenticate,
  orgContext,
  requirePermission('users:manage' satisfies Permission),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'User not found', 'USER_NOT_FOUND');
    const token = generateOneTimeToken();
    const user = await UserModel.findOneAndUpdate(
      { _id: id, orgId: req.user.orgId },
      {
        $set: {
          passwordResetTokenHash: hashOneTimeToken(token),
          passwordResetExpiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        },
      },
      { new: true },
    );
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }
    audit(req, {
      action: 'auth.password_reset',
      entityType: 'user',
      entityId: id,
      details: { email: user.email, via: 'admin' },
    });
    const result: PasswordResetLinkResult = {
      resetUrl: publicAppUrl(`/reset-password?token=${token}`),
    };
    res.status(200).json(success(result));
  }),
);

// Scoped on the GROUP BEING ASSIGNED INTO (from the request body), not a URL param — this
// is what lets a User Group Admin who only holds `roles:assign` scoped to their own group
// (never org-wide) assign roles within that group, while a global (groupId: null)
// assignment still requires an org-wide `roles:assign` grant (groupIdFromBody resolves to
// null for a null groupId, which requireScopedPermission only lets through org-wide).
userRouter.post(
  '/:id/role-assignments',
  authenticate,
  orgContext,
  requireScopedPermission('roles:assign' satisfies Permission, groupIdFromBody('groupId')),
  validate({ body: assignUserRoleSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'User not found', 'USER_NOT_FOUND');
    const { roleId, groupId, startDate, endDate } = req.body as AssignUserRoleInput;

    const role = await RoleModel.findOne({ _id: roleId, orgId: req.user.orgId });
    if (!role) {
      throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found');
    }
    if (groupId !== null) {
      const group = await GroupModel.findOne({ _id: groupId, orgId: req.user.orgId });
      if (!group) {
        throw new AppError(404, 'GROUP_NOT_FOUND', 'Group not found');
      }
    }

    // Business rule 4 (lib/permissions.ts): Application Admin assignments are always
    // global/undated.
    validateRoleAssignmentInput(role.name, {
      groupId,
      startDate: startDate ?? null,
      endDate: endDate ?? null,
    });

    // Business rule 3: only an Application Admin may grant the Application Admin role.
    if (role.name === APPLICATION_ADMIN_ROLE_NAME) {
      const actorContext = await loadActingRoleContext(req.user);
      if (!canAssignRole(actorContext, role.name, groupId)) {
        throw new ForbiddenError('Only an Application Admin can grant the Application Admin role');
      }
    }

    const user = await UserModel.findOneAndUpdate(
      { _id: id, orgId: req.user.orgId },
      {
        $push: {
          roleAssignments: {
            roleId,
            groupId,
            startDate: startDate ?? null,
            endDate: endDate ?? null,
          },
        },
      },
      { new: true },
    );
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    audit(req, {
      action: 'role.assign',
      entityType: 'user',
      entityId: id,
      ...(groupId ? { groupId } : {}),
      details: { roleId, roleName: role.name, groupId, userEmail: user.email },
    });
    if (id !== req.user.id) {
      void notify({
        orgId: req.user.orgId,
        userId: id,
        type: 'permission.changed',
        title: `You were granted the "${role.name}" role`,
        body: `Assigned by ${req.user.email}.`,
      });
    }

    res.status(201).json(success(await resolveUserDTO(req.user.orgId, user)));
  }),
);

userRouter.delete(
  '/:id/role-assignments/:assignmentId',
  authenticate,
  orgContext,
  requireScopedPermission(
    'roles:assign' satisfies Permission,
    groupIdFromUserRoleAssignment('id', 'assignmentId'),
  ),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'User not found', 'USER_NOT_FOUND');
    const assignmentId = parseObjectIdParam(
      req.params.assignmentId,
      'Role assignment not found',
      'ROLE_ASSIGNMENT_NOT_FOUND',
    );

    const user = await UserModel.findOneAndUpdate(
      { _id: id, orgId: req.user.orgId, 'roleAssignments._id': assignmentId },
      { $pull: { roleAssignments: { _id: assignmentId } } },
      { new: true },
    );
    if (!user) {
      throw new AppError(404, 'ROLE_ASSIGNMENT_NOT_FOUND', 'Role assignment not found');
    }

    audit(req, {
      action: 'role.revoke',
      entityType: 'user',
      entityId: id,
      details: { assignmentId, userEmail: user.email },
    });
    if (id !== req.user.id) {
      void notify({
        orgId: req.user.orgId,
        userId: id,
        type: 'permission.changed',
        title: 'One of your role assignments was removed',
        body: `Removed by ${req.user.email}.`,
      });
    }

    res.status(200).json(success(await resolveUserDTO(req.user.orgId, user)));
  }),
);

// "End" an assignment by (re)setting its endDate — e.g. schedule it to lapse, or clear a
// previously-set end date back to open-ended. roleId/groupId themselves are immutable this
// way; changing those means DELETE + POST instead (see updateRoleAssignmentEndDateSchema's
// own comment).
userRouter.patch(
  '/:id/role-assignments/:assignmentId',
  authenticate,
  orgContext,
  requireScopedPermission(
    'roles:assign' satisfies Permission,
    groupIdFromUserRoleAssignment('id', 'assignmentId'),
  ),
  validate({ body: updateRoleAssignmentEndDateSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'User not found', 'USER_NOT_FOUND');
    const assignmentId = parseObjectIdParam(
      req.params.assignmentId,
      'Role assignment not found',
      'ROLE_ASSIGNMENT_NOT_FOUND',
    );
    const { endDate } = req.body as UpdateRoleAssignmentEndDateInput;

    const target = await UserModel.findOne(
      { _id: id, orgId: req.user.orgId, 'roleAssignments._id': assignmentId },
      { 'roleAssignments.$': 1 },
    );
    const assignment = target?.roleAssignments[0];
    if (!target || !assignment) {
      throw new AppError(404, 'ROLE_ASSIGNMENT_NOT_FOUND', 'Role assignment not found');
    }

    const role = await RoleModel.findOne({ _id: assignment.roleId, orgId: req.user.orgId });
    if (role) {
      // Business rule 4 again — an Application Admin assignment can never become
      // time-bound, whether at creation (POST, validateRoleAssignmentInput) or here.
      validateRoleAssignmentInput(role.name, {
        groupId: assignment.groupId ? assignment.groupId.toString() : null,
        endDate,
      });
    }

    const user = await UserModel.findOneAndUpdate(
      { _id: id, orgId: req.user.orgId, 'roleAssignments._id': assignmentId },
      { $set: { 'roleAssignments.$.endDate': endDate } },
      { new: true },
    );
    if (!user) {
      throw new AppError(404, 'ROLE_ASSIGNMENT_NOT_FOUND', 'Role assignment not found');
    }

    audit(req, {
      action: 'role.assign',
      entityType: 'user',
      entityId: id,
      details: { assignmentId, endDate, userEmail: user.email },
    });

    res.status(200).json(success(await resolveUserDTO(req.user.orgId, user)));
  }),
);

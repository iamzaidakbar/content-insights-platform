import mongoose from 'mongoose';

import { ensureOrgIndexExists } from '../lib/elasticsearch.js';
import { AppError, isDuplicateKeyError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { seedSystemRoles } from '../lib/role-seed.js';
import { slugify } from '../lib/slug.js';
import { OrganizationModel, type OrganizationDocument } from '../models/organization.model.js';
import type { RoleDocument } from '../models/role.model.js';
import { UserModel, type UserDocument } from '../models/user.model.js';
import { UserSettingsModel } from '../models/userSettings.model.js';

export interface CreateOrganizationInput {
  orgName: string;
  email: string;
  passwordHash: string;
}
export interface CreateOrganizationResult {
  user: UserDocument;
  org: OrganizationDocument;
  roles: RoleDocument[];
}

export async function createOrganization(
  input: CreateOrganizationInput,
): Promise<CreateOrganizationResult> {
  const normalizedEmail = input.email.toLowerCase().trim();
  const slug = slugify(input.orgName);
  if (!slug) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Organization name must contain at least one letter or number',
    );
  }

  const session = await mongoose.startSession();
  let created: CreateOrganizationResult | undefined;

  try {
    await session.withTransaction(async () => {
      // A ClientSession can only have one operation in flight at a time — these must
      // run sequentially, not via Promise.all, or the driver rejects the second call
      // with "ConflictingOperationInProgress".
      const existingOrg = await OrganizationModel.findOne({ slug }).session(session);
      const existingUser = await UserModel.findOne({ email: normalizedEmail }).session(session);

      if (existingOrg) {
        throw new AppError(
          409,
          'ORG_SLUG_TAKEN',
          'An organization with this name is already registered',
        );
      }
      if (existingUser) {
        throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
      }

      const [org] = await OrganizationModel.create([{ name: input.orgName, slug, plan: 'free' }], {
        session,
      });
      if (!org) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create organization');
      }

      // Every org gets all 6 canonical system roles up front (see lib/role-seed.ts's own
      // idempotency comment — safe even if this ever runs again for the same org).
      const rolesByName = await seedSystemRoles(org._id, { session });
      const applicationAdminRole = rolesByName.get('Application Admin');
      if (!applicationAdminRole) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Failed to seed system roles');
      }

      const [user] = await UserModel.create(
        [
          {
            email: normalizedEmail,
            passwordHash: input.passwordHash,
            orgId: org._id,
            // The registering user is always the org's first Application Admin —
            // global scope (groupId: null), never time-bound (see
            // validateRoleAssignmentInput in lib/permissions.ts) — so a brand-new org is
            // never left without an admin able to manage it.
            roleAssignments: [
              { roleId: applicationAdminRole._id, groupId: null, startDate: null, endDate: null },
            ],
          },
        ],
        { session },
      );
      if (!user) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create user');
      }

      // Schema defaults (theme: 'dark', fontSize: 'medium', etc.) apply automatically —
      // no need to spell them out here, same as leaving `appearance`/`search`/
      // `notifications` unset lets each subdocument's own field defaults kick in.
      const [userSettings] = await UserSettingsModel.create(
        [{ userId: user._id, orgId: org._id }],
        { session },
      );
      if (!userSettings) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create user settings');
      }

      // `roles` here means "roles assigned to the registering user" (used by issueSession to
      // build the JWT), not "every role seeded for the org" — only applicationAdminRole
      // applies to the registering user.
      created = { user, org, roles: [applicationAdminRole] };
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      if (err.keyPattern?.slug) {
        throw new AppError(
          409,
          'ORG_SLUG_TAKEN',
          'An organization with this name is already registered',
        );
      }
      if (err.keyPattern?.email) {
        throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
      }
    }
    throw err;
  } finally {
    await session.endSession();
  }

  if (!created) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Registration did not complete');
  }

  // Outside the Mongo transaction — ES has nothing to do with it. Mongo data is already
  // committed; a missing ES index is degraded-but-recoverable, not a reason to fail signup.
  try {
    await ensureOrgIndexExists(created.org._id.toString());
  } catch (err) {
    logger.error(
      { err, orgId: created.org._id.toString() },
      'Failed to create Elasticsearch index for org',
    );
  }

  return created;
}

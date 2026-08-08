import mongoose from 'mongoose';

import { ensureOrgIndexExists } from '../lib/elasticsearch.js';
import { AppError, isDuplicateKeyError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { slugify } from '../lib/slug.js';
import { OrganizationModel, type OrganizationDocument } from '../models/organization.model.js';
import { RoleModel, type RoleDocument } from '../models/role.model.js';
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
      // One batch create() call for all 3 seeded roles — still a single operation-in-flight
      // under the session's sequencing rule (see the comment above). Mongoose 9 requires
      // `ordered: true` explicitly whenever create() is called with both a session and
      // multiple documents, or it throws "Cannot call `create()` with a session and multiple
      // documents unless `ordered: true` is set" — harmless to set here since these 3 inserts
      // have no cross-doc ordering dependency anyway.
      const [adminRole, editorRole, viewerRole] = await RoleModel.create(
        [
          { orgId: org._id, name: 'admin', permissions: ['*'] },
          {
            orgId: org._id,
            name: 'editor',
            permissions: ['documents:read', 'documents:write', 'search:query'],
          },
          { orgId: org._id, name: 'viewer', permissions: ['documents:read', 'search:query'] },
        ],
        { session, ordered: true },
      );
      if (!adminRole || !editorRole || !viewerRole) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create roles');
      }
      const [user] = await UserModel.create(
        [
          {
            email: normalizedEmail,
            passwordHash: input.passwordHash,
            orgId: org._id,
            roles: [adminRole._id],
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
      // build the JWT), not "every role seeded for the org" — only adminRole applies to user.
      created = { user, org, roles: [adminRole] };
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

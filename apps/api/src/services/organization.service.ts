import mongoose from 'mongoose';

import { ensureOrgIndexExists } from '../lib/elasticsearch.js';
import { AppError } from '../lib/errors.js';
import { slugify } from '../lib/slug.js';
import { OrganizationModel, type OrganizationDocument } from '../models/organization.model.js';
import { RoleModel, type RoleDocument } from '../models/role.model.js';
import { UserModel, type UserDocument } from '../models/user.model.js';

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

function isDuplicateKeyError(
  err: unknown,
): err is { code: number; keyPattern?: Record<string, unknown> } {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
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
      const [ownerRole] = await RoleModel.create(
        [{ orgId: org._id, name: 'Owner', permissions: ['*'] }],
        { session },
      );
      if (!ownerRole) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create role');
      }
      const [user] = await UserModel.create(
        [
          {
            email: normalizedEmail,
            passwordHash: input.passwordHash,
            orgId: org._id,
            roles: [ownerRole._id],
          },
        ],
        { session },
      );
      if (!user) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create user');
      }

      created = { user, org, roles: [ownerRole] };
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
    console.error(
      `Failed to create Elasticsearch index for org ${created.org._id.toString()}:`,
      err,
    );
  }

  return created;
}

import type { ClientSession, Types } from 'mongoose';

import { SYSTEM_ROLE_NAMES, SYSTEM_ROLE_PERMISSIONS, type SystemRoleName } from '@content-insights/shared';

import { RoleModel, type RoleDocument } from '../models/role.model.js';

export interface SeedSystemRolesOptions {
  session?: ClientSession;
}

// Idempotent: creates whichever of the 6 SYSTEM_ROLE_NAMES don't already exist (by name) for
// this org, each isSystem:true with its canonical SYSTEM_ROLE_PERMISSIONS. Safe to call
// repeatedly — never touches a role that already exists, so an org's later customization of
// a system role's permissions (roles:manage) is never clobbered by re-seeding. Called from
// organization.service.ts's createOrganization so every new org gets all 6 roles up front.
export async function seedSystemRoles(
  orgId: Types.ObjectId | string,
  options: SeedSystemRolesOptions = {},
): Promise<Map<SystemRoleName, RoleDocument>> {
  const { session } = options;

  const existingQuery = RoleModel.find({ orgId, name: { $in: SYSTEM_ROLE_NAMES } });
  const existing = await (session ? existingQuery.session(session) : existingQuery);

  const byName = new Map<SystemRoleName, RoleDocument>(
    existing.map((role) => [role.name as SystemRoleName, role]),
  );

  const missing = SYSTEM_ROLE_NAMES.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    // Built via spread rather than `{ session, ordered: true }` directly — with
    // exactOptionalPropertyTypes, explicitly setting `session: undefined` doesn't satisfy
    // CreateOptions' `session?: ClientSession | null`, so the key must be omitted entirely
    // when there's no session to pass.
    const created = await RoleModel.create(
      missing.map((name) => ({
        orgId,
        name,
        permissions: SYSTEM_ROLE_PERMISSIONS[name],
        isSystem: true,
      })),
      { ordered: true, ...(session ? { session } : {}) },
    );
    for (const role of created) {
      byName.set(role.name as SystemRoleName, role);
    }
  }

  return byName;
}

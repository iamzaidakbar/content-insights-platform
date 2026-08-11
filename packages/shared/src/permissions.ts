export const PERMISSIONS = [
  'projects:read',
  'projects:manage',
  'concepts:read',
  'concepts:manage',
  'groups:read',
  'groups:manage',
  'groups:manageDataAccess',
  'users:read',
  'users:manage',
  'users:delete',
  'roles:read',
  'roles:manage',
  'roles:assign',
  'articles:read',
  'articles:hide',
  'saved-searches:read',
  'saved-searches:manage',
  'saved-searches:manageAll',
  'saved-searches:publish',
  'saved-searches:shareIntoGroups',
  'user-tags:read',
  'user-tags:manage',
  'user-tags:publish',
  'user-tags:shareIntoGroups',
  'insights:read',
  'insights:manage',
  'dashboards:read',
  'dashboards:manage',
  'ms-teams:share',
  'ms-teams:manageSettings',
  'entity-mapping:read',
  'entity-mapping:manage',
  'audit:read',
  'global-settings:manage',
  'notifications:read',
  'export:run',
  'org:admin',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const SYSTEM_ROLE_NAMES = [
  'Application Admin',
  'User Group Admin',
  'Analyst',
  'Read-Only',
  'Publisher',
  'Sharing Rights Into',
] as const;
export type SystemRoleName = (typeof SYSTEM_ROLE_NAMES)[number];

// Canonical permission sets for each seeded system role — used by the API's role-seeding
// logic when a new Organization is created. Application Admin gets ['*'], which
// hasPermission()/flattenPermissions() (apps/api/src/lib/permissions.ts) treat as matching
// every permission check, so it deliberately isn't enumerated against the Permission union.
export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRoleName, Permission[] | ['*']> = {
  'Application Admin': ['*'],
  // Scoping to "their groups" is enforced by the API's group-scoping mechanism, not by this
  // permission list. Cannot assign Application Admin — that restriction is enforced in
  // application code, not here.
  'User Group Admin': [
    'users:read',
    'users:manage',
    'groups:read',
    'groups:manage',
    'groups:manageDataAccess',
    'roles:read',
    'roles:assign',
    'saved-searches:read',
    'saved-searches:manage',
    'saved-searches:manageAll',
    'saved-searches:publish',
    'saved-searches:shareIntoGroups',
    'articles:read',
    'user-tags:read',
    'user-tags:manage',
    'user-tags:publish',
    'user-tags:shareIntoGroups',
    'insights:read',
    'insights:manage',
    'dashboards:read',
    'dashboards:manage',
    'export:run',
  ],
  // Deliberately NOT given saved-searches:shareIntoGroups/manageAll — those require the
  // separate "Sharing Rights Into" role (or admin) to be granted additionally.
  Analyst: [
    'articles:read',
    'saved-searches:read',
    'saved-searches:manage',
    'insights:read',
    'insights:manage',
    'dashboards:read',
    'dashboards:manage',
    'user-tags:read',
    'user-tags:manage',
    'export:run',
  ],
  // Cannot create/edit saved searches or export.
  'Read-Only': [
    'articles:read',
    'saved-searches:read',
    'insights:read',
    'dashboards:read',
    'user-tags:read',
  ],
  Publisher: ['articles:read', 'user-tags:read', 'user-tags:manage', 'user-tags:publish'],
  // Additive grant meant to be combined with Analyst (or another base role) to unlock
  // sharing saved searches into other groups — not a standalone functional role.
  'Sharing Rights Into': ['saved-searches:read', 'saved-searches:shareIntoGroups'],
};

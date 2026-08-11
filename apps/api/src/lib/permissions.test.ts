import { describe, expect, it } from 'vitest';

import {
  canAssignRole,
  hasPermission,
  resolveEffectivePermissions,
  validateRoleAssignmentInput,
  type EffectivePermissionsRole,
  type EffectivePermissionsUser,
} from '../lib/permissions.js';
import type { AuthenticatedUser } from '../types/express.js';

function user(globalPermissions: string[]): AuthenticatedUser {
  return {
    id: '507f1f77bcf86cd799439011' as AuthenticatedUser['id'],
    orgId: '507f1f77bcf86cd799439012' as AuthenticatedUser['orgId'],
    email: 'a@example.com',
    roleAssignments: [],
    globalPermissions,
  };
}

describe('hasPermission', () => {
  it('grants wildcard', () => {
    expect(hasPermission(user(['*']), 'articles:read')).toBe(true);
  });

  it('grants an exact match', () => {
    expect(hasPermission(user(['articles:read']), 'articles:read')).toBe(true);
  });

  it('denies a missing permission', () => {
    expect(hasPermission(user(['articles:read']), 'audit:read')).toBe(false);
  });
});

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const past = (offsetMs = ONE_DAY_MS) => new Date(Date.now() - offsetMs).toISOString();
const future = (offsetMs = ONE_DAY_MS) => new Date(Date.now() + offsetMs).toISOString();

const analystRole: EffectivePermissionsRole = {
  _id: 'role-analyst',
  permissions: ['articles:read', 'insights:read'],
};
const publisherRole: EffectivePermissionsRole = {
  _id: 'role-publisher',
  permissions: ['articles:read', 'user-tags:publish'],
};
const adminRole: EffectivePermissionsRole = { _id: 'role-admin', permissions: ['*'] };
const roles = [analystRole, publisherRole, adminRole];

describe('resolveEffectivePermissions', () => {
  it('grants global scope for a groupId: null assignment', () => {
    const testUser: EffectivePermissionsUser = {
      roleAssignments: [{ roleId: 'role-analyst', groupId: null }],
    };
    const effective = resolveEffectivePermissions(testUser, roles);
    expect(effective.global.has('articles:read')).toBe(true);
    expect(effective.global.has('insights:read')).toBe(true);
    expect(effective.byGroup.size).toBe(0);
  });

  it('grants group scope only (not global) for a groupId-bound assignment', () => {
    const testUser: EffectivePermissionsUser = {
      roleAssignments: [{ roleId: 'role-analyst', groupId: 'group-1' }],
    };
    const effective = resolveEffectivePermissions(testUser, roles);
    expect(effective.global.size).toBe(0);
    expect(effective.byGroup.get('group-1')?.has('articles:read')).toBe(true);
  });

  it('keeps distinct groups separate', () => {
    const testUser: EffectivePermissionsUser = {
      roleAssignments: [
        { roleId: 'role-analyst', groupId: 'group-1' },
        { roleId: 'role-publisher', groupId: 'group-2' },
      ],
    };
    const effective = resolveEffectivePermissions(testUser, roles);
    expect(effective.byGroup.get('group-1')?.has('insights:read')).toBe(true);
    expect(effective.byGroup.get('group-2')?.has('insights:read')).toBeFalsy();
    expect(effective.byGroup.get('group-2')?.has('user-tags:publish')).toBe(true);
  });

  it('merges permissions from multiple roles granted in the same group', () => {
    const testUser: EffectivePermissionsUser = {
      roleAssignments: [
        { roleId: 'role-analyst', groupId: 'group-1' },
        { roleId: 'role-publisher', groupId: 'group-1' },
      ],
    };
    const effective = resolveEffectivePermissions(testUser, roles);
    const group1 = effective.byGroup.get('group-1');
    expect(group1?.has('insights:read')).toBe(true);
    expect(group1?.has('user-tags:publish')).toBe(true);
  });

  it('keeps the wildcard as a sentinel rather than expanding it to every permission', () => {
    const testUser: EffectivePermissionsUser = {
      roleAssignments: [{ roleId: 'role-admin', groupId: null }],
    };
    const effective = resolveEffectivePermissions(testUser, roles);
    expect(effective.global.has('*')).toBe(true);
    expect(effective.global.size).toBe(1);
  });

  it('excludes an assignment whose startDate is still in the future', () => {
    const testUser: EffectivePermissionsUser = {
      roleAssignments: [{ roleId: 'role-analyst', groupId: null, startDate: future() }],
    };
    const effective = resolveEffectivePermissions(testUser, roles);
    expect(effective.global.size).toBe(0);
  });

  it('excludes an assignment whose endDate has already passed', () => {
    const testUser: EffectivePermissionsUser = {
      roleAssignments: [{ roleId: 'role-analyst', groupId: null, endDate: past() }],
    };
    const effective = resolveEffectivePermissions(testUser, roles);
    expect(effective.global.size).toBe(0);
  });

  it('includes an assignment whose start/end window covers now', () => {
    const testUser: EffectivePermissionsUser = {
      roleAssignments: [
        { roleId: 'role-analyst', groupId: null, startDate: past(), endDate: future() },
      ],
    };
    const effective = resolveEffectivePermissions(testUser, roles);
    expect(effective.global.has('articles:read')).toBe(true);
  });

  it('grants nothing for an assignment referencing a role that no longer exists', () => {
    const testUser: EffectivePermissionsUser = {
      roleAssignments: [{ roleId: 'role-deleted', groupId: null }],
    };
    const effective = resolveEffectivePermissions(testUser, roles);
    expect(effective.global.size).toBe(0);
    expect(effective.byGroup.size).toBe(0);
  });
});

describe('canAssignRole', () => {
  it('allows assigning a non-Application-Admin role regardless of the actor', () => {
    expect(canAssignRole({ globalPermissions: [], globalRoleNames: [] }, 'Analyst', null)).toBe(true);
    expect(canAssignRole({ globalPermissions: [], globalRoleNames: [] }, 'Analyst', 'group-1')).toBe(
      true,
    );
  });

  it('allows a global wildcard holder to assign Application Admin', () => {
    expect(
      canAssignRole({ globalPermissions: ['*'], globalRoleNames: [] }, 'Application Admin', null),
    ).toBe(true);
  });

  it('allows a global Application Admin role holder (by name) to assign Application Admin', () => {
    expect(
      canAssignRole(
        { globalPermissions: ['users:manage'], globalRoleNames: ['Application Admin'] },
        'Application Admin',
        null,
      ),
    ).toBe(true);
  });

  it('denies a non-admin actor from assigning Application Admin', () => {
    expect(
      canAssignRole(
        { globalPermissions: ['users:manage', 'roles:assign'], globalRoleNames: ['User Group Admin'] },
        'Application Admin',
        null,
      ),
    ).toBe(false);
  });

  it('denies assigning Application Admin into a group scope even for an admin actor', () => {
    expect(
      canAssignRole({ globalPermissions: ['*'], globalRoleNames: [] }, 'Application Admin', 'group-1'),
    ).toBe(false);
  });
});

describe('validateRoleAssignmentInput', () => {
  it('allows any groupId/dates for a non-Application-Admin role', () => {
    expect(() =>
      validateRoleAssignmentInput('Analyst', {
        groupId: 'group-1',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      }),
    ).not.toThrow();
  });

  it('allows a global, undated Application Admin assignment', () => {
    expect(() => validateRoleAssignmentInput('Application Admin', { groupId: null })).not.toThrow();
  });

  it('rejects a group-scoped Application Admin assignment', () => {
    expect(() =>
      validateRoleAssignmentInput('Application Admin', { groupId: 'group-1' }),
    ).toThrow();
  });

  it('rejects a time-bound Application Admin assignment', () => {
    expect(() =>
      validateRoleAssignmentInput('Application Admin', { groupId: null, startDate: '2026-01-01' }),
    ).toThrow();
    expect(() =>
      validateRoleAssignmentInput('Application Admin', { groupId: null, endDate: '2026-12-31' }),
    ).toThrow();
  });
});

import type { Types } from 'mongoose';

import type { User } from '@content-insights/shared';

import { GroupModel } from '../models/group.model.js';
import { RoleModel } from '../models/role.model.js';
import type { UserDocument } from '../models/user.model.js';
import { buildRoleAssignmentLookup, toUserDTO, type RoleAssignmentLookup } from './serializers.js';

// Batch-resolves the Role/Group documents referenced across one or more users'
// roleAssignments (deduped) so toUserDTO can denormalize roleName/groupName without an
// N+1 query per assignment — see RoleAssignmentLookup's own comment in lib/serializers.ts.
// orgId scopes both lookups the same way every other query in this codebase scopes reads.
export async function loadRoleAssignmentLookup(
  orgId: Types.ObjectId | string,
  users: Pick<UserDocument, 'roleAssignments'>[],
): Promise<RoleAssignmentLookup> {
  const roleIds = new Set<string>();
  const groupIds = new Set<string>();
  for (const user of users) {
    for (const assignment of user.roleAssignments) {
      roleIds.add(assignment.roleId.toString());
      if (assignment.groupId) {
        groupIds.add(assignment.groupId.toString());
      }
    }
  }

  const [roles, groups] = await Promise.all([
    roleIds.size > 0
      ? RoleModel.find({ _id: { $in: Array.from(roleIds) }, orgId }, { name: 1 })
      : Promise.resolve([]),
    groupIds.size > 0
      ? GroupModel.find({ _id: { $in: Array.from(groupIds) }, orgId }, { name: 1 })
      : Promise.resolve([]),
  ]);

  return buildRoleAssignmentLookup(roles, groups);
}

export async function resolveUserDTO(
  orgId: Types.ObjectId | string,
  user: UserDocument,
): Promise<User> {
  const lookup = await loadRoleAssignmentLookup(orgId, [user]);
  return toUserDTO(user, lookup);
}

export async function resolveUserDTOs(
  orgId: Types.ObjectId | string,
  users: UserDocument[],
): Promise<User[]> {
  const lookup = await loadRoleAssignmentLookup(orgId, users);
  return users.map((user) => toUserDTO(user, lookup));
}

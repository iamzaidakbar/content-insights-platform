import type { RoleDocument } from '../models/role.model.js';

export function flattenPermissions(roles: RoleDocument[]): string[] {
  const all = roles.flatMap((role) => role.permissions);
  if (all.includes('*')) {
    return ['*'];
  }
  return Array.from(new Set(all));
}

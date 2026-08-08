export const PERMISSIONS = [
  'documents:read',
  'documents:write',
  'documents:delete',
  'search:query',
  'projects:manage',
  'org:admin',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

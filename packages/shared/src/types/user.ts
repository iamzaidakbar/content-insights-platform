import type { OrgId, RoleId, UserId } from '../ids.js';

export interface User {
  id: UserId;
  orgId: OrgId;
  email: string;
  // Optional — omitted entirely (never `undefined`) until the user sets one via
  // PATCH /api/users/me; every existing consumer falls back to deriving a display name
  // from `email` (see apps/web/src/layouts/AppShell.tsx).
  displayName?: string | undefined;
  roles: RoleId[];
  createdAt: string;
  updatedAt: string;
}

export interface UserSummary {
  id: UserId;
  email: string;
}

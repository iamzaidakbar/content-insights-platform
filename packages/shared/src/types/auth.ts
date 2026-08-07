import type { Organization } from './organization.js';
import type { User } from './user.js';

export interface AuthSession {
  accessToken: string;
  user: User;
  org: Organization;
  permissions: string[];
}

import { AppError } from '../errors.js';
import { verifyPassword } from '../password.js';
import { UserModel } from '../../models/user.model.js';
import type { AuthenticatedIdentity, AuthProvider } from './types.js';

export interface LocalCredentials {
  email: string;
  password: string;
}

export class LocalAuthProvider implements AuthProvider {
  readonly id = 'local';

  // Only validates credentials and returns a lightweight identity — deliberately doesn't
  // return the Mongoose UserDocument itself, so this interface stays meaningful for a future
  // SSO provider that has no local User row to hand back yet. The caller (auth.routes.ts's
  // /login) re-fetches the User by email afterward to get org/roles for session issuance —
  // one small redundant query, accepted in exchange for keeping this abstraction generic.
  async authenticate(credentials: LocalCredentials): Promise<AuthenticatedIdentity> {
    const normalizedEmail = credentials.email.toLowerCase().trim();
    const user = await UserModel.findOne({ email: normalizedEmail });
    if (!user) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const passwordValid = await verifyPassword(credentials.password, user.passwordHash);
    if (!passwordValid) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    return {
      email: user.email,
      ...(user.displayName !== undefined ? { displayName: user.displayName } : {}),
    };
  }
}

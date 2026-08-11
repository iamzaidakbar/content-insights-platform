import { LocalAuthProvider } from './local.provider.js';
import type { AuthProvider } from './types.js';

const authProviders: Record<string, AuthProvider> = {
  local: new LocalAuthProvider(),
};

// A plain indexed lookup on a Record<string, T> types as `T | undefined` under this repo's
// strict settings — this throws instead of leaving call sites to narrow/assert, and gives a
// clear error if a provider id is ever referenced that isn't registered.
export function getAuthProvider(id: string): AuthProvider {
  const provider = authProviders[id];
  if (!provider) {
    throw new Error(`Unknown auth provider: ${id}`);
  }
  return provider;
}

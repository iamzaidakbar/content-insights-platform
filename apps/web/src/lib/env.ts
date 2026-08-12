export type AppEnv = 'development' | 'staging' | 'production';

const APP_ENVS: AppEnv[] = ['development', 'staging', 'production'];

function resolveAppEnv(raw: string | undefined): AppEnv {
  return APP_ENVS.includes(raw as AppEnv) ? (raw as AppEnv) : 'development';
}

/** Normalize accidental Windows-style backslashes in pasted URLs (common on Vercel env UI). */
function resolveApiUrl(raw: string | undefined): string {
  const fallback = 'http://localhost:4000/api';
  if (!raw || raw.trim().length === 0) return fallback;
  return raw.trim().replace(/\\/g, '/');
}

// Single source of truth for reading build-time env vars — every other module reads
// `env.*` instead of poking at `import.meta.env` directly, so there's one place to
// change defaults or add a new var.
export const env = {
  apiUrl: resolveApiUrl(import.meta.env.VITE_API_URL),
  appEnv: resolveAppEnv(import.meta.env.VITE_APP_ENV),
} as const;

export const isProduction = env.appEnv === 'production';

export type AppEnv = 'development' | 'staging' | 'production';

const APP_ENVS: AppEnv[] = ['development', 'staging', 'production'];

function resolveAppEnv(raw: string | undefined): AppEnv {
  return APP_ENVS.includes(raw as AppEnv) ? (raw as AppEnv) : 'development';
}

// Single source of truth for reading build-time env vars — every other module reads
// `env.*` instead of poking at `import.meta.env` directly, so there's one place to
// change defaults or add a new var.
export const env = {
  apiUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api',
  appEnv: resolveAppEnv(import.meta.env.VITE_APP_ENV),
} as const;

export const isProduction = env.appEnv === 'production';

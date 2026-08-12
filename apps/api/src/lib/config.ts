import 'dotenv/config';

// Central typed environment configuration. Every process.env read for the API lives
// here so that a missing required variable fails fast at boot with a clear message,
// instead of surfacing later as an undefined-URL crash deep inside a request.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

const nodeEnv = optional('NODE_ENV', 'development');

export const config = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',

  // Prefer PORT (K8s / many PaaS inject this) then API_PORT for local/compose.
  apiPort: Number(process.env.PORT || optional('API_PORT', '4000')),
  // Browsers send Origin without a trailing slash; a slash in CORS_ORIGIN fails the
  // exact-match check. Normalize so pasted Vercel URLs still work.
  corsOrigin: optional('CORS_ORIGIN', 'http://localhost:5173').replace(/\/+$/, ''),
  logLevel: optional('LOG_LEVEL', 'info'),

  // Cross-origin SPAs (e.g. Vercel web → separate API host) need SameSite=None + Secure
  // so the httpOnly refresh cookie is sent on credentialed XHRs. Local same-site keeps Lax.
  cookieSameSite: (() => {
    const raw = optional('COOKIE_SAMESITE', nodeEnv === 'production' ? 'none' : 'lax');
    if (raw === 'none' || raw === 'strict' || raw === 'lax') return raw;
    return 'lax';
  })(),

  mongodbUri: required('MONGODB_URI'),
  elasticsearchUrl: required('ELASTICSEARCH_URL'),
  // Elastic Cloud requires an API key; local Docker ES usually does not.
  elasticsearchApiKey: process.env.ELASTICSEARCH_API_KEY || undefined,
  redisUrl: required('REDIS_URL'),

  jwtAccessSecret: required('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),

  uploadDir: optional('UPLOAD_DIR', './uploads'),

  // Optional OIDC SSO configuration — the SSO login flow is enabled only when all
  // three are present (see auth-providers/oidc.provider.ts).
  oidc: {
    issuer: process.env.OIDC_ISSUER,
    clientId: process.env.OIDC_CLIENT_ID,
    clientSecret: process.env.OIDC_CLIENT_SECRET,
    redirectUri: process.env.OIDC_REDIRECT_URI,
  },
} as const;

export function isOidcConfigured(): boolean {
  return Boolean(config.oidc.issuer && config.oidc.clientId && config.oidc.clientSecret);
}

import { config, isOidcConfigured } from '../config.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';
import type { AuthenticatedIdentity } from './types.js';

// Config-driven OIDC (authorization-code flow) that works with any spec-compliant
// provider (Okta, Azure AD, Google, Keycloak, ...). Endpoints come from the issuer's
// discovery document, fetched once and cached for the process lifetime.

interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

let discoveryCache: OidcDiscovery | null = null;

function requireOidcConfig(): { issuer: string; clientId: string; clientSecret: string } {
  if (!isOidcConfigured()) {
    throw new AppError(404, 'SSO_NOT_CONFIGURED', 'SSO is not configured for this deployment');
  }
  return {
    issuer: config.oidc.issuer as string,
    clientId: config.oidc.clientId as string,
    clientSecret: config.oidc.clientSecret as string,
  };
}

export function getOidcRedirectUri(): string {
  return config.oidc.redirectUri ?? `http://localhost:${config.apiPort}/api/auth/sso/callback`;
}

async function getDiscovery(): Promise<OidcDiscovery> {
  if (discoveryCache) return discoveryCache;
  const { issuer } = requireOidcConfig();

  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new AppError(502, 'SSO_DISCOVERY_FAILED', `OIDC discovery failed (${response.status})`);
  }
  const body = (await response.json()) as Partial<OidcDiscovery>;
  if (!body.authorization_endpoint || !body.token_endpoint || !body.userinfo_endpoint) {
    throw new AppError(502, 'SSO_DISCOVERY_FAILED', 'OIDC discovery document is incomplete');
  }
  discoveryCache = {
    authorization_endpoint: body.authorization_endpoint,
    token_endpoint: body.token_endpoint,
    userinfo_endpoint: body.userinfo_endpoint,
  };
  return discoveryCache;
}

export async function buildAuthorizationUrl(state: string): Promise<string> {
  const { clientId } = requireOidcConfig();
  const discovery = await getDiscovery();

  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', getOidcRedirectUri());
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeCodeForIdentity(code: string): Promise<AuthenticatedIdentity> {
  const { clientId, clientSecret } = requireOidcConfig();
  const discovery = await getDiscovery();

  const tokenResponse = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: getOidcRedirectUri(),
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!tokenResponse.ok) {
    logger.warn({ status: tokenResponse.status }, 'OIDC token exchange failed');
    throw new AppError(401, 'SSO_EXCHANGE_FAILED', 'SSO code exchange failed');
  }
  const tokens = (await tokenResponse.json()) as { access_token?: string };
  if (!tokens.access_token) {
    throw new AppError(401, 'SSO_EXCHANGE_FAILED', 'SSO provider returned no access token');
  }

  const userinfoResponse = await fetch(discovery.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userinfoResponse.ok) {
    throw new AppError(401, 'SSO_USERINFO_FAILED', 'Failed to fetch SSO user info');
  }
  const userinfo = (await userinfoResponse.json()) as {
    email?: string;
    name?: string;
    sub?: string;
  };
  if (!userinfo.email) {
    throw new AppError(401, 'SSO_NO_EMAIL', 'SSO provider did not return an email address');
  }

  return {
    email: userinfo.email.toLowerCase().trim(),
    ...(userinfo.name !== undefined ? { displayName: userinfo.name } : {}),
    ...(userinfo.sub !== undefined ? { externalId: userinfo.sub } : {}),
  };
}

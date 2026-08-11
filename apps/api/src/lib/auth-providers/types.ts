// externalId is unused by the local provider — present so a future SSO provider (SAML/OIDC)
// can correlate/auto-provision a user without relying on email matching alone.
export interface AuthenticatedIdentity {
  email: string;
  displayName?: string;
  externalId?: string;
}

export interface AuthProvider {
  readonly id: string;
  authenticate(credentials: unknown): Promise<AuthenticatedIdentity>;
}

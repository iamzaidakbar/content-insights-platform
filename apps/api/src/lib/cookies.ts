import type { Response } from 'express';

import { config } from './config.js';

export const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_PATH = '/api/auth';
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function refreshCookieBase() {
  return {
    httpOnly: true as const,
    sameSite: config.cookieSameSite,
    // SameSite=None requires Secure; production always uses HTTPS on Vercel/API hosts.
    secure: config.isProduction || config.cookieSameSite === 'none',
    path: REFRESH_COOKIE_PATH,
  };
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...refreshCookieBase(),
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  });
}

export function clearRefreshCookie(res: Response): void {
  // Browsers require the same path/sameSite/secure attributes to clear the cookie.
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieBase());
}

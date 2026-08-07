import axios, { isAxiosError } from 'axios';

import type { ApiError, ApiResponse, AuthSession } from '@content-insights/shared';

// Custom per-request flags. Declared via module augmentation so call sites can
// pass `{ skipAuthRefresh: true }` as a normal, type-checked AxiosRequestConfig
// field instead of casting.
declare module 'axios' {
  export interface AxiosRequestConfig {
    /**
     * Opt this request out of the 401 → refresh → retry flow entirely.
     * Used for /auth/login, /auth/register, /auth/logout: a 401 from these
     * means "bad credentials" / "already logged out", not "token expired
     * mid-session" — trying to silently refresh would swallow the real error.
     */
    skipAuthRefresh?: boolean;
  }
  export interface InternalAxiosRequestConfig {
    skipAuthRefresh?: boolean;
    /** Marks a request already retried once post-refresh, to prevent infinite retry loops. */
    _retry?: boolean;
  }
}

// ---------------------------------------------------------------------------
// In-memory access token
// ---------------------------------------------------------------------------
// Deliberately NOT persisted to localStorage/sessionStorage (reduces XSS
// blast radius). Lives only for the life of the JS heap — a full page reload
// clears it, which is why AuthProvider performs a silent /auth/refresh on
// mount to re-derive a session from the httpOnly refresh cookie.
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

// ---------------------------------------------------------------------------
// Auth-failure callback registration
// ---------------------------------------------------------------------------
// This module can't import react-router's useNavigate (it isn't a component/
// hook). AuthProvider registers a handler on mount that clears the session
// and redirects to /login; we call it here when a refresh-and-retry cycle
// definitively fails.
let onAuthFailure: (() => void) | null = null;

export function registerAuthFailureHandler(fn: (() => void) | null): void {
  onAuthFailure = fn;
}

// ---------------------------------------------------------------------------
// Axios instances
// ---------------------------------------------------------------------------
const baseURL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';

export const apiClient = axios.create({
  baseURL,
  withCredentials: true, // sends the httpOnly refreshToken cookie to /api/auth/*
});

// A bare instance with NO interceptors attached, used only for the refresh
// call itself — this is what prevents the response interceptor from
// recursively reacting to a failed refresh.
const refreshClient = axios.create({
  baseURL,
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

// ---------------------------------------------------------------------------
// Refresh, with single-flight dedupe shared by the interceptor AND the
// AuthContext bootstrap query — concurrent 401s (or a StrictMode double
// mount) collapse into one network call.
// ---------------------------------------------------------------------------
let refreshPromise: Promise<AuthSession> | null = null;

export function refreshSession(): Promise<AuthSession> {
  if (!refreshPromise) {
    refreshPromise = refreshClient
      .post<ApiResponse<AuthSession>>('/auth/refresh')
      .then((response) => {
        const body = response.data;
        if (!body.success) {
          throw new Error(body.message);
        }
        setAccessToken(body.data.accessToken);
        return body.data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!isAxiosError(error)) {
      return Promise.reject(error);
    }

    const originalRequest = error.config;

    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest.skipAuthRefresh ||
      originalRequest._retry
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      const session = await refreshSession();
      originalRequest.headers.set('Authorization', `Bearer ${session.accessToken}`);
      return apiClient(originalRequest);
    } catch (refreshError) {
      setAccessToken(null);
      onAuthFailure?.();
      return Promise.reject(refreshError);
    }
  },
);

// ---------------------------------------------------------------------------
// Error-message helper shared by LoginPage/RegisterPage
// ---------------------------------------------------------------------------
export function getApiErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (isAxiosError<ApiError>(error) && error.response) {
    const data: unknown = error.response.data;
    if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
      return data.message;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

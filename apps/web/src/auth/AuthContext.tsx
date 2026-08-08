import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import type { ApiResponse, AuthSession, Organization, User } from '@content-insights/shared';

import {
  apiClient,
  refreshSession,
  registerAuthFailureHandler,
  setAccessToken,
} from '../lib/api-client';

interface SessionData {
  user: User;
  org: Organization;
  permissions: string[];
}

const SESSION_QUERY_KEY = ['session'] as const;

function toSessionData(session: AuthSession): SessionData {
  return { user: session.user, org: session.org, permissions: session.permissions };
}

// The mount-time bootstrap itself. A failed/401 refresh means "not logged
// in" — resolve to null instead of throwing, so react-query never treats
// this as an error state that could leak into a UI error banner.
async function silentRefresh(): Promise<SessionData | null> {
  try {
    return toSessionData(await refreshSession());
  } catch {
    return null;
  }
}

export interface AuthContextValue {
  user: User | null;
  org: Organization | null;
  permissions: string[];
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, orgName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const sessionQuery = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: silentRefresh,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    registerAuthFailureHandler(() => {
      setAccessToken(null);
      queryClient.setQueryData<SessionData | null>(SESSION_QUERY_KEY, null);
      navigate('/login', { replace: true });
    });
    return () => registerAuthFailureHandler(null);
  }, [navigate, queryClient]);

  async function callAuthEndpoint(path: string, body: unknown): Promise<AuthSession> {
    const response = await apiClient.post<ApiResponse<AuthSession>>(path, body, {
      skipAuthRefresh: true,
    });
    if (!response.data.success) {
      throw new Error(response.data.message);
    }
    return response.data.data;
  }

  const loginMutation = useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      callAuthEndpoint('/auth/login', input),
    onSuccess: async (session) => {
      // Cancel any still-in-flight bootstrap refresh so its later resolution
      // can't clobber the session we just set.
      await queryClient.cancelQueries({ queryKey: SESSION_QUERY_KEY });
      setAccessToken(session.accessToken);
      queryClient.setQueryData<SessionData>(SESSION_QUERY_KEY, toSessionData(session));
    },
    // LoginPage already renders its own inline error banner from this same rejection —
    // the global toast (query-client.ts's MutationCache) would just duplicate it.
    meta: { skipToast: true },
  });

  const registerMutation = useMutation({
    mutationFn: (input: { email: string; password: string; orgName: string }) =>
      callAuthEndpoint('/auth/register', input),
    onSuccess: async (session) => {
      await queryClient.cancelQueries({ queryKey: SESSION_QUERY_KEY });
      setAccessToken(session.accessToken);
      queryClient.setQueryData<SessionData>(SESSION_QUERY_KEY, toSessionData(session));
    },
    meta: { skipToast: true },
  });

  const logoutMutation = useMutation({
    mutationFn: () => apiClient.post('/auth/logout', undefined, { skipAuthRefresh: true }),
    // onSettled (not onSuccess): logout must clear client-side state even if
    // the network call fails — the user should never be "stuck" logged in.
    onSettled: () => {
      setAccessToken(null);
      queryClient.setQueryData<SessionData | null>(SESSION_QUERY_KEY, null);
      queryClient.clear();
    },
    meta: { skipToast: true },
  });

  const session = sessionQuery.data ?? null;

  const value: AuthContextValue = {
    user: session?.user ?? null,
    org: session?.org ?? null,
    permissions: session?.permissions ?? [],
    isLoading: sessionQuery.isLoading,
    isAuthenticated: session !== null,
    login: async (email, password) => {
      await loginMutation.mutateAsync({ email, password });
    },
    register: async (email, password, orgName) => {
      await registerMutation.mutateAsync({ email, password, orgName });
    },
    logout: async () => {
      await logoutMutation.mutateAsync();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- standard AuthContext pattern (AuthProvider + useAuth), the Fast Refresh warning is a known accepted false positive here
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

import { MutationCache, QueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import toast from 'react-hot-toast';

import { getApiErrorMessage } from './api-client';

export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    // Systemic net for every useMutation call in the app — individual mutations don't
    // need their own onError just to surface a toast. A mutation can opt out (e.g. when
    // it already renders its own inline form error and a toast would just be noisy
    // duplication) via `useMutation({ ..., meta: { skipToast: true } })`.
    onError: (error, _variables, _onMutateResult, mutation) => {
      if (mutation.meta?.skipToast === true) {
        return;
      }
      toast.error(getApiErrorMessage(error, 'Something went wrong. Please try again.'));
    },
  }),
  defaultOptions: {
    queries: {
      // 401s are handled by the axios response interceptor's refresh-and-
      // retry flow — react-query retrying on top of that would just hammer
      // an endpoint that's already failed for good (expired refresh token).
      retry: (failureCount, error) => {
        if (isAxiosError(error) && error.response?.status === 401) {
          return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    },
    mutations: {
      retry: false,
    },
  },
});

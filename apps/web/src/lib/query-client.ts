import { QueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';

export const queryClient = new QueryClient({
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

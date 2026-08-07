import type { ApiSuccess } from '@content-insights/shared';

export function success<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

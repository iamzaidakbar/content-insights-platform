export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFieldError {
  field: string;
  message: string;
}

export interface ApiError {
  success: false;
  message: string;
  code: string;
  requestId?: string;
  fields?: ApiFieldError[];
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

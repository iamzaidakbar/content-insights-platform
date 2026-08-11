import { isAxiosError } from 'axios';

import type {
  ApiError,
  ApiResponse,
  Article,
  FilterPanelState,
  PaginatedResult,
  SavedSearchType,
  SavedSearchWithViewerState,
} from '@content-insights/shared';

import { apiClient } from './api-client';

// ---------------------------------------------------------------------------------------
// Mirrors apps/api/src/routes/channel.routes.ts. A "channel" is not its own resource — it's
// a SavedSearch with isChannel: true, enriched here with this viewer's own ChannelView-
// derived state (SavedSearchWithViewerState). Exposing/demoting a channel and sharing it into
// groups are saved-search actions and live in ./saved-searches-api instead.
// ---------------------------------------------------------------------------------------

function unwrap<T>(body: ApiResponse<T>): T {
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// ---------------------------------------------------------------------------------------
// "Not found or access denied" — GET /:id and GET /:id/open deliberately return the exact
// same generic 404 (same code, same message) whether the channel doesn't exist or the caller
// simply lacks visibility into it (see channel.routes.ts's own comment: never leak
// "unauthorized" vs. "missing"). It arrives here as a plain 404 AxiosError, indistinguishable
// at the HTTP layer from any other 404 — so it's translated into its own ChannelAccessError
// class specifically so a later UI phase can catch THIS one case and show a friendly "this
// channel isn't available to you" message, while every other failure (network drop, 500,
// validation) still surfaces as a normal error via getApiErrorMessage.
// ---------------------------------------------------------------------------------------
export class ChannelAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChannelAccessError';
  }
}

function isChannelNotFoundError(err: unknown): boolean {
  return (
    isAxiosError<ApiError>(err) &&
    err.response?.status === 404 &&
    err.response.data?.code === 'CHANNEL_NOT_FOUND'
  );
}

// Shared by fetchChannel/openChannel below — awaits the axios call, unwraps the ApiResponse
// envelope, and re-throws CHANNEL_NOT_FOUND specifically as ChannelAccessError. Every other
// rejection (network error, 401/403/500, or a same-shaped `success:false` body) passes
// through unchanged.
async function unwrapChannelRequest<T>(request: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  try {
    const { data: body } = await request;
    return unwrap(body);
  } catch (err) {
    if (isChannelNotFoundError(err)) {
      const message = isAxiosError<ApiError>(err) ? err.response?.data.message : undefined;
      throw new ChannelAccessError(message ?? 'Channel not found or access denied');
    }
    throw err;
  }
}

export const CHANNEL_LIST_SORTS = ['lastViewed_desc', 'lastViewed_asc'] as const;
export type ChannelListSort = (typeof CHANNEL_LIST_SORTS)[number];

export interface FetchChannelsOptions {
  groupId?: string;
  sort?: ChannelListSort; // server default: 'lastViewed_desc'. Never-viewed channels always sort last, either direction.
  type?: SavedSearchType;
  page?: number;
}

export async function fetchChannels(
  opts: FetchChannelsOptions = {},
): Promise<PaginatedResult<SavedSearchWithViewerState>> {
  const { groupId, sort, type, page = 1 } = opts;
  const response = await apiClient.get<ApiResponse<PaginatedResult<SavedSearchWithViewerState>>>('/channels', {
    params: {
      ...(groupId ? { groupId } : {}),
      ...(sort ? { sort } : {}),
      ...(type ? { type } : {}),
      page,
    },
  });
  return unwrap(response.data);
}

// GET /:id — a single channel with this viewer's state. Generic 404 on missing/unauthorized;
// see ChannelAccessError above.
export async function fetchChannel(id: string): Promise<SavedSearchWithViewerState> {
  return unwrapChannelRequest(apiClient.get<ApiResponse<SavedSearchWithViewerState>>(`/channels/${id}`));
}

// The "open channel" action — always upserts this viewer's ChannelView (lastViewedAt: now),
// clearing their "new" badge, regardless of type. Hands back whatever the channel actually
// IS: filters to run (dynamic) or the frozen locationHash-based article set (snapshot). Not
// part of the canonical packages/shared contract (API-internal, mirrors apps/api's
// OpenedChannel exactly) — re-declared here rather than invented from scratch.
export type OpenChannelResult =
  | { id: string; name: string; type: 'dynamic'; filters: FilterPanelState; total: number }
  | { id: string; name: string; type: 'snapshot'; filters: FilterPanelState; articles: Article[]; total: number };

export async function openChannel(id: string): Promise<OpenChannelResult> {
  return unwrapChannelRequest(apiClient.get<ApiResponse<OpenChannelResult>>(`/channels/${id}/open`));
}

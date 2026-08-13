import {
  DEFAULT_TEAMS_MAX_ARTICLES_PER_SHARE,
  type ApiResponse,
  type PaginatedResult,
  type TeamsShareRecord,
  type TeamsShareRequestInput,
} from '@content-insights/shared';

import { apiClient } from './api-client';

// Mirrors teams.routes.ts's own MAX_MESSAGE_LENGTH constant. Applied on top of
// teamsShareRequestSchema's generous 2000-char sanity ceiling — not itself part of the wire
// contract (so it isn't exported from @content-insights/shared), but duplicated here so the
// share composer can reject an over-long message before round-tripping to the server.
export const TEAMS_MESSAGE_MAX_LENGTH = 1000;

// Outer sanity ceiling — matches teamsShareRequestSchema's `articles` array cap. The org's
// own (potentially tighter) configured limit lives in GlobalSettings.msTeams.maxArticlesPerShare
// (see global-settings-api.ts's fetchGlobalSettings) and is enforced again server-side; this
// constant is only ever the upper bound a client should never exceed regardless of org config.
export const TEAMS_MAX_ARTICLES_PER_SHARE = DEFAULT_TEAMS_MAX_ARTICLES_PER_SHARE;

// POST /api/teams/share — ms-teams:share. No live MS Graph credentials are configured in
// this environment, so the server records the share (TeamsShareRecord, simulated: true)
// rather than posting to a real Teams channel — see teams.routes.ts's module comment.
export async function shareToTeams(input: TeamsShareRequestInput): Promise<TeamsShareRecord> {
  const response = await apiClient.post<ApiResponse<TeamsShareRecord>>('/teams/share', input);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function fetchTeamsShares(page = 1): Promise<PaginatedResult<TeamsShareRecord>> {
  const response = await apiClient.get<ApiResponse<PaginatedResult<TeamsShareRecord>>>('/teams/shares', {
    params: { page },
  });
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

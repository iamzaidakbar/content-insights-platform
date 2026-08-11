import { z } from 'zod';

import { DEFAULT_TEAMS_MAX_ARTICLES_PER_SHARE } from '../types/global-settings.js';

export const teamsShareArticleRefSchema = z
  .object({
    title: z.string().min(1),
    url: z.string().min(1),
  })
  .strict();

// POST /api/ms-teams/share — ms-teams:share. articles is capped at the system default;
// the per-org configurable limit (GlobalSettings.msTeams.maxArticlesPerShare) is enforced
// in application code, since it can only be smaller than this sanity cap, never larger.
export const teamsShareRequestSchema = z
  .object({
    message: z.string().trim().max(2000),
    mentions: z.array(z.string().trim().min(1)).default([]),
    articles: z.array(teamsShareArticleRefSchema).min(1).max(DEFAULT_TEAMS_MAX_ARTICLES_PER_SHARE),
    useAppDeepLink: z.boolean().default(true),
  })
  .strict();
export type TeamsShareRequestInput = z.infer<typeof teamsShareRequestSchema>;

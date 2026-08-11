import type { GlobalSettingsId, OrgId } from '../ids.js';

export const DEFAULT_MAX_SNAPSHOT_ARTICLES = 200;
export const DEFAULT_TEAMS_MAX_ARTICLES_PER_SHARE = 25;

export interface MsTeamsGlobalSettings {
  hideIcons: boolean;
  maxArticlesPerShare: number;
  defaultBulkMessage: string;
}

export interface ArticleFieldMappingSettings {
  titleConceptKey?: string | null;
  locationConceptKey?: string | null;
  publishedDateConceptKey?: string | null;
}

export interface GlobalSettings {
  id: GlobalSettingsId;
  orgId: OrgId;
  maxSnapshotArticles: number;
  msTeams: MsTeamsGlobalSettings;
  articleFieldMapping: ArticleFieldMappingSettings;
  updatedAt: string;
}

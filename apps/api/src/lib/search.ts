import {
  asDocumentId,
  type DocumentFileType,
  type SearchHit,
  type SearchResponse,
} from '@content-insights/shared';

import { esClient, getOrgIndexName, type EsChunkDocument } from './elasticsearch.js';

export interface SearchParams {
  query: string;
  // zod's .optional() infers `T | undefined`, not just an absent key — match that
  // shape exactly so callers can spread a parsed zod result straight in under
  // exactOptionalPropertyTypes.
  projectIds?: string[] | undefined;
  fileTypes?: DocumentFileType[] | undefined;
  orgId: string;
  page: number;
  size: number;
}

const HIGHLIGHT_FRAGMENT_SIZE = 150;

// Separated from executeSearch so query-building is unit-testable without a live ES connection.
export function buildSearchQuery(params: SearchParams): Record<string, unknown> {
  const { query, projectIds, fileTypes, page, size } = params;

  const filter: Record<string, unknown>[] = [
    { term: { orgId: params.orgId } }, // always present — never queries across orgs
  ];
  if (projectIds && projectIds.length > 0) {
    filter.push({ terms: { projectId: projectIds } });
  }
  if (fileTypes && fileTypes.length > 0) {
    filter.push({ terms: { fileType: fileTypes } });
  }

  return {
    query: {
      bool: {
        must: [{ multi_match: { query, fields: ['title', 'content'] } }],
        filter,
      },
    },
    highlight: {
      fields: { content: { fragment_size: HIGHLIGHT_FRAGMENT_SIZE } },
      pre_tags: ['<mark>'],
      post_tags: ['</mark>'],
    },
    from: (page - 1) * size,
    size,
    track_total_hits: true,
  };
}

export async function executeSearch(params: SearchParams): Promise<SearchResponse> {
  const index = getOrgIndexName(params.orgId);
  const body = buildSearchQuery(params);

  const response = await esClient.search<EsChunkDocument>({ index, ...body });

  const totalRaw = response.hits.total;
  const total = typeof totalRaw === 'number' ? totalRaw : (totalRaw?.value ?? 0);

  const hits: SearchHit[] = response.hits.hits.map((hit) => {
    const source = hit._source;
    const highlightFragments = hit.highlight?.content ?? [];
    return {
      docId: asDocumentId(source?.docId ?? ''),
      title: source?.title ?? '',
      score: hit._score ?? 0,
      highlight: highlightFragments.join(' … '),
      metadata: source?.metadata ?? {},
      fileType: (source?.fileType ?? 'txt') as DocumentFileType,
      createdAt: source?.createdAt ?? new Date(0).toISOString(),
    };
  });

  return { hits, total, page: params.page, size: params.size, took: response.took };
}

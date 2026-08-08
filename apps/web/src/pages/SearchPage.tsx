import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import type { DocumentFileType } from '@content-insights/shared';

import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { getApiErrorMessage } from '../lib/api-client';
import { fetchProjectIds } from '../lib/documents-api';
import { searchDocuments } from '../lib/search-api';
import FileTypeBadge from '../components/FileTypeBadge';
import HighlightedSnippet from '../components/HighlightedSnippet';
import ScoreBar from '../components/ScoreBar';

const FILE_TYPE_OPTIONS: DocumentFileType[] = ['pdf', 'docx', 'txt'];
const FILE_TYPE_SET: ReadonlySet<string> = new Set(FILE_TYPE_OPTIONS);
const RESULTS_PAGE_SIZE = 10;
const SKELETON_RESULT_COUNT = 5;
const DEBOUNCE_MS = 300;

function parseFileTypes(params: URLSearchParams): DocumentFileType[] {
  return params
    .getAll('fileTypes')
    .filter((value): value is DocumentFileType => FILE_TYPE_SET.has(value));
}
function parsePage(params: URLSearchParams): number {
  const raw = Number(params.get('page') ?? '1');
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

function SkeletonResult() {
  return (
    <li className="rounded-md border border-slate-900 p-4">
      <div className="h-4 w-1/2 animate-pulse rounded bg-slate-800" />
      <div className="mt-3 h-3 w-full animate-pulse rounded bg-slate-800" />
      <div className="mt-2 h-3 w-5/6 animate-pulse rounded bg-slate-800" />
      <div className="mt-3 flex items-center gap-3">
        <div className="h-5 w-14 animate-pulse rounded-full bg-slate-800" />
        <div className="h-1.5 w-16 animate-pulse rounded-full bg-slate-800" />
      </div>
    </li>
  );
}

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [rawQuery, setRawQuery] = useState(() => searchParams.get('q') ?? '');
  const debouncedQuery = useDebouncedValue(rawQuery, DEBOUNCE_MS);
  const trimmedQuery = debouncedQuery.trim();

  const fileTypes = useMemo(() => parseFileTypes(searchParams), [searchParams]);
  const projectIds = useMemo(() => searchParams.getAll('projectIds'), [searchParams]);
  const page = parsePage(searchParams);

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjectIds,
    staleTime: 5 * 60_000,
  });
  const projectOptions = projectsQuery.data ?? [];

  // Sync debounced query -> URL. Deliberately keyed ONLY on trimmedQuery (not
  // searchParams/setSearchParams): setSearchParams's identity changes on every
  // navigation (it's useCallback([navigate, searchParams]), and searchParams is
  // useMemo'd on location.search), including the page/filter updates below.
  // Depending on it here would re-run this effect and reset page back to 1
  // whenever the user merely clicked Next or toggled a filter. The early-return
  // also makes bookmarked deep links (e.g. ?page=3) keep their page on mount
  // instead of being stomped to page 1.
  useEffect(() => {
    const currentQ = searchParams.get('q') ?? '';
    if (currentQ === trimmedQuery) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (trimmedQuery) next.set('q', trimmedQuery);
        else next.delete('q');
        next.set('page', '1');
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedQuery]);

  function toggleListParam(key: 'fileTypes' | 'projectIds', value: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const current = next.getAll(key);
        next.delete(key);
        const updated = current.includes(value)
          ? current.filter((entry) => entry !== value)
          : [...current, value];
        updated.forEach((entry) => next.append(key, entry));
        next.set('page', '1');
        return next;
      },
      { replace: true },
    );
  }

  function goToPage(nextPage: number) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', String(nextPage));
      return next;
    });
  }

  const hasQuery = trimmedQuery.length > 0;

  const searchQuery = useQuery({
    queryKey: ['search', trimmedQuery, fileTypes, projectIds, page],
    queryFn: () =>
      searchDocuments({
        query: trimmedQuery,
        fileTypes,
        projectIds,
        page,
        size: RESULTS_PAGE_SIZE,
      }),
    enabled: hasQuery,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });

  const result = searchQuery.data;
  const hits = result?.hits ?? [];
  const total = result?.total ?? 0;
  const size = result?.size ?? RESULTS_PAGE_SIZE;
  const totalPages = total > 0 && size > 0 ? Math.ceil(total / size) : 1;
  const maxScore = hits.reduce((max, hit) => Math.max(max, hit.score), 0);

  const showZeroResults =
    hasQuery && !searchQuery.isLoading && !searchQuery.isError && hits.length === 0;
  const showResultsList =
    hasQuery && !searchQuery.isError && (searchQuery.isLoading || hits.length > 0);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-12 text-slate-100">
      <div className="mx-auto w-full max-w-5xl">
        <div>
          <h1 className="text-2xl font-semibold">Search</h1>
          <p className="mt-1 text-sm text-slate-400">
            Search across documents in your organization.
          </p>
        </div>

        <div className="mt-6">
          <label htmlFor="search-query" className="sr-only">
            Search documents
          </label>
          <input
            id="search-query"
            type="search"
            value={rawQuery}
            onChange={(event) => setRawQuery(event.target.value)}
            placeholder="Search documents…"
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
          />
        </div>

        {searchQuery.isError ? (
          <p className="mt-6 text-sm text-red-400">
            {getApiErrorMessage(searchQuery.error, 'Unable to search documents.')}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-8 md:flex-row">
          <aside className="w-full shrink-0 space-y-6 md:w-56">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                File type
              </h2>
              <div className="mt-2 space-y-2">
                {FILE_TYPE_OPTIONS.map((fileType) => (
                  <label key={fileType} className="flex items-center gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={fileTypes.includes(fileType)}
                      onChange={() => toggleListParam('fileTypes', fileType)}
                      className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-slate-100 focus:ring-0"
                    />
                    {fileType.toUpperCase()}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Project
              </h2>
              <div className="mt-2 space-y-2">
                {projectsQuery.isLoading ? (
                  Array.from({ length: 3 }, (_, index) => (
                    <div key={index} className="h-4 w-24 animate-pulse rounded bg-slate-800" />
                  ))
                ) : projectsQuery.isError ? (
                  <p className="text-xs text-red-400">Unable to load projects.</p>
                ) : projectOptions.length === 0 ? (
                  <p className="text-xs text-slate-500">No projects yet.</p>
                ) : (
                  projectOptions.map((projectId) => (
                    <label
                      key={projectId}
                      className="flex items-center gap-2 text-sm text-slate-300"
                    >
                      <input
                        type="checkbox"
                        checked={projectIds.includes(projectId)}
                        onChange={() => toggleListParam('projectIds', projectId)}
                        className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-slate-100 focus:ring-0"
                      />
                      <span className="truncate">{projectId}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </aside>

          <div className="min-w-0 flex-1">
            {!hasQuery ? (
              <p className="py-12 text-center text-slate-400">
                Start typing to search your organization&apos;s documents.
              </p>
            ) : (
              <>
                {!searchQuery.isLoading && result ? (
                  <p className="text-xs text-slate-500">
                    {total} result{total === 1 ? '' : 's'} · {result.took}ms
                  </p>
                ) : null}

                {showResultsList ? (
                  <ul className="mt-3 space-y-3">
                    {searchQuery.isLoading
                      ? Array.from({ length: SKELETON_RESULT_COUNT }, (_, index) => (
                          <SkeletonResult key={index} />
                        ))
                      : hits.map((hit) => (
                          <li
                            key={hit.docId}
                            className="rounded-md border border-slate-900 p-4 transition hover:border-slate-700"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <h3 className="text-sm font-medium text-slate-100">{hit.title}</h3>
                              <FileTypeBadge fileType={hit.fileType} />
                            </div>
                            <p className="mt-2 text-sm leading-relaxed text-slate-400">
                              <HighlightedSnippet fragment={hit.highlight} />
                            </p>
                            <div className="mt-3">
                              <ScoreBar score={hit.score} maxScore={maxScore} />
                            </div>
                          </li>
                        ))}
                  </ul>
                ) : null}

                {showZeroResults ? (
                  <div className="py-12 text-center">
                    <p className="text-slate-400">No results for &quot;{trimmedQuery}&quot;.</p>
                  </div>
                ) : null}

                {!searchQuery.isLoading && hits.length > 0 ? (
                  <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => goToPage(page - 1)}
                      className="rounded-md border border-slate-700 px-3 py-1.5 text-slate-100 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Prev
                    </button>
                    <span>
                      Page {page} of {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => goToPage(page + 1)}
                      className="rounded-md border border-slate-700 px-3 py-1.5 text-slate-100 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

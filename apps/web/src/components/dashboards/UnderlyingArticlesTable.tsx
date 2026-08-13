import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import type { FilterPanelState } from '@content-insights/shared';

import { getApiErrorMessage } from '../../lib/api-client';
import { formatDate } from '../../lib/format';
import { searchArticles } from '../../lib/search-api';
import Pagination from '../Pagination';

const PAGE_SIZE = 5;

interface UnderlyingArticlesTableProps {
  filters: FilterPanelState;
}

// The raw articles behind an insight's chart, run through the same POST /api/search the
// insight's sourceFilters were captured from — always a valid thing to show (every insight
// has a well-defined matching article set), but the brief calls this out as specifically
// relevant for date/time-oriented charts, so InsightTile only offers the toggle, never
// forces it open.
export default function UnderlyingArticlesTable({ filters }: UnderlyingArticlesTableProps) {
  const [page, setPage] = useState(1);
  const searchQuery = useQuery({
    queryKey: ['insight-underlying-articles', filters, page],
    queryFn: () => searchArticles({ filters, page, size: PAGE_SIZE }),
  });

  if (searchQuery.isLoading) {
    return <div className="h-20 animate-pulse rounded-md bg-accent" />;
  }
  if (searchQuery.isError) {
    return (
      <p className="py-2 text-xs text-destructive">
        {getApiErrorMessage(searchQuery.error, 'Unable to load matching articles.')}
      </p>
    );
  }

  const hits = searchQuery.data?.hits ?? [];
  const totalPages = searchQuery.data ? Math.max(1, Math.ceil(searchQuery.data.total / PAGE_SIZE)) : 0;

  if (hits.length === 0) {
    return <p className="py-2 text-xs text-muted-foreground">No matching articles.</p>;
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">Title</th>
              <th className="px-2 py-1.5 font-medium">Domain</th>
              <th className="px-2 py-1.5 font-medium">Published</th>
            </tr>
          </thead>
          <tbody>
            {hits.map((hit) => (
              <tr key={hit.articleId} className="border-b border-border last:border-0">
                <td className="max-w-[240px] truncate px-2 py-1.5 text-foreground">
                  <Link to={`/articles/${hit.articleId}`} className="hover:text-primary">
                    {hit.title}
                  </Link>
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{hit.domain || '—'}</td>
                <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">
                  {hit.publishedAt ? formatDate(hit.publishedAt) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 ? (
        <div className="flex justify-end border-t border-border p-1">
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      ) : null}
    </div>
  );
}

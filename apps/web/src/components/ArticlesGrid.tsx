import type { CSSProperties } from 'react';
import { ChevronsDownUp, ChevronsUpDown, FileSearch } from 'lucide-react';

import type { Concept, ResultViewMode, SearchHit, UserTag } from '@content-insights/shared';

import { VIEW_MODE_COLUMNS } from '../lib/article-layout';
import ArticleCard from './ArticleCard';
import ArticleCardSkeleton from './ArticleCardSkeleton';
import ArticlesErrorState from './ArticlesErrorState';
import EmptyState from './EmptyState';
import Pagination from './Pagination';

export interface ArticlesGridProps {
  hits: SearchHit[];
  viewMode: ResultViewMode;
  contentLines: number;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string | undefined;
  onRetry: () => void;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  selectedIds: Set<string>;
  onSelect: (id: string, selected: boolean) => void;
  onSelectAllOnPage: (selected: boolean) => void;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onToggleExpandAll: () => void;
  concepts: Concept[];
  tagsById: Map<string, UserTag>;
  canHide: boolean;
  hidePendingId: string | null;
  onHideToggle: (id: string, hidden: boolean) => void;
  onOpenTagPicker: (id: string) => void;
  onTaxonomyValueClick: (conceptKey: string, value: string) => void;
  onTagChipClick: (tagId: string) => void;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** When false, the parent owns pagination (e.g. sticky page footer). Default true. */
  showPagination?: boolean;
}

/** Layout for the results container — inline gridTemplateColumns so columns always apply
 *  (Tailwind cannot see dynamically interpolated arbitrary class names). */
function resultsLayout(viewMode: ResultViewMode): { className: string; style?: CSSProperties } {
  if (viewMode === 'list') {
    return { className: 'flex flex-col gap-1.5' };
  }
  const columns = VIEW_MODE_COLUMNS[viewMode];
  return {
    className: 'gap-2.5 [&>*]:min-h-0',
    style: {
      display: 'grid',
      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      alignItems: 'stretch',
    },
  };
}

export default function ArticlesGrid({
  hits,
  viewMode,
  contentLines,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  hasActiveFilters,
  onClearFilters,
  selectedIds,
  onSelect,
  onSelectAllOnPage,
  expandedIds,
  onToggleExpand,
  onToggleExpandAll,
  concepts,
  tagsById,
  canHide,
  hidePendingId,
  onHideToggle,
  onOpenTagPicker,
  onTaxonomyValueClick,
  onTagChipClick,
  page,
  totalPages,
  onPageChange,
  showPagination = true,
}: ArticlesGridProps) {
  const allOnPageSelected = hits.length > 0 && hits.every((hit) => selectedIds.has(hit.articleId));
  const allOnPageExpanded = hits.length > 0 && hits.every((hit) => expandedIds.has(hit.articleId));
  const layout = resultsLayout(viewMode);

  function renderBody() {
    if (isLoading) {
      const skeletonCount = Math.min(hits.length || 12, viewMode === 'list' ? 10 : 12);
      return (
        <div className={layout.className} style={layout.style} data-view-mode={viewMode}>
          {Array.from({ length: skeletonCount || 6 }, (_, index) => (
            <ArticleCardSkeleton key={index} viewMode={viewMode} contentLines={contentLines} />
          ))}
        </div>
      );
    }

    if (isError) {
      return <ArticlesErrorState message={errorMessage ?? 'Something went wrong.'} onRetry={onRetry} />;
    }

    if (hits.length === 0) {
      return (
        <EmptyState
          icon={FileSearch}
          title="No articles found"
          description="Try adjusting your filters or search terms."
          action={
            hasActiveFilters ? (
              <button
                type="button"
                onClick={onClearFilters}
                className="flex h-9 items-center rounded-md border border-border px-4 text-sm text-foreground transition-colors hover:border-primary"
              >
                Clear filters
              </button>
            ) : undefined
          }
        />
      );
    }

    return (
      <div className={layout.className} style={layout.style} data-view-mode={viewMode}>
        {hits.map((hit) => (
          <ArticleCard
            key={hit.articleId}
            hit={hit}
            viewMode={viewMode}
            contentLines={contentLines}
            isSelected={selectedIds.has(hit.articleId)}
            onSelect={onSelect}
            isExpanded={expandedIds.has(hit.articleId)}
            onToggleExpand={onToggleExpand}
            concepts={concepts}
            tagsById={tagsById}
            canHide={canHide}
            isHidePending={hidePendingId === hit.articleId}
            onHideToggle={onHideToggle}
            onOpenTagPicker={onOpenTagPicker}
            onTaxonomyValueClick={onTaxonomyValueClick}
            onTagChipClick={onTagChipClick}
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      {!isLoading && !isError && hits.length > 0 ? (
        <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={allOnPageSelected}
              onChange={(event) => onSelectAllOnPage(event.target.checked)}
              aria-label="Select all articles on this page"
              className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-primary"
            />
            <span>Select all on this page</span>
          </label>
          <button
            type="button"
            onClick={onToggleExpandAll}
            className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            {allOnPageExpanded ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
            {allOnPageExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      ) : null}

      {renderBody()}

      {showPagination && !isLoading && !isError && hits.length > 0 ? (
        <div className="mt-4 flex justify-end">
          <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
        </div>
      ) : null}
    </div>
  );
}

import { FixedSizeGrid, FixedSizeList } from 'react-window';

import type { SearchLayout } from '@content-insights/shared';

import { useSettings } from '../settings/SettingsContext';
import { useElementSize } from '../hooks/useElementSize';
import { CARD_HEIGHT } from '../lib/article-layout';
import ArticleCard from './ArticleCard';
import ArticleCardSkeleton from './ArticleCardSkeleton';
import ArticlesErrorState from './ArticlesErrorState';
import EmptyArticlesState from './EmptyArticlesState';
import Pagination from './Pagination';

export interface ArticleGridItem {
  id: string;
  title: string;
  url?: string | undefined;
  source?: string | undefined;
  publishDate: string;
  snippet: string;
  tags: string[];
}

interface ArticlesGridProps {
  items: ArticleGridItem[];
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry: () => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
  selectedIds: Set<string>;
  onSelect: (id: string, selected: boolean) => void;
  onSelectAll: (selected: boolean) => void;
  onTag: (id: string) => void;
  onShare: (id: string) => void;
  onBookmark: (id: string) => void;
  onEdit: (id: string) => void;
  onTagClick: (tag: string) => void;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  skeletonCount: number;
}

// Above this, switch from plain CSS grid/flex to react-window virtualization. Note: with
// the current settings.search.defaultPageSize enum capped at 48, a single page of results
// can never actually reach 51 — this path is real and exercised in isolation, but not
// reachable through today's UI without a larger page size existing somewhere upstream.
const VIRTUALIZE_THRESHOLD = 50;
const GRID_GAP = 12; // matches gap-3

const COLUMN_COUNT: Record<SearchLayout, number> = { '3col': 3, '2col': 2, '1col': 1, dense: 1 };
const MIN_COLUMN_WIDTH: Record<SearchLayout, number> = { '3col': 320, '2col': 0, '1col': 0, dense: 0 };

function nonVirtualizedGridClassName(layout: SearchLayout): string {
  switch (layout) {
    case '3col':
      return 'grid gap-3 [grid-template-columns:repeat(3,minmax(320px,1fr))]';
    case '2col':
      return 'grid grid-cols-2 gap-3';
    case '1col':
      return 'grid grid-cols-1 gap-3';
    case 'dense':
      return 'flex flex-col gap-1.5';
  }
}

export default function ArticlesGrid({
  items,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  onClearFilters,
  hasActiveFilters,
  selectedIds,
  onSelect,
  onSelectAll,
  onTag,
  onShare,
  onBookmark,
  onEdit,
  onTagClick,
  page,
  totalPages,
  onPageChange,
  skeletonCount,
}: ArticlesGridProps) {
  const { settings } = useSettings();
  const layout = settings.search.defaultLayout;
  const [containerRef, { width: containerWidth }] = useElementSize<HTMLDivElement>();

  const allOnPageSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id));

  function renderCard(item: ArticleGridItem) {
    return (
      <ArticleCard
        key={item.id}
        id={item.id}
        title={item.title}
        url={item.url}
        source={item.source}
        publishDate={item.publishDate}
        snippet={item.snippet}
        tags={item.tags}
        isSelected={selectedIds.has(item.id)}
        onSelect={onSelect}
        onTag={onTag}
        onShare={onShare}
        onBookmark={onBookmark}
        onEdit={onEdit}
        onTagClick={onTagClick}
      />
    );
  }

  function renderBody() {
    if (isLoading) {
      return (
        <div className={nonVirtualizedGridClassName(layout)}>
          {Array.from({ length: skeletonCount }, (_, index) => (
            <ArticleCardSkeleton key={index} layout={layout} />
          ))}
        </div>
      );
    }

    if (isError) {
      return <ArticlesErrorState message={errorMessage ?? 'Something went wrong.'} onRetry={onRetry} />;
    }

    if (items.length === 0) {
      return <EmptyArticlesState onClearFilters={onClearFilters} hasActiveFilters={hasActiveFilters} />;
    }

    if (items.length <= VIRTUALIZE_THRESHOLD) {
      return <div className={nonVirtualizedGridClassName(layout)}>{items.map(renderCard)}</div>;
    }

    // Virtualized path (react-window) — grid modes use FixedSizeGrid, list/dense modes
    // use FixedSizeList. Column/row sizing is computed from the measured container width
    // (see useElementSize) since react-window needs concrete pixel dimensions up front.
    const cardHeight = CARD_HEIGHT[layout];
    const viewportHeight = Math.min(800, Math.max(cardHeight * 2, window.innerHeight * 0.7));

    if (layout === '1col' || layout === 'dense') {
      return (
        <div ref={containerRef}>
          {containerWidth > 0 ? (
            <FixedSizeList
              height={viewportHeight}
              width={containerWidth}
              itemCount={items.length}
              itemSize={cardHeight + GRID_GAP}
            >
              {({ index, style }) => {
                const item = items[index];
                if (!item) {
                  return null;
                }
                return (
                  <div style={{ ...style, paddingBottom: GRID_GAP }}>{renderCard(item)}</div>
                );
              }}
            </FixedSizeList>
          ) : null}
        </div>
      );
    }

    const columnCount = COLUMN_COUNT[layout];
    const minWidth = MIN_COLUMN_WIDTH[layout];
    const columnWidth =
      containerWidth > 0
        ? Math.max(minWidth, Math.floor((containerWidth - GRID_GAP * (columnCount - 1)) / columnCount))
        : 0;
    const rowCount = Math.ceil(items.length / columnCount);

    return (
      <div ref={containerRef}>
        {containerWidth > 0 ? (
          <FixedSizeGrid
            columnCount={columnCount}
            columnWidth={columnWidth + GRID_GAP}
            rowCount={rowCount}
            rowHeight={cardHeight + GRID_GAP}
            height={viewportHeight}
            width={containerWidth}
          >
            {({ columnIndex, rowIndex, style }) => {
              const item = items[rowIndex * columnCount + columnIndex];
              if (!item) {
                return null;
              }
              return (
                <div style={{ ...style, paddingRight: GRID_GAP, paddingBottom: GRID_GAP }}>
                  {renderCard(item)}
                </div>
              );
            }}
          </FixedSizeGrid>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      {!isLoading && !isError && items.length > 0 ? (
        <div className="mb-3 flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={allOnPageSelected}
            onChange={(event) => onSelectAll(event.target.checked)}
            aria-label="Select all articles on this page"
            className="h-4 w-4 cursor-pointer rounded border-[var(--border)] accent-[var(--accent)]"
          />
          <span>Select all on this page</span>
        </div>
      ) : null}

      {renderBody()}

      {!isLoading && !isError && items.length > 0 ? (
        <div className="mt-6 flex justify-end">
          <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
        </div>
      ) : null}
    </div>
  );
}

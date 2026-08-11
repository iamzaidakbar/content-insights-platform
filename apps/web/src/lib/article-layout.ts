import type { ResultViewMode } from '@content-insights/shared';

// Fixed page size per view mode, per the product brief: list ~50/page, 2x2 grid = 4/page,
// 3x4 grid = 12/page. Drives both the search/facets request `size` and the Pagination
// component's totalPages math — there is no separate "results per page" control, the
// view-mode toggle IS the page-size control.
export const VIEW_MODE_PAGE_SIZE: Record<ResultViewMode, number> = {
  list: 50,
  grid2x2: 4,
  grid3x4: 12,
};

// Column count backing each grid view mode's CSS grid — "2x2"/"3x4" name the visible
// row/column shape at exactly one page size (4 or 12 items), not a fixed row count that
// would apply to a shorter last page.
export const VIEW_MODE_COLUMNS: Record<ResultViewMode, number> = {
  list: 1,
  grid2x2: 2,
  grid3x4: 3,
};

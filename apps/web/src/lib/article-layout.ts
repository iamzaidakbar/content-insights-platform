import type { SearchLayout } from '@content-insights/shared';

// Fixed per-mode card heights — shared by ArticleCard (renders at this height),
// ArticleCardSkeleton (matches it so the loading state doesn't jump), and ArticlesGrid
// (needs it for react-window's Fixed*Grid/Fixed*List row/column sizing). Lives in its own
// module rather than being exported from ArticleCard.tsx to keep that file
// component-only (co-locating a plain constant there trips the
// react-refresh/only-export-components lint rule).
export const CARD_HEIGHT: Record<SearchLayout, number> = {
  '3col': 320,
  '2col': 280,
  '1col': 160,
  dense: 56,
};

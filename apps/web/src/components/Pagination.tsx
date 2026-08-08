import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

type PageToken = number | 'ellipsis';

const MAX_VISIBLE_NUMBERS = 5;

// A sliding window of at most 5 consecutive numbers, centered on the current page where
// possible (clamped at the ends), plus the last page always pinned separately once the
// window doesn't already reach it — e.g. page 1 of 50,883 renders 1 2 3 4 5 … 50883; deep
// in, it slides to keep the current page centered: … 8 9 10 11 12 … 50883.
function getPageTokens(current: number, total: number): PageToken[] {
  if (total <= MAX_VISIBLE_NUMBERS) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const half = Math.floor(MAX_VISIBLE_NUMBERS / 2);
  let start = Math.max(1, current - half);
  let end = start + MAX_VISIBLE_NUMBERS - 1;
  if (end > total) {
    end = total;
    start = end - MAX_VISIBLE_NUMBERS + 1;
  }

  const tokens: PageToken[] = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  if (end < total) {
    tokens.push('ellipsis');
    tokens.push(total);
  }
  return tokens;
}

export default function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  const tokens = getPageTokens(page, totalPages);

  return (
    <nav className="flex items-center gap-1" aria-label="Pagination">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Previous page"
        className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-button)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronLeft size={16} />
      </button>

      {tokens.map((token, index) =>
        token === 'ellipsis' ? (
          <span
            key={`ellipsis-${index}`}
            className="flex h-9 w-9 items-center justify-center text-sm text-[var(--text-muted)]"
          >
            …
          </span>
        ) : (
          <button
            key={token}
            type="button"
            onClick={() => onPageChange(token)}
            aria-current={token === page ? 'page' : undefined}
            className={`flex h-9 min-w-9 items-center justify-center rounded-[var(--radius-button)] px-2 text-sm transition-colors ${
              token === page
                ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
            }`}
          >
            {token.toLocaleString()}
          </button>
        ),
      )}

      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
        className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-button)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}

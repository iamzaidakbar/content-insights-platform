import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

type PageToken = number | 'ellipsis';

// Always surfaces page 1 and the last page, plus a window of up to 3 pages around the
// current one — e.g. on page 1 of a large result set this renders 1 2 3 4 5 … N; deeper
// in, it shifts to keep the current page visible: 1 … 8 9 10 … N.
function getPageTokens(current: number, total: number): PageToken[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, 2, 3, 4, 5, total]);
  if (current > 3 && current < total - 2) {
    pages.add(current - 1);
    pages.add(current);
    pages.add(current + 1);
  }

  const sorted = Array.from(pages)
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);

  const tokens: PageToken[] = [];
  let previous = 0;
  for (const p of sorted) {
    if (p - previous > 1) {
      tokens.push('ellipsis');
    }
    tokens.push(p);
    previous = p;
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

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Pagination as PaginationNav,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from '@/components/ui/pagination';

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
    <PaginationNav className="mx-0 w-auto justify-start">
      <PaginationContent>
        <PaginationItem>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft />
          </Button>
        </PaginationItem>

        {tokens.map((token, index) =>
          token === 'ellipsis' ? (
            <PaginationItem key={`ellipsis-${index}`}>
              <PaginationEllipsis className="size-8" />
            </PaginationItem>
          ) : (
            <PaginationItem key={token}>
              <Button
                type="button"
                variant={token === page ? 'outline' : 'ghost'}
                size="icon-sm"
                onClick={() => onPageChange(token)}
                aria-label={`Page ${token}`}
                {...(token === page ? { 'aria-current': 'page' as const } : {})}
              >
                {token.toLocaleString()}
              </Button>
            </PaginationItem>
          ),
        )}

        <PaginationItem>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
          >
            <ChevronRight />
          </Button>
        </PaginationItem>
      </PaginationContent>
    </PaginationNav>
  );
}

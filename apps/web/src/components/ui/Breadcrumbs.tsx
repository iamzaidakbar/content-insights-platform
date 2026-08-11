import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

import { cn } from '../../lib/cn';

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export default function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn('flex flex-wrap items-center gap-1 text-sm', className)}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <span key={`${item.label}-${index}`} className="inline-flex items-center gap-1">
            {index > 0 ? <ChevronRight size={14} className="text-[var(--text-muted)]" /> : null}
            {item.to && !isLast ? (
              <Link
                to={item.to}
                className="text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)]"
              >
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}>
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

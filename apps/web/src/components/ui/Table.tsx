import type { CSSProperties, HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';

import { cn } from '../../lib/cn';

/** Viewport-capped table body so admin pages don't grow the document. */
export const ADMIN_TABLE_MAX_HEIGHT = 'calc(100dvh - 16rem)';

export function Table({
  className,
  scrollable = false,
  containerClassName,
  containerStyle,
  children,
  ...rest
}: HTMLAttributes<HTMLTableElement> & {
  scrollable?: boolean;
  containerClassName?: string;
  containerStyle?: CSSProperties;
}) {
  return (
    <div
      className={cn(
        'w-full rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-card)]',
        scrollable
          ? 'overflow-auto [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-[var(--bg-hover)]'
          : 'overflow-x-auto',
        containerClassName,
      )}
      style={containerStyle}
    >
      <table className={cn('w-full min-w-[480px] border-collapse text-left text-sm', className)} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function THead({ className, children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cn('bg-[var(--bg-hover)] text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]', className)} {...rest}>
      {children}
    </thead>
  );
}

export function TBody({ className, children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={cn('divide-y divide-[var(--border)]', className)} {...rest}>
      {children}
    </tbody>
  );
}

export function TR({ className, children, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('transition-colors hover:bg-[var(--bg-hover)]/60', className)} {...rest}>
      {children}
    </tr>
  );
}

export function TH({ className, children, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cn('whitespace-nowrap px-3 py-2.5 font-medium', className)} {...rest}>
      {children}
    </th>
  );
}

export function TD({ className, children, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('px-3 py-2.5 text-[var(--text-primary)]', className)} {...rest}>
      {children}
    </td>
  );
}

export function TableEmpty({ children }: { children: ReactNode }) {
  return (
    <tr>
      <td colSpan={99} className="px-3 py-10 text-center text-sm text-[var(--text-secondary)]">
        {children}
      </td>
    </tr>
  );
}

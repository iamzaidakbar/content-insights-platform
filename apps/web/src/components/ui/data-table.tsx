import type { ComponentProps, CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function Table({
  className,
  scrollable = false,
  containerClassName,
  containerStyle,
  ...props
}: ComponentProps<'table'> & {
  scrollable?: boolean;
  containerClassName?: string;
  containerStyle?: CSSProperties;
}) {
  return (
    <div
      data-slot="table-container"
      className={cn(
        'relative w-full rounded-md border border-border bg-card',
        scrollable
          ? 'min-h-0 flex-1 overflow-auto [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-muted'
          : 'overflow-x-auto',
        containerClassName,
      )}
      {...(containerStyle !== undefined ? { style: containerStyle } : {})}
    >
      <table
        data-slot="table"
        className={cn('w-full min-w-[480px] caption-bottom border-collapse text-left text-sm', className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        'bg-muted/50 text-xs font-medium tracking-wide text-muted-foreground uppercase [&_tr]:border-b',
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props} />
  );
}

export function TableFooter({ className, ...props }: ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
      {...props}
    />
  );
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted',
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-10 px-3 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'px-3 py-2.5 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...props}
    />
  );
}

export function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return (
    <caption data-slot="table-caption" className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
  );
}

export function TableEmpty({ children, colSpan = 99 }: { children: ReactNode; colSpan?: number }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
        {children}
      </TableCell>
    </TableRow>
  );
}

export const THead = TableHeader;
export const TBody = TableBody;
export const TR = TableRow;
export const TH = TableHead;
export const TD = TableCell;

import type { ComponentType, ReactNode } from 'react';

interface EmptyStateProps {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  title: string;
  // Widened to `| undefined` (not just `?`) — exactOptionalPropertyTypes: call sites pass
  // the result of a ternary (`cond ? <x> : undefined`), which types as `T | undefined`,
  // not an absent key.
  description?: string | undefined;
  action?: ReactNode | undefined;
}

// Generic replacement for what used to be Articles' own bespoke EmptyArticlesState — same
// icon+title+description+optional-action shape reused by every list page's empty state
// (Groups, Saved Searches, Channels, Admin Members) instead of each hand-rolling its own.
export default function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full text-[var(--text-muted)]"
        style={{ backgroundColor: 'var(--bg-hover)' }}
      >
        <Icon size={26} strokeWidth={1.5} />
      </div>
      <h3 className="mt-4 text-base font-semibold text-[var(--text-primary)]">{title}</h3>
      {description ? <p className="mt-1 text-sm text-[var(--text-secondary)]">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

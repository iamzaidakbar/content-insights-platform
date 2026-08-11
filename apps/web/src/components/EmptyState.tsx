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
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-muted)] shadow-[var(--shadow-sm)]">
        <Icon size={22} strokeWidth={1.5} />
      </div>
      <h3 className="mt-5 text-sm font-semibold tracking-tight text-[var(--text-primary)]">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-[var(--text-secondary)]">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

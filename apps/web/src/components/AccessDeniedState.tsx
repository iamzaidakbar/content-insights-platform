import { Link } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';

interface AccessDeniedStateProps {
  title?: string;
  // Deliberately vague by default — several server endpoints (channels, saved searches)
  // intentionally return the exact same generic 404 whether a resource doesn't exist or
  // the caller simply lacks visibility into it, specifically so the UI never confirms
  // (or denies) that something exists but is off-limits. Callers should keep any custom
  // copy passed here just as ambiguous — never phrase it as "you don't have permission."
  description?: string;
  backTo?: string;
  backLabel?: string;
}

// Generic "not found or not visible to you" state, shared by any page that fronts one of
// those deliberately-generic 404s (ChannelDetailPage today; SavedSearchDetail/Dashboard
// detail pages are natural future callers of the same pattern) — a variant prop would
// only ever toggle copy, so this single component takes that copy directly instead.
export default function AccessDeniedState({
  title = "This isn't available",
  description = "It may not exist, or you may not have access to it.",
  backTo,
  backLabel = 'Go back',
}: AccessDeniedStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full text-[var(--text-muted)]"
        style={{ backgroundColor: 'var(--bg-hover)' }}
      >
        <ShieldOff size={26} strokeWidth={1.5} />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-[var(--text-secondary)]">{description}</p>
      {backTo ? (
        <Link
          to={backTo}
          className="mt-5 flex h-9 items-center rounded-[var(--radius-button)] border border-[var(--border)] px-4 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]"
        >
          {backLabel}
        </Link>
      ) : null}
    </div>
  );
}

// Shared text-input treatment — was copy-pasted across AccountSection/OrganizationSection
// (and hand-rolled again, on stale raw-Tailwind colors, in Login/Register); one source now.
// Width is deliberately excluded — call sites compose their own max-w-* alongside it.
export const INPUT_CLASSNAME =
  'w-full rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]';

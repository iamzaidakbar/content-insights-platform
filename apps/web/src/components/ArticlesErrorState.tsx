import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ArticlesErrorStateProps {
  message: string;
  onRetry: () => void;
}

export default function ArticlesErrorState({ message, onRetry }: ArticlesErrorStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border-2 py-12 text-center"
      style={{ borderColor: 'var(--red)' }}
    >
      <AlertTriangle size={28} style={{ color: 'var(--red)' }} />
      <p className="mt-3 text-sm font-medium text-[var(--text-primary)]">Unable to load articles</p>
      <p className="mt-1 max-w-sm text-sm text-[var(--text-secondary)]">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 flex h-9 items-center gap-2 rounded-[var(--radius-button)] bg-[var(--accent)] px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
      >
        <RefreshCw size={15} />
        Retry
      </button>
    </div>
  );
}

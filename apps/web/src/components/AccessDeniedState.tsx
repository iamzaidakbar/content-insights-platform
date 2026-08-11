import { Link } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';

import Button from './ui/Button';

interface AccessDeniedStateProps {
  title?: string;
  description?: string;
  backTo?: string;
  backLabel?: string;
}

export default function AccessDeniedState({
  title = "This isn't available",
  description = 'It may not exist, or you may not have access to it.',
  backTo,
  backLabel = 'Go back',
}: AccessDeniedStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-muted)] shadow-[var(--shadow-sm)]">
        <ShieldOff size={22} strokeWidth={1.5} />
      </div>
      <h2 className="mt-5 text-base font-semibold tracking-tight text-[var(--text-primary)]">{title}</h2>
      <p className="mt-1.5 max-w-sm text-sm text-[var(--text-secondary)]">{description}</p>
      {backTo ? (
        <Link to={backTo} className="mt-5">
          <Button variant="outline">{backLabel}</Button>
        </Link>
      ) : null}
    </div>
  );
}

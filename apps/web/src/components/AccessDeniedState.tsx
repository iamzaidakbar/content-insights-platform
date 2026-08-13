import { Link } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';

import { Button } from './ui/button';

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
      <div className="flex size-12 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm">
        <ShieldOff size={22} strokeWidth={1.5} />
      </div>
      <h2 className="mt-5 text-base font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      {backTo ? (
        <Link to={backTo} className="mt-5">
          <Button variant="outline">{backLabel}</Button>
        </Link>
      ) : null}
    </div>
  );
}

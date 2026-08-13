import { RefreshCw } from 'lucide-react';

import Button from './ui/button';
import ErrorState from './ui/ErrorState';

interface ArticlesErrorStateProps {
  message: string;
  onRetry: () => void;
}

export default function ArticlesErrorState({ message, onRetry }: ArticlesErrorStateProps) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <ErrorState
        title="Unable to load articles"
        description={message}
        action={
          <Button variant="primary" leftIcon={<RefreshCw size={15} />} onClick={onRetry}>
            Retry
          </Button>
        }
      />
    </div>
  );
}

import type { ComponentType, MouseEvent } from 'react';

import { cn } from '@/lib/utils';

import { Button } from './button';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

type ActionIconSize = 'icon-xs' | 'icon-sm';

export function ActionIconButton({
  label,
  icon: Icon,
  onClick,
  disabled = false,
  destructive = false,
  size = 'icon-sm',
  className,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  destructive?: boolean;
  size?: ActionIconSize;
  className?: string;
}) {
  const button = (
    <Button
      type="button"
      variant="ghost"
      size={size}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(destructive && 'text-destructive hover:bg-destructive/10 hover:text-destructive', className)}
    >
      <Icon />
    </Button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('inline-flex', disabled && 'cursor-not-allowed')}>{button}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

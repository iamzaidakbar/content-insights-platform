import type { ReactNode } from 'react';
import { CheckIcon } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

function Checkbox({
  className,
  label,
  trailing,
  onChange,
  checked = false,
  id,
  disabled = false,
}: {
  className?: string;
  label?: string;
  trailing?: ReactNode;
  onChange?: (event: { target: { checked: boolean } }) => void;
  checked?: boolean;
  id?: string;
  disabled?: boolean;
}) {
  const box = (
    <CheckboxPrimitive.Root
      id={id}
      data-slot="checkbox"
      checked={checked}
      disabled={disabled}
      onCheckedChange={(value) => {
        onChange?.({ target: { checked: value === true } });
      }}
      className={cn(
        'peer size-4 shrink-0 rounded-[4px] border border-input shadow-xs outline-none transition-shadow focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:bg-input/30 dark:aria-invalid:ring-destructive/40 dark:data-[state=checked]:bg-primary',
        className,
      )}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );

  if (!label && !trailing) {
    return box;
  }

  return (
    <label htmlFor={id} className="flex w-full items-center gap-2 text-sm text-foreground">
      {box}
      {label ? <span className="min-w-0 flex-1 truncate">{label}</span> : null}
      {trailing}
    </label>
  );
}

export { Checkbox };

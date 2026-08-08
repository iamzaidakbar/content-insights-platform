import type { ComponentType } from 'react';

interface ComingSoonProps {
  title: string;
  description: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}

export default function ComingSoon({ title, description, icon: Icon }: ComingSoonProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 py-10 text-center">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full text-[var(--accent)]"
        style={{ backgroundColor: 'var(--accent-soft)' }}
      >
        <Icon size={26} strokeWidth={1.5} />
      </div>
      <h1 className="mt-4 text-xl font-semibold text-[var(--text-primary)]">{title}</h1>
      <p className="mt-2 max-w-sm text-sm text-[var(--text-secondary)]">{description}</p>
    </div>
  );
}

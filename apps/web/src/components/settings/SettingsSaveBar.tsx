interface SettingsSaveBarProps {
  isDirty: boolean;
  isSaving?: boolean;
  onSave: () => void;
  onDiscard: () => void;
}

export default function SettingsSaveBar({ isDirty, isSaving = false, onSave, onDiscard }: SettingsSaveBarProps) {
  if (!isDirty) {
    return null;
  }

  return (
    <div className="sticky bottom-0 z-10 -mx-6 mt-6 flex items-center justify-end gap-3 border-t border-[var(--border)] bg-[var(--bg-surface)] px-6 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.25)]">
      <span className="mr-auto text-xs text-[var(--text-muted)]">You have unsaved changes.</span>
      <button
        type="button"
        onClick={onDiscard}
        className="h-9 rounded-[var(--radius-button)] border border-[var(--border)] px-4 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
      >
        Discard
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={isSaving}
        className="h-9 rounded-[var(--radius-button)] bg-[var(--accent)] px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSaving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}

import { Button } from '@/components/ui/button';

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
    <div className="sticky bottom-0 z-10 mt-4 flex items-center justify-end gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
      <span className="mr-auto text-xs text-muted-foreground">You have unsaved changes.</span>
      <Button type="button" variant="outline" onClick={onDiscard}>
        Discard
      </Button>
      <Button type="button" onClick={onSave} loading={isSaving}>
        Save changes
      </Button>
    </div>
  );
}

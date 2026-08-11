import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ShieldAlert } from 'lucide-react';

import type { MsTeamsGlobalSettings, UpdateGlobalSettingsInput } from '@content-insights/shared';

import { useAuth } from '../../auth/AuthContext';
import { useDirtyDraft } from '../../hooks/useDirtyDraft';
import { getApiErrorMessage } from '../../lib/api-client';
import { fetchGlobalSettings, updateGlobalSettings } from '../../lib/global-settings-api';
import EmptyState from '../EmptyState';
import Toggle from '../Toggle';
import SettingsSaveBar from './SettingsSaveBar';
import { SettingsRow, SettingsSection } from './SettingsSection';

const NUMBER_INPUT_CLASSNAME =
  'w-28 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]';

interface GlobalSettingsDraft {
  maxSnapshotArticles: number;
  msTeams: MsTeamsGlobalSettings;
}

// Application Admin only (global-settings:manage), enforced both here and server-side.
// Covers exactly the fields called out for this settings screen — maxSnapshotArticles and
// the three msTeams.* fields. articleFieldMapping also lives on GlobalSettings but has its
// own dedicated admin surface elsewhere and isn't part of this section's scope.
export default function GlobalSettingsSection() {
  const { permissions } = useAuth();
  const canManage = permissions.includes('*') || permissions.includes('global-settings:manage');
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ['global-settings'],
    queryFn: fetchGlobalSettings,
    enabled: canManage,
  });

  const committed: GlobalSettingsDraft | null = settingsQuery.data
    ? { maxSnapshotArticles: settingsQuery.data.maxSnapshotArticles, msTeams: settingsQuery.data.msTeams }
    : null;

  const mutation = useMutation({
    mutationFn: (patch: UpdateGlobalSettingsInput) => updateGlobalSettings(patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(['global-settings'], updated);
      toast.success('Global settings updated.');
    },
  });

  if (!canManage) {
    return (
      <SettingsSection title="Global Settings">
        <EmptyState
          icon={ShieldAlert}
          title="Admins only"
          description="You need the global-settings:manage permission to view or change org-wide settings."
        />
      </SettingsSection>
    );
  }

  if (settingsQuery.isLoading || !committed) {
    return (
      <SettingsSection title="Global Settings">
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-9 w-64 animate-shimmer rounded-[var(--radius-input)]" />
          ))}
        </div>
      </SettingsSection>
    );
  }

  if (settingsQuery.isError) {
    return (
      <SettingsSection title="Global Settings">
        <p className="text-sm" style={{ color: 'var(--red)' }}>
          {getApiErrorMessage(settingsQuery.error, 'Unable to load global settings.')}
        </p>
      </SettingsSection>
    );
  }

  return <GlobalSettingsForm committed={committed} onSave={(patch) => mutation.mutate(patch)} isSaving={mutation.isPending} />;
}

function GlobalSettingsForm({
  committed,
  onSave,
  isSaving,
}: {
  committed: GlobalSettingsDraft;
  onSave: (patch: UpdateGlobalSettingsInput) => void;
  isSaving: boolean;
}) {
  const { draft, setDraft, isDirty, discard } = useDirtyDraft<GlobalSettingsDraft>(committed);

  function handleSave() {
    const patch: UpdateGlobalSettingsInput = {};
    if (draft.maxSnapshotArticles !== committed.maxSnapshotArticles) {
      patch.maxSnapshotArticles = draft.maxSnapshotArticles;
    }
    if (JSON.stringify(draft.msTeams) !== JSON.stringify(committed.msTeams)) {
      patch.msTeams = draft.msTeams;
    }
    if (Object.keys(patch).length > 0) {
      onSave(patch);
    }
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Snapshots"
        description="Caps how many articles a saved-search snapshot can capture at once, org-wide."
      >
        <SettingsRow label="Max snapshot articles">
          <input
            type="number"
            min={1}
            max={10_000}
            value={draft.maxSnapshotArticles}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                maxSnapshotArticles: Math.max(1, Math.min(10_000, Math.round(Number(event.target.value)))),
              }))
            }
            className={NUMBER_INPUT_CLASSNAME}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Microsoft Teams" description="Defaults applied when sharing articles into MS Teams.">
        <SettingsRow label="Hide icons" description="Omit source/type icons from shared article cards.">
          <Toggle
            checked={draft.msTeams.hideIcons}
            onChange={(checked) =>
              setDraft((current) => ({ ...current, msTeams: { ...current.msTeams, hideIcons: checked } }))
            }
            label="Hide icons in MS Teams shares"
          />
        </SettingsRow>

        <SettingsRow label="Max articles per share">
          <input
            type="number"
            min={1}
            max={100}
            value={draft.msTeams.maxArticlesPerShare}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                msTeams: {
                  ...current.msTeams,
                  maxArticlesPerShare: Math.max(1, Math.min(100, Math.round(Number(event.target.value)))),
                },
              }))
            }
            className={NUMBER_INPUT_CLASSNAME}
          />
        </SettingsRow>

        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)]">Default bulk message</label>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Pre-filled message text when sharing multiple articles at once.
          </p>
          <textarea
            value={draft.msTeams.defaultBulkMessage}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                msTeams: { ...current.msTeams, defaultBulkMessage: event.target.value },
              }))
            }
            maxLength={1000}
            rows={3}
            className="mt-2 w-full max-w-lg resize-y rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <p className="mt-1 text-right text-xs text-[var(--text-muted)]">{draft.msTeams.defaultBulkMessage.length}/1000</p>
        </div>
      </SettingsSection>

      <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} onDiscard={discard} />
    </div>
  );
}

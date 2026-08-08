import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';

import { useAuth } from '../../auth/AuthContext';
import { useDirtyDraft } from '../../hooks/useDirtyDraft';
import { getApiErrorMessage } from '../../lib/api-client';
import { fetchOrganization, updateOrganization } from '../../lib/organizations-api';
import SettingsSaveBar from './SettingsSaveBar';
import { SettingsSection } from './SettingsSection';

const INPUT_CLASSNAME =
  'w-full max-w-sm rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]';

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function OrganizationSection() {
  const { org } = useAuth();
  const queryClient = useQueryClient();

  const orgQuery = useQuery({
    queryKey: ['organization', org?.id],
    queryFn: async () => {
      if (!org) {
        throw new Error('No organization in session');
      }
      return fetchOrganization(org.id);
    },
    enabled: org !== null,
  });

  const committedName = orgQuery.data?.name ?? '';
  const { draft, setDraft, isDirty, discard } = useDirtyDraft(committedName);

  const mutation = useMutation({
    mutationFn: async (name: string) => {
      if (!org) {
        throw new Error('No organization in session');
      }
      return updateOrganization(org.id, name);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['organization', org?.id], updated);
      toast.success('Organization updated.');
    },
  });

  if (orgQuery.isLoading) {
    return (
      <SettingsSection title="Organization">
        <div className="h-9 w-64 animate-shimmer rounded-[var(--radius-input)]" />
        <div className="h-9 w-48 animate-shimmer rounded-[var(--radius-input)]" />
      </SettingsSection>
    );
  }

  if (orgQuery.isError || !orgQuery.data) {
    return (
      <SettingsSection title="Organization">
        <p className="text-sm" style={{ color: 'var(--red)' }}>
          {getApiErrorMessage(orgQuery.error, 'Unable to load organization.')}
        </p>
      </SettingsSection>
    );
  }

  const detail = orgQuery.data;

  return (
    <div className="space-y-6">
      <SettingsSection title="Organization">
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)]">Organization name</label>
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className={`mt-1 ${INPUT_CLASSNAME}`}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)]">Slug</label>
          <p
            className="mt-1 max-w-sm rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            {detail.slug}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)]">Plan</label>
          <span
            className="mt-1 inline-block rounded-full px-3 py-1 text-xs font-medium"
            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            {capitalize(detail.plan)}
          </span>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)]">Members</label>
          <Link to="/admin/members" className="mt-1 inline-block text-sm text-[var(--accent)] hover:underline">
            {detail.memberCount} member{detail.memberCount === 1 ? '' : 's'}
          </Link>
        </div>
      </SettingsSection>

      <SettingsSaveBar
        isDirty={isDirty}
        isSaving={mutation.isPending}
        onSave={() => mutation.mutate(draft)}
        onDiscard={discard}
      />
    </div>
  );
}

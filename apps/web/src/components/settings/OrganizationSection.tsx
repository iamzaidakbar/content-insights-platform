import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { useAuth } from '../../auth/AuthContext';
import { useDirtyDraft } from '../../hooks/useDirtyDraft';
import { getApiErrorMessage } from '../../lib/api-client';
import { fetchOrganization, updateOrganization } from '../../lib/organizations-api';
import { Input } from '../ui/input';
import SettingsSaveBar from './SettingsSaveBar';
import { SettingsSection } from './SettingsSection';

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
        <div className="h-9 w-64 animate-shimmer rounded-md" />
        <div className="h-9 w-48 animate-shimmer rounded-md" />
      </SettingsSection>
    );
  }

  if (orgQuery.isError || !orgQuery.data) {
    return (
      <SettingsSection title="Organization">
        <p className="text-sm text-destructive">
          {getApiErrorMessage(orgQuery.error, 'Unable to load organization.')}
        </p>
      </SettingsSection>
    );
  }

  const detail = orgQuery.data;

  return (
    <div className="space-y-4">
      <SettingsSection title="Organization">
        <div>
          <label className="block text-sm font-medium text-muted-foreground">Organization name</label>
          <Input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="mt-1 max-w-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-muted-foreground">Slug</label>
          <p className="mt-1 max-w-sm rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
            {detail.slug}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-muted-foreground">Plan</label>
          <span className="mt-1 inline-block rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
            {capitalize(detail.plan)}
          </span>
        </div>

        <div>
          <label className="block text-sm font-medium text-muted-foreground">Members</label>
          <Link to="/admin/members" className="mt-1 inline-block text-sm text-primary hover:underline">
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

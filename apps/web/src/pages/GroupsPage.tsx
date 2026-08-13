import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';

import { useAuth } from '../auth/AuthContext';
import EmptyState from '../components/EmptyState';
import { Alert, Button, Card, Input, Modal, PageBody, PageHeader } from '../components/ui';
import { getApiErrorMessage } from '../lib/api-client';
import { formatDate } from '../lib/format';
import { createGroup, fetchGroups } from '../lib/groups-api';

const SKELETON_ROW_COUNT = 4;

function SkeletonRow() {
  return (
    <tr className="border-b border-border">
      <td className="py-3 pr-4">
        <div className="h-4 w-40 animate-pulse rounded bg-accent" />
      </td>
      <td className="py-3 pr-4">
        <div className="h-4 w-16 animate-pulse rounded bg-accent" />
      </td>
      <td className="py-3 pr-4">
        <div className="h-4 w-16 animate-pulse rounded bg-accent" />
      </td>
      <td className="py-3">
        <div className="h-4 w-28 animate-pulse rounded bg-accent" />
      </td>
    </tr>
  );
}

function NewGroupModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      createGroup({ name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['groups-list'] });
      onClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Unable to create group.')),
    meta: { skipToast: true },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Group name is required.');
      return;
    }
    createMutation.mutate();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New group"
      size="sm"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-group-form" loading={createMutation.isPending}>
            Create group
          </Button>
        </>
      }
    >
      <form id="new-group-form" className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="group-name" className="block text-sm font-medium text-muted-foreground">
            Name
          </label>
          <Input
            id="group-name"
            type="text"
            required
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1"
          />
        </div>

        <div>
          <label htmlFor="group-description" className="block text-sm font-medium text-muted-foreground">
            Description <span className="text-muted-foreground">(optional)</span>
          </label>
          <Input
            id="group-description"
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="mt-1"
          />
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </form>
    </Modal>
  );
}

export default function GroupsPage() {
  const { permissions } = useAuth();
  const canManageGroups = permissions.includes('groups:manage') || permissions.includes('*');
  const [isCreating, setIsCreating] = useState(false);

  const groupsQuery = useQuery({ queryKey: ['groups-list'], queryFn: () => fetchGroups() });

  const groups = groupsQuery.data?.items ?? [];
  const showEmptyState = !groupsQuery.isLoading && !groupsQuery.isError && groups.length === 0;

  return (
    <PageBody>
      <PageHeader
        title="Groups"
        description="Groups in your organization."
        actions={
          canManageGroups ? (
            <Button type="button" onClick={() => setIsCreating(true)}>
              New group
            </Button>
          ) : null
        }
      />

      {groupsQuery.isError ? (
        <Alert variant="error" className="mb-5">
          {getApiErrorMessage(groupsQuery.error, 'Unable to load groups.')}
        </Alert>
      ) : null}

      <Card>
        <div className="overflow-x-auto px-4 py-2">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Name</th>
                <th className="pb-2 pr-4 font-medium">Members</th>
                <th className="pb-2 pr-4 font-medium">Projects</th>
                <th className="pb-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {groupsQuery.isLoading
                ? Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => <SkeletonRow key={index} />)
                : groups.map((group) => (
                    <tr key={group.id} className="h-11 border-b border-border last:border-b-0">
                      <td className="py-3 pr-4 text-foreground">
                        <Link to={`/groups/${group.id}`} className="hover:text-primary">
                          {group.name}
                        </Link>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">{group.members.length}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{group.dataAccess.projectIds.length}</td>
                      <td className="py-3 text-muted-foreground">{formatDate(group.createdAt)}</td>
                    </tr>
                  ))}
            </tbody>
          </table>

          {showEmptyState ? (
            <EmptyState
              icon={Users}
              title="No groups yet"
              description={canManageGroups ? 'Create a group to start organizing articles and members.' : undefined}
              action={
                canManageGroups ? (
                  <Button type="button" variant="outline" onClick={() => setIsCreating(true)}>
                    Create your first group
                  </Button>
                ) : undefined
              }
            />
          ) : null}
        </div>
      </Card>

      {isCreating ? <NewGroupModal onClose={() => setIsCreating(false)} /> : null}
    </PageBody>
  );
}

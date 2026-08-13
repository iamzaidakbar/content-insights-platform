import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Lock, Pencil, Shield, ShieldCheck, Trash2, X } from 'lucide-react';

import { PERMISSIONS, SYSTEM_ROLE_NAMES, type Permission, type Role } from '@content-insights/shared';

import { getApiErrorMessage } from '../../lib/api-client';
import { createRole, deleteRole, fetchRoles, updateRole } from '../../lib/roles-api';
import Alert from '../ui/alert';
import { ActionIconButton } from '../ui/action-icon-button';
import Badge from '../ui/badge';
import Button from '../ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import Modal from '../ui/Modal';
import Skeleton from '../ui/skeleton';

// ---------------------------------------------------------------------------------------
// Group the flat PERMISSIONS catalog by its "resource" prefix (everything before the first
// ':') — computed once at module scope, in PERMISSIONS' own declared order, so the create/
// edit checklist reads as "Projects: read, manage / Groups: read, manage, manageDataAccess /
// ..." instead of one 39-item wall of checkboxes.
// ---------------------------------------------------------------------------------------

interface PermissionGroup {
  resource: string;
  permissions: Permission[];
}

const PERMISSION_GROUPS: PermissionGroup[] = (() => {
  const order: string[] = [];
  const byResource = new Map<string, Permission[]>();
  for (const permission of PERMISSIONS) {
    const resource = permission.split(':')[0] ?? permission;
    let bucket = byResource.get(resource);
    if (!bucket) {
      bucket = [];
      byResource.set(resource, bucket);
      order.push(resource);
    }
    bucket.push(permission);
  }
  return order.map((resource) => ({ resource, permissions: byResource.get(resource) ?? [] }));
})();

const RESOURCE_LABELS: Record<string, string> = {
  'ms-teams': 'MS Teams',
  'entity-mapping': 'Entity Mapping',
  'global-settings': 'Global Settings',
  'saved-searches': 'Saved Searches',
  'user-tags': 'User Tags',
  org: 'Organization',
};

function resourceLabel(resource: string): string {
  return (
    RESOURCE_LABELS[resource] ??
    resource
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
}

const KNOWN_PERMISSIONS = new Set<string>(PERMISSIONS);

// Narrows a role's raw `permissions: string[]` (which may carry the '*' wildcard sentinel,
// handled separately by the hasWildcard branch below) down to the enumerated Permission
// union the checklist UI actually renders checkboxes for.
function toKnownPermissions(values: readonly string[]): Permission[] {
  return values.filter((value): value is Permission => KNOWN_PERMISSIONS.has(value));
}

function actionLabel(permission: Permission): string {
  const action = permission.split(':')[1] ?? permission;
  return action
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (char) => char.toUpperCase());
}

const SYSTEM_ROLE_EXPLANATION =
  `System role — its permission set is fixed by design (the ${SYSTEM_ROLE_NAMES.length} seeded roles: ` +
  `${SYSTEM_ROLE_NAMES.join(', ')}). It may still be renamed, but permissions can't be edited or removed here.`;

function PermissionChecklist({
  selected,
  onToggle,
  disabled = false,
}: {
  selected: Permission[];
  onToggle: (permission: Permission) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      {PERMISSION_GROUPS.map((group) => (
        <fieldset key={group.resource} disabled={disabled}>
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {resourceLabel(group.resource)}
          </legend>
          <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            {group.permissions.map((permission) => (
              <label
                key={permission}
                className={`flex items-center gap-2 text-sm text-muted-foreground ${disabled ? 'opacity-60' : 'cursor-pointer'}`}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(permission)}
                  onChange={() => onToggle(permission)}
                  disabled={disabled}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                {actionLabel(permission)}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function DeleteRoleDialog({ role, onClose }: { role: Role; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // A role still assigned to anyone comes back as 409 ROLE_IN_USE with a count in the
  // message — surfaced verbatim, not reworded, same convention as SavedQueriesModal's
  // SAVED_SEARCH_IS_DEFAULT handling.
  const deleteMutation = useMutation({
    mutationFn: () => deleteRole(role.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Role deleted.');
      onClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Unable to delete this role.')),
    meta: { skipToast: true },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Delete role?"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={deleteMutation.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
            Delete role
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        <span className="text-foreground">{role.name}</span> will be permanently removed. This cannot be
        undone.
      </p>
      {error ? (
        <Alert variant="error" className="mt-3">
          {error}
        </Alert>
      ) : null}
    </Modal>
  );
}

function RoleCard({ role, onRequestDelete }: { role: Role; onRequestDelete: (role: Role) => void }) {
  const queryClient = useQueryClient();

  const [isRenaming, setIsRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(role.name);
  const [isEditingPermissions, setIsEditingPermissions] = useState(false);
  const [permissionsDraft, setPermissionsDraft] = useState<Permission[]>(toKnownPermissions(role.permissions));
  const [error, setError] = useState<string | null>(null);

  const renameMutation = useMutation({
    mutationFn: () => updateRole(role.id, { name: nameDraft.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Role renamed.');
      setIsRenaming(false);
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Unable to rename this role.')),
    meta: { skipToast: true },
  });

  const permissionsMutation = useMutation({
    mutationFn: () => updateRole(role.id, { permissions: permissionsDraft }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Permissions updated.');
      setIsEditingPermissions(false);
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Unable to update permissions.')),
    meta: { skipToast: true },
  });

  const hasWildcard = role.permissions.includes('*');

  return (
    <div className="rounded-lg border border-border bg-card p-3.5">
      <div className="flex items-center justify-between gap-3">
        {isRenaming ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              setError(null);
              if (!nameDraft.trim()) {
                setError('Role name is required.');
                return;
              }
              renameMutation.mutate();
            }}
          >
            <Input
              autoFocus
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              className="max-w-xs py-1.5"
            />
            <Button type="submit" size="sm" loading={renameMutation.isPending}>
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setIsRenaming(false);
                setNameDraft(role.name);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{role.name}</h3>
            {role.isSystem ? (
              <Badge variant="default" title={SYSTEM_ROLE_EXPLANATION} className="gap-1">
                <Lock size={10} />
                System
              </Badge>
            ) : null}
            <ActionIconButton label="Rename" icon={Pencil} onClick={() => setIsRenaming(true)} />
          </div>
        )}

        <div className="flex shrink-0 items-center gap-0.5">
          {!role.isSystem && !hasWildcard ? (
            isEditingPermissions ? (
              <>
                <ActionIconButton
                  label={permissionsMutation.isPending ? 'Saving…' : 'Save permissions'}
                  icon={Check}
                  onClick={() => permissionsMutation.mutate()}
                  disabled={permissionsMutation.isPending}
                />
                <ActionIconButton
                  label="Cancel"
                  icon={X}
                  onClick={() => {
                    setIsEditingPermissions(false);
                    setPermissionsDraft(toKnownPermissions(role.permissions));
                  }}
                />
              </>
            ) : (
              <ActionIconButton
                label="Edit permissions"
                icon={Shield}
                onClick={() => setIsEditingPermissions(true)}
              />
            )
          ) : null}
          <ActionIconButton
            label={role.isSystem ? 'System roles cannot be deleted' : 'Delete this role'}
            icon={Trash2}
            onClick={() => onRequestDelete(role)}
            disabled={role.isSystem}
            destructive
          />
        </div>
      </div>

      {error ? (
        <Alert variant="error" className="mt-2">
          {error}
        </Alert>
      ) : null}

      <div className="mt-3">
        {hasWildcard ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck size={13} className="text-primary" />
            Full access — every permission, current and future (
            <code className="text-muted-foreground">*</code>).
          </p>
        ) : (
          <>
            {role.isSystem ? <p className="mb-2 text-xs text-muted-foreground">{SYSTEM_ROLE_EXPLANATION}</p> : null}
            <PermissionChecklist
              selected={isEditingPermissions ? permissionsDraft : toKnownPermissions(role.permissions)}
              disabled={!isEditingPermissions}
              onToggle={(permission) =>
                setPermissionsDraft((current) =>
                  current.includes(permission) ? current.filter((entry) => entry !== permission) : [...current, permission],
                )
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminRolesSection() {
  const queryClient = useQueryClient();
  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: fetchRoles });
  const roles = rolesQuery.data ?? [];

  const [deletingRole, setDeletingRole] = useState<Role | null>(null);

  const [newRoleName, setNewRoleName] = useState('');
  const [newRolePermissions, setNewRolePermissions] = useState<Permission[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const createRoleMutation = useMutation({
    mutationFn: () => createRole({ name: newRoleName.trim(), permissions: newRolePermissions }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Role created.');
      setNewRoleName('');
      setNewRolePermissions([]);
    },
    onError: (err) => setFormError(getApiErrorMessage(err, 'Unable to create role.')),
    meta: { skipToast: true },
  });

  function togglePermission(permission: Permission) {
    setNewRolePermissions((current) =>
      current.includes(permission) ? current.filter((entry) => entry !== permission) : [...current, permission],
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!newRoleName.trim()) {
      setFormError('Role name is required.');
      return;
    }
    if (newRolePermissions.length === 0) {
      setFormError('Select at least one permission.');
      return;
    }
    createRoleMutation.mutate();
  }

  return (
    <div className="space-y-4">
      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-base">Roles</CardTitle>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Roles and their permissions for your organization.
          </p>
        </CardHeader>
        <CardBody className="space-y-3 px-4">
          {rolesQuery.isError ? (
            <Alert variant="error">{getApiErrorMessage(rolesQuery.error, 'Unable to load roles.')}</Alert>
          ) : null}

          {rolesQuery.isLoading
            ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-24 w-full" />)
            : roles.map((role) => <RoleCard key={role.id} role={role} onRequestDelete={setDeletingRole} />)}
        </CardBody>
      </Card>

      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-base">Create custom role</CardTitle>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Custom roles can be edited or deleted freely — unlike the seeded system roles, whose permission sets are
            fixed.
          </p>
        </CardHeader>
        <CardBody className="px-4">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="role-name" className="block text-sm font-medium text-muted-foreground">
                Name
              </label>
              <Input
                id="role-name"
                type="text"
                required
                value={newRoleName}
                onChange={(event) => setNewRoleName(event.target.value)}
                className="mt-1 max-w-xs"
              />
            </div>

            <div>
              <span className="block text-sm font-medium text-muted-foreground">Permissions</span>
              <div className="mt-2">
                <PermissionChecklist selected={newRolePermissions} onToggle={togglePermission} />
              </div>
            </div>

            {formError ? <Alert variant="error">{formError}</Alert> : null}

            <Button type="submit" size="sm" loading={createRoleMutation.isPending}>
              Create role
            </Button>
          </form>
        </CardBody>
      </Card>

      {deletingRole ? <DeleteRoleDialog role={deletingRole} onClose={() => setDeletingRole(null)} /> : null}
    </div>
  );
}

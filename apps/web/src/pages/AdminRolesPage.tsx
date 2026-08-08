import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { PERMISSIONS, type Permission } from '@content-insights/shared';

import { getApiErrorMessage } from '../lib/api-client';
import { createRole, fetchRoles } from '../lib/roles-api';

export default function AdminRolesPage() {
  const queryClient = useQueryClient();
  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: fetchRoles });
  const roles = rolesQuery.data ?? [];

  const [newRoleName, setNewRoleName] = useState('');
  const [newRolePermissions, setNewRolePermissions] = useState<Permission[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const createRoleMutation = useMutation({
    mutationFn: () => createRole({ name: newRoleName.trim(), permissions: newRolePermissions }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
      setNewRoleName('');
      setNewRolePermissions([]);
    },
    onError: (err) => setFormError(getApiErrorMessage(err, 'Unable to create role.')),
  });

  function togglePermission(permission: Permission) {
    setNewRolePermissions((current) =>
      current.includes(permission)
        ? current.filter((entry) => entry !== permission)
        : [...current, permission],
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
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold">Roles</h1>
      <p className="mt-1 text-sm text-slate-400">
        Roles and their permissions for your organization.
      </p>

      {rolesQuery.isError ? (
        <p className="mt-6 text-sm text-red-400">
          {getApiErrorMessage(rolesQuery.error, 'Unable to load roles.')}
        </p>
      ) : null}

      <div className="mt-6 space-y-4">
        {rolesQuery.isLoading
          ? Array.from({ length: 3 }, (_, index) => (
              <div
                key={index}
                className="h-24 animate-pulse rounded-md border border-slate-800 bg-slate-900/40"
              />
            ))
          : roles.map((role) => (
              <div key={role.id} className="rounded-md border border-slate-800 p-4">
                <h2 className="text-sm font-semibold text-slate-100">{role.name}</h2>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {PERMISSIONS.map((permission) => (
                    <label key={permission} className="flex items-center gap-2 text-xs text-slate-400">
                      <input
                        type="checkbox"
                        disabled
                        checked={
                          role.permissions.includes(permission) || role.permissions.includes('*')
                        }
                        className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-slate-100"
                      />
                      {permission}
                    </label>
                  ))}
                </div>
              </div>
            ))}
      </div>

      <div className="mt-10 rounded-md border border-slate-800 p-4">
        <h2 className="text-sm font-semibold text-slate-100">Create role</h2>
        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="role-name" className="block text-sm font-medium text-slate-300">
              Name
            </label>
            <input
              id="role-name"
              type="text"
              required
              value={newRoleName}
              onChange={(event) => setNewRoleName(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
            />
          </div>

          <div>
            <span className="block text-sm font-medium text-slate-300">Permissions</span>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PERMISSIONS.map((permission) => (
                <label key={permission} className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={newRolePermissions.includes(permission)}
                    onChange={() => togglePermission(permission)}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-slate-100 focus:ring-0"
                  />
                  {permission}
                </label>
              ))}
            </div>
          </div>

          {formError ? <p className="text-sm text-red-400">{formError}</p> : null}

          <button
            type="submit"
            disabled={createRoleMutation.isPending}
            className="rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {createRoleMutation.isPending ? 'Creating…' : 'Create role'}
          </button>
        </form>
      </div>
    </div>
  );
}

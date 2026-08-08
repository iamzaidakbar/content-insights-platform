import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { getApiErrorMessage } from '../lib/api-client';
import { createProject, fetchProjects } from '../lib/projects-api';
import { formatDate } from '../lib/format';

const SKELETON_ROW_COUNT = 4;

function SkeletonRow() {
  return (
    <tr className="border-b border-slate-900">
      <td className="py-3 pr-4">
        <div className="h-4 w-40 animate-pulse rounded bg-slate-800" />
      </td>
      <td className="py-3 pr-4">
        <div className="h-4 w-16 animate-pulse rounded bg-slate-800" />
      </td>
      <td className="py-3">
        <div className="h-4 w-28 animate-pulse rounded bg-slate-800" />
      </td>
    </tr>
  );
}

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      createProject({ name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects-list'] });
      onClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Unable to create project.')),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Project name is required.');
      return;
    }
    createMutation.mutate();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-md border border-slate-700 bg-slate-900 p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-100">New project</h2>
        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="project-name" className="block text-sm font-medium text-slate-300">
              Name
            </label>
            <input
              id="project-name"
              type="text"
              required
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
            />
          </div>

          <div>
            <label htmlFor="project-description" className="block text-sm font-medium text-slate-300">
              Description <span className="text-slate-500">(optional)</span>
            </label>
            <input
              id="project-description"
              type="text"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
            />
          </div>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-100 transition hover:border-slate-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {createMutation.isPending ? 'Creating…' : 'Create project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const [isCreating, setIsCreating] = useState(false);

  const projectsQuery = useQuery({ queryKey: ['projects-list'], queryFn: fetchProjects });

  const projects = projectsQuery.data?.items ?? [];
  const showEmptyState =
    !projectsQuery.isLoading && !projectsQuery.isError && projects.length === 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="mt-1 text-sm text-slate-400">Projects in your organization.</p>
        </div>
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white"
        >
          New project
        </button>
      </div>

      {projectsQuery.isError ? (
        <p className="mt-6 text-sm text-red-400">
          {getApiErrorMessage(projectsQuery.error, 'Unable to load projects.')}
        </p>
      ) : null}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400">
              <th className="pb-2 pr-4 font-medium">Name</th>
              <th className="pb-2 pr-4 font-medium">Members</th>
              <th className="pb-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {projectsQuery.isLoading
              ? Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
                  <SkeletonRow key={index} />
                ))
              : projects.map((project) => (
                  <tr key={project.id} className="border-b border-slate-900">
                    <td className="py-3 pr-4 text-slate-100">
                      <Link to={`/projects/${project.id}`} className="underline hover:no-underline">
                        {project.name}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-slate-400">{project.members.length}</td>
                    <td className="py-3 text-slate-400">{formatDate(project.createdAt)}</td>
                  </tr>
                ))}
          </tbody>
        </table>

        {showEmptyState ? (
          <div className="py-12 text-center">
            <p className="text-slate-400">No projects yet.</p>
            <button
              type="button"
              onClick={() => setIsCreating(true)}
              className="mt-2 inline-block text-slate-100 underline"
            >
              Create your first project
            </button>
          </div>
        ) : null}
      </div>

      {isCreating ? <NewProjectModal onClose={() => setIsCreating(false)} /> : null}
    </div>
  );
}

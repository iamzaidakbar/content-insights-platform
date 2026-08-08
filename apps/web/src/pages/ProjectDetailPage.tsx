import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { asProjectId } from '@content-insights/shared';

import { getApiErrorMessage } from '../lib/api-client';
import { fetchProject, removeProjectMember } from '../lib/projects-api';
import { formatDate } from '../lib/format';
import AddMemberModal from '../components/AddMemberModal';

const SKELETON_ROW_COUNT = 3;

function SkeletonRow() {
  return (
    <tr className="border-b border-slate-900">
      <td className="py-3 pr-4">
        <div className="h-4 w-40 animate-pulse rounded bg-slate-800" />
      </td>
      <td className="py-3 pr-4">
        <div className="h-4 w-20 animate-pulse rounded bg-slate-800" />
      </td>
      <td className="py-3">
        <div className="h-4 w-16 animate-pulse rounded bg-slate-800" />
      </td>
    </tr>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const projectId = id ? asProjectId(id) : null;
  const queryClient = useQueryClient();
  const [isAddingMember, setIsAddingMember] = useState(false);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => {
      if (!projectId) {
        throw new Error('Missing project id.');
      }
      return fetchProject(projectId);
    },
    enabled: projectId !== null,
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => {
      if (!projectId) {
        throw new Error('Missing project id.');
      }
      return removeProjectMember(projectId, userId);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['project', projectId], updated);
      void queryClient.invalidateQueries({ queryKey: ['projects-list'] });
    },
  });

  const project = projectQuery.data;
  const members = project?.members ?? [];

  if (!projectId) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-12">
        <p className="text-sm text-red-400">Invalid project id.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{project?.name ?? 'Project'}</h1>
          <p className="mt-1 text-sm text-slate-400">Members and roles for this project.</p>
        </div>
        <button
          type="button"
          onClick={() => setIsAddingMember(true)}
          className="rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white"
        >
          Add member
        </button>
      </div>

      {projectQuery.isError ? (
        <p className="mt-6 text-sm text-red-400">
          {getApiErrorMessage(projectQuery.error, 'Unable to load project.')}
        </p>
      ) : null}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400">
              <th className="pb-2 pr-4 font-medium">Email</th>
              <th className="pb-2 pr-4 font-medium">Role</th>
              <th className="pb-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {projectQuery.isLoading
              ? Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
                  <SkeletonRow key={index} />
                ))
              : members.map((member) => (
                  <tr key={member.userId} className="border-b border-slate-900">
                    <td className="py-3 pr-4 text-slate-100">{member.userEmail}</td>
                    <td className="py-3 pr-4 text-slate-400">{member.roleName}</td>
                    <td className="py-3">
                      <button
                        type="button"
                        onClick={() => removeMemberMutation.mutate(member.userId)}
                        disabled={removeMemberMutation.isPending}
                        className="text-xs text-red-400 underline hover:no-underline disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>

        {!projectQuery.isLoading && members.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-slate-400">No members yet.</p>
          </div>
        ) : null}
      </div>

      {project ? (
        <p className="mt-6 text-xs text-slate-500">Created {formatDate(project.createdAt)}</p>
      ) : null}

      {isAddingMember && project ? (
        <AddMemberModal project={project} onClose={() => setIsAddingMember(false)} />
      ) : null}
    </div>
  );
}

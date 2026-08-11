import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { DASHBOARD_MAX_INSIGHTS, type Project } from '@content-insights/shared';

import { getApiErrorMessage } from '../../lib/api-client';
import { createDashboard, updateDashboard } from '../../lib/dashboards-api';
import { INPUT_CLASSNAME } from '../../lib/form-styles';
import InsightPickerList from './InsightPickerList';

interface CreateDashboardModalProps {
  groupOptions: { id: string; name: string }[];
  projectOptions: Project[];
  onClose: () => void;
}

type Step = 'insights' | 'details';

// A two-step wizard: step 1 picks up to DASHBOARD_MAX_INSIGHTS existing saved Insights to
// import, step 2 collects the dashboard's own name/group/project — "starts by picking
// insights" per the brief, rather than the old model's name-first form. The dashboard itself
// is created empty (createDashboardSchema carries no insightIds) and the picked insights are
// attached in one bulk PUT immediately after, only if any were picked.
export default function CreateDashboardModal({ groupOptions, projectOptions, onClose }: CreateDashboardModalProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('insights');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState(groupOptions[0]?.id ?? '');
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState<string | null>(null);

  function toggleInsight(insightId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(insightId)) {
        next.delete(insightId);
      } else {
        next.add(insightId);
      }
      return next;
    });
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const created = await createDashboard({
        groupId,
        name: name.trim(),
        ...(projectId ? { projectId } : {}),
      });
      if (selectedIds.size === 0) {
        return created;
      }
      return updateDashboard(created.id, { insightIds: Array.from(selectedIds) });
    },
    onSuccess: (dashboard) => {
      void queryClient.invalidateQueries({ queryKey: ['dashboards-list'] });
      onClose();
      navigate(`/dashboards/${dashboard.id}`);
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Unable to create dashboard.')),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!groupId) {
      setError('Select a group.');
      return;
    }
    createMutation.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] p-6"
        onClick={(event) => event.stopPropagation()}
      >
        {step === 'insights' ? (
          <>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Choose insights</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Import up to {DASHBOARD_MAX_INSIGHTS} saved insights, or skip and add them later.
            </p>

            <div className="mt-4">
              <InsightPickerList selectedIds={selectedIds} onToggle={toggleInsight} maxSelectable={DASHBOARD_MAX_INSIGHTS} />
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--text-muted)]">
                {selectedIds.size}/{DASHBOARD_MAX_INSIGHTS} selected
              </span>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-[var(--radius-button)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setStep('details')}
                  className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
                >
                  Continue
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">New dashboard</h2>
            <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="dashboard-name" className="block text-sm font-medium text-[var(--text-secondary)]">
                  Name
                </label>
                <input
                  id="dashboard-name"
                  type="text"
                  required
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className={`mt-1 ${INPUT_CLASSNAME}`}
                />
              </div>
              <div>
                <label htmlFor="dashboard-group" className="block text-sm font-medium text-[var(--text-secondary)]">
                  Group
                </label>
                <select
                  id="dashboard-group"
                  value={groupId}
                  onChange={(event) => setGroupId(event.target.value)}
                  className={`mt-1 ${INPUT_CLASSNAME}`}
                >
                  {groupOptions.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </div>
              {projectOptions.length > 0 ? (
                <div>
                  <label htmlFor="dashboard-project" className="block text-sm font-medium text-[var(--text-secondary)]">
                    Project <span className="text-[var(--text-muted)]">(optional)</span>
                  </label>
                  <select
                    id="dashboard-project"
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                    className={`mt-1 ${INPUT_CLASSNAME}`}
                  >
                    <option value="">No project</option>
                    {projectOptions.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {error ? <p className="text-sm text-[var(--red)]">{error}</p> : null}

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setStep('insights')}
                  className="rounded-[var(--radius-button)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
                >
                  Back
                </button>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-[var(--radius-button)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createMutation.isPending}
                    className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {createMutation.isPending ? 'Creating…' : 'Create dashboard'}
                  </button>
                </div>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

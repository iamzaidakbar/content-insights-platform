import { SavedQueriesPanel } from '../components/SavedQueriesModal';

// The standalone /saved-searches route — now just the shared SavedQueriesPanel embedded
// full-page (no `currentFilters`, so its "Save current search" tab stays hidden here; that
// only makes sense from Articles, which has an active search in hand). All list/rename/
// share/expose/export/delete logic lives once in SavedQueriesModal.tsx, not duplicated here.
export default function SavedSearchesPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Saved Searches</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Queries saved from Articles — your own, your groups&apos; defaults, and anything shared with you.
        </p>
      </div>

      <div className="mt-6">
        <SavedQueriesPanel />
      </div>
    </div>
  );
}

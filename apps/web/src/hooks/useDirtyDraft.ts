import { useRef, useState } from 'react';

export interface DirtyDraft<T> {
  draft: T;
  setDraft: (updater: T | ((current: T) => T)) => void;
  isDirty: boolean;
  discard: () => void;
}

// Backs every Settings section's independent dirty-state: `draft` starts as a copy of
// `committed` (the current useSettings()/useAuth() value) and only ever changes via local
// edits — it does NOT resync when `committed` changes while the user is mid-edit (that
// would silently blow away unsaved input). After a real Save, the caller's own
// updateSetting()/mutation call updates `committed` to exactly what `draft` already held,
// so `isDirty` naturally flips back to false without any special-cased resync logic here.
// Plain JSON.stringify equality is enough for these shapes — small, plain-object trees
// with a fixed key order (never user-provided key order), never a source of false positives.
export function useDirtyDraft<T>(committed: T): DirtyDraft<T> {
  const [draft, setDraft] = useState<T>(committed);
  const committedRef = useRef(committed);
  committedRef.current = committed;

  const isDirty = JSON.stringify(draft) !== JSON.stringify(committed);

  function discard() {
    setDraft(committedRef.current);
  }

  return { draft, setDraft, isDirty, discard };
}

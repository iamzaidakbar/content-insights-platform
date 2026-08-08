// Small immutable get/set-by-dot-path helpers used by SettingsContext's optimistic
// update flow. Not a generic deep-clone utility — only object levels along the given
// path are copied; sibling branches keep their original object identity, which is what
// lets React skip re-rendering subtrees the update didn't touch.

export function getPath<T = unknown>(obj: Record<string, unknown>, path: string): T | undefined {
  const segments = path.split('.');
  let current: unknown = obj;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current as T | undefined;
}

export function setPath<T extends Record<string, unknown>>(obj: T, path: string, value: unknown): T {
  const segments = path.split('.');
  const [head, ...rest] = segments;
  if (!head) {
    return obj;
  }
  if (rest.length === 0) {
    return { ...obj, [head]: value };
  }
  const currentChild = obj[head];
  const child =
    currentChild !== null && typeof currentChild === 'object'
      ? (currentChild as Record<string, unknown>)
      : {};
  return { ...obj, [head]: setPath(child, rest.join('.'), value) };
}

// Inverse of a dot-path: builds the nested object a PATCH body needs from a single
// (path, value) pair, e.g. ('appearance.theme', 'light') -> { appearance: { theme: 'light' } }.
export function pathToPatch(path: string, value: unknown): Record<string, unknown> {
  const segments = path.split('.');
  let result: Record<string, unknown> = { [segments[segments.length - 1] as string]: value };
  for (let i = segments.length - 2; i >= 0; i -= 1) {
    result = { [segments[i] as string]: result };
  }
  return result;
}

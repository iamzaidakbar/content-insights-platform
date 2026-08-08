// A plain object is only safe to recurse into if none of ITS OWN values are arrays — once
// a nested object mixes in array-typed fields (e.g. search.lastUsedFilters.sources), dot-
// notation $set can only ever add/overwrite keys explicitly present, never remove keys the
// caller omitted (e.g. clearing dateRange back to {} would otherwise leave a stale
// dateRange.start in Mongo). Such objects — currently only SearchFilters — are treated as
// a single atomic leaf and replaced wholesale instead.
function isFlattenable(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return !Object.values(value).some((v) => Array.isArray(v));
}

// Turns a nested partial object into Mongo dot-notation for a $set update, e.g.
// { appearance: { theme: 'light' } } -> { 'appearance.theme': 'light' }.
export function flattenToDotNotation(
  obj: Record<string, unknown>,
  prefix = '',
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isFlattenable(value)) {
      Object.assign(result, flattenToDotNotation(value, path));
    } else {
      result[path] = value;
    }
  }
  return result;
}

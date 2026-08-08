// Turns a nested partial object into Mongo dot-notation for a $set update, e.g.
// { appearance: { theme: 'light' } } -> { 'appearance.theme': 'light' }. Only plain
// objects are recursed into — arrays and primitives are treated as leaf values, so a
// field typed as an array would be replaced wholesale rather than merged element-wise
// (not a concern for UserSettings today, since every nested field here is a plain object
// or a primitive, never an array).
export function flattenToDotNotation(
  obj: Record<string, unknown>,
  prefix = '',
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenToDotNotation(value as Record<string, unknown>, path));
    } else {
      result[path] = value;
    }
  }
  return result;
}

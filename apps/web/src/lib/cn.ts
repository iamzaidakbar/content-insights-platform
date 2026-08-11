type ClassValue = string | false | null | undefined | 0 | ClassValue[];

function flatten(inputs: ClassValue[], out: string[]): void {
  for (const input of inputs) {
    if (!input) continue;
    if (Array.isArray(input)) {
      flatten(input, out);
      continue;
    }
    out.push(input);
  }
}

/** Join conditional class names. Later utilities win when callers avoid conflicts. */
export function cn(...inputs: ClassValue[]): string {
  const parts: string[] = [];
  flatten(inputs, parts);
  return parts.join(' ');
}

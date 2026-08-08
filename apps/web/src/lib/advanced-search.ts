export interface AdvancedSearchWords {
  allWords: string;
  exactPhrase: string;
  anyWords: string;
  noneWords: string;
}

// Composes the 4 word fields into an Elasticsearch simple_query_string expression (see
// apps/api/src/lib/search.ts, which switched from `multi_match` to `simple_query_string`
// specifically so this composed syntax is honored natively): `+` requires a term, `"..."`
// is an exact phrase, `(a|b)` is an OR group, `-` excludes a term.
export function composeAdvancedSearchQuery(words: AdvancedSearchWords): string {
  const parts: string[] = [];

  const allWords = words.allWords.trim();
  if (allWords) {
    parts.push(
      allWords
        .split(/\s+/)
        .map((word) => `+${word}`)
        .join(' '),
    );
  }

  const exactPhrase = words.exactPhrase.trim();
  if (exactPhrase) {
    parts.push(`+"${exactPhrase.replace(/"/g, '')}"`);
  }

  const anyWords = words.anyWords.trim().split(/\s+/).filter(Boolean);
  if (anyWords.length > 0) {
    parts.push(`(${anyWords.join('|')})`);
  }

  const noneWords = words.noneWords.trim();
  if (noneWords) {
    parts.push(
      noneWords
        .split(/\s+/)
        .map((word) => `-${word}`)
        .join(' '),
    );
  }

  return parts.join(' ').trim();
}

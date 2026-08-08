import type { ReactNode } from 'react';

const OPEN_TAG = '<mark>';
const CLOSE_TAG = '</mark>';

/**
 * `fragment` is raw, unescaped user-uploaded document content — the only markup ES
 * was configured to insert is the literal <mark>/</mark> strings. We split on exactly
 * those two literal strings and rebuild as plain text nodes interleaved with <mark>
 * elements — never parsed as HTML, never dangerouslySetInnerHTML — so any HTML-looking
 * characters that happen to appear in the original document text render as inert,
 * auto-escaped text instead of being interpreted as markup.
 */
export default function HighlightedSnippet({ fragment }: { fragment: string }) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  while (cursor < fragment.length) {
    const openIndex = fragment.indexOf(OPEN_TAG, cursor);
    if (openIndex === -1) {
      nodes.push(fragment.slice(cursor));
      break;
    }
    if (openIndex > cursor) {
      nodes.push(fragment.slice(cursor, openIndex));
    }

    const highlightStart = openIndex + OPEN_TAG.length;
    const closeIndex = fragment.indexOf(CLOSE_TAG, highlightStart);
    if (closeIndex === -1) {
      nodes.push(fragment.slice(highlightStart)); // malformed/truncated — render as text
      break;
    }

    nodes.push(
      <mark key={key} className="rounded-sm bg-amber-500/30 px-0.5 text-amber-200">
        {fragment.slice(highlightStart, closeIndex)}
      </mark>,
    );
    key += 1;
    cursor = closeIndex + CLOSE_TAG.length;
  }

  return <>{nodes}</>;
}

import { describe, expect, it } from 'vitest';

import { normalizeExtractedText } from './text-normalize.js';

describe('normalizeExtractedText', () => {
  it('collapses glyph-spaced letter runs from PDF extraction', () => {
    const input =
      'Z A I D A K B A R BANGALORE, INDIA | iamzaidakbar@gmail.com Tech Stack: - React.js';
    const out = normalizeExtractedText(input);
    expect(out).toContain('ZAIDAKBAR');
    expect(out).not.toMatch(/\bZ A I D\b/);
    expect(out).toContain('React.js');
  });

  it('leaves normal prose alone', () => {
    const input = 'Results-driven MERN Stack Full Stack Developer with ~4 years of experience.';
    expect(normalizeExtractedText(input)).toBe(input);
  });
});

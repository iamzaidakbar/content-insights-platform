import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HighlightedSnippet from '../components/HighlightedSnippet';

describe('HighlightedSnippet', () => {
  it('renders plain text without marks', () => {
    render(<HighlightedSnippet fragment="hello world" />);
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('wraps marked regions in mark elements', () => {
    const { container } = render(
      <HighlightedSnippet fragment="before <mark>hit</mark> after" />,
    );
    const mark = container.querySelector('mark');
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toBe('hit');
  });

  it('does not interpret arbitrary HTML from the fragment', () => {
    const { container } = render(
      <HighlightedSnippet fragment={'<script>alert(1)</script> <mark>safe</mark>'} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('mark')?.textContent).toBe('safe');
  });
});

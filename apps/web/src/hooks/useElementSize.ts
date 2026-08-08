import { useEffect, useRef, useState, type RefObject } from 'react';

interface ElementSize {
  width: number;
  height: number;
}

// react-window's Fixed*Grid/Fixed*List need explicit numeric width/height (they don't
// measure their own container) — this is the minimal ResizeObserver-based alternative to
// pulling in react-virtualized-auto-sizer as an extra dependency for just that one job.
export function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, ElementSize] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}

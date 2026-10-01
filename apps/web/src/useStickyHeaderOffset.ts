import { useEffect, useRef } from 'react';

/** Keep sticky content below the header as its responsive layout changes. */
export function useStickyHeaderOffset() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = ref.current;
    if (!header) return;
    const update = () =>
      document.documentElement.style.setProperty(
        '--header-height',
        `${header.getBoundingClientRect().height}px`,
      );
    const observer = new ResizeObserver(update);
    observer.observe(header);
    update();
    return () => observer.disconnect();
  }, []);
  return ref;
}

import { useEffect, useRef, useState } from "react";

/**
 * Reports when an element has come close enough to the viewport to be worth loading.
 *
 * Home used to fetch and render every row before showing anything, which cost seconds on a cold
 * cache for rows the user had not scrolled to yet. Attaching this to a placeholder lets each
 * section pay for itself only when it is about to be seen.
 *
 * It latches: once true it stays true, so scrolling back and forth does not throw work away.
 */
export function useInView<T extends HTMLElement>(rootMargin = "600px"): {
  ref: React.RefObject<T | null>;
  inView: boolean;
} {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || inView) return;

    // Without the API the honest answer is "show it" — never a permanently blank screen.
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [inView, rootMargin]);

  return { ref, inView };
}

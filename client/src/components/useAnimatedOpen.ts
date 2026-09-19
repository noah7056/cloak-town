import { useEffect, useRef, useState } from "react";

/**
 * Keeps a menu mounted for `ms` after `open` flips to false so a
 * slide-out / fade-out animation can play, then unmounts it.
 *
 * Returns:
 * - shouldRender: keep rendering while true
 * - closing: true during the exit animation (swap to the *-out class)
 */
export function useAnimatedOpen(open: boolean, ms = 220) {
  const [render, setRender] = useState(open);
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      setRender(true);
      setClosing(false);
      return;
    }
    // open === false but still mounted: play the exit animation first
    if (!render) return;
    setClosing(true);
    timer.current = window.setTimeout(() => {
      setRender(false);
      setClosing(false);
      timer.current = null;
    }, ms);
    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [open, render, ms]);

  return { shouldRender: render, closing };
}

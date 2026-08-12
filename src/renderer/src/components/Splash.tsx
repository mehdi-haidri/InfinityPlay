import { useEffect, useState } from "react";
import iconUrl from "../assets/icon-square.png";

/** Held long enough that the animation reads as intentional rather than a flash. */
const MINIMUM_MS = 1100;
const FADE_MS = 420;

/**
 * Launch screen. Stays up until the initial data load finishes *and* the minimum time has
 * passed, then fades out and unmounts so it costs nothing afterwards.
 */
export function Splash({ ready }: { ready: boolean }) {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setElapsed(true), MINIMUM_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!ready || !elapsed || leaving) return;
    setLeaving(true);
    const timer = window.setTimeout(() => setGone(true), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [ready, elapsed, leaving]);

  if (gone) return null;

  return (
    <div className="splash" data-leaving={leaving} role="status" aria-label="Starting InfinityPlay">
      <div className="splash-glow" />

      <div className="splash-mark">
        <img src={iconUrl} alt="" className="splash-icon" />
        {/*
          The travelling highlight is an SVG stroke rather than a rotating CSS border: a
          rotated border traces a square path and drifts away from the tile's rounded
          corners. `pathLength` normalises the outline to 100 units so the dash maths does
          not depend on the tile's pixel size.
        */}
        <svg className="splash-ring" viewBox="0 0 100 100" aria-hidden="true">
          <rect
            x="1.5"
            y="1.5"
            width="97"
            height="97"
            rx="26"
            ry="26"
            pathLength={100}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      <div className="splash-name">InfinityPlay</div>

      <div className="splash-track">
        <span />
      </div>
    </div>
  );
}

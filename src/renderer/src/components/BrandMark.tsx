import type { CSSProperties } from "react";
import logoUrl from "../assets/logo.png";

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`brand-glyph ${className}`.trim()}
      style={{ "--brand-mask": `url(${logoUrl})` } as CSSProperties}
      aria-hidden="true"
    />
  );
}

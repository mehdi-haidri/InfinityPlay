import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement> & { size?: string | number };

const base = (size: string | number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export function WatchIcon({ size = 18, ...props }: Props) {
  return (
    <svg {...base(size)} {...props} aria-hidden="true">
      <path d="M8.5 6.8 17 12l-8.5 5.2z" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

export function DownloadIcon({ size = 18, ...props }: Props) {
  return (
    <svg {...base(size)} {...props} aria-hidden="true">
      <path d="M12 3v11m-4-4 4 4 4-4M5 19h14" />
    </svg>
  );
}

export function LiveIcon({ size = 18, ...props }: Props) {
  return (
    <svg {...base(size)} {...props} aria-hidden="true">
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4m8.4 0a6 6 0 0 0 0-8.4M4.6 4.6a10.5 10.5 0 0 0 0 14.8m14.8 0a10.5 10.5 0 0 0 0-14.8" />
    </svg>
  );
}

import { useState } from "react";

function initials(label: string): string {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("") || "IP";
}

export function MediaImage({
  src,
  label,
  alt = "",
  className = "",
  loading = "lazy",
}: {
  src: string | null | undefined;
  label: string;
  alt?: string;
  className?: string;
  loading?: "eager" | "lazy";
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = Boolean(src && failedSrc === src);

  if (!src || failed) {
    return (
      <span className={`media-fallback ${className}`.trim()} aria-label={alt || undefined}>
        <span>{initials(label)}</span>
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      onError={() => setFailedSrc(src ?? null)}
    />
  );
}

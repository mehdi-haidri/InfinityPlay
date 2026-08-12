import { AlertTriangle, Inbox, RotateCw } from "lucide-react";

export const Spinner = () => <div className="spinner" role="status" aria-label="Loading" />;

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="state">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="state">
      <Inbox size={34} strokeWidth={1.4} />
      <div>
        <div style={{ fontWeight: 600, color: "var(--text)" }}>{title}</div>
        {body && <div style={{ marginTop: 4 }}>{body}</div>}
      </div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state">
      <AlertTriangle size={34} strokeWidth={1.4} />
      <div>
        <div style={{ fontWeight: 600, color: "var(--text)" }}>Something went wrong</div>
        <div style={{ marginTop: 4, maxWidth: 460 }}>{message}</div>
      </div>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          <RotateCw size={14} /> Try again
        </button>
      )}
    </div>
  );
}

export function SkeletonGrid({ count = 12 }: { count?: number }) {
  return (
    <div className="grid">
      {Array.from({ length: count }, (_, index) => (
        <div key={index}>
          <div className="skeleton skeleton-card" />
          <div className="skeleton" style={{ height: 12, marginTop: 10, width: "80%" }} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonRow({ count = 7 }: { count?: number }) {
  return (
    <div className="row-scroll">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} style={{ width: 158, flex: "none" }}>
          <div className="skeleton skeleton-card" />
          <div className="skeleton" style={{ height: 12, marginTop: 10, width: "80%" }} />
        </div>
      ))}
    </div>
  );
}

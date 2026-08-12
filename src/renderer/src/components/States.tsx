import type { ReactNode } from "react";
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

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      <Inbox size={34} strokeWidth={1.4} />
      <div>
        <div className="state-title">{title}</div>
        {body && <div className="state-body">{body}</div>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state">
      <AlertTriangle size={34} strokeWidth={1.4} />
      <div>
        <div className="state-title">Something went wrong</div>
        <div className="state-body state-body-constrained">{message}</div>
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

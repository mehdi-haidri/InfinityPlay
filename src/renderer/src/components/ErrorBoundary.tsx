import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

interface Props {
  children: ReactNode;
  resetKey: string;
}

interface State {
  error: Error | null;
}

/** Keeps one malformed page response from taking down navigation, player controls, and toasts. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[renderer] Unhandled render error", error, info.componentStack);
  }

  componentDidUpdate(previous: Props): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page crash-recovery" role="alert">
        <AlertTriangle size={30} />
        <h1>This screen could not be displayed</h1>
        <p>{this.state.error.message || "InfinityPlay received data it could not display."}</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          <RotateCw size={16} /> Reload InfinityPlay
        </button>
      </div>
    );
  }
}

import { Component, type ReactNode } from "react";
import { navigate } from "../App";

/** `load-error` (ui contract, Routes): never a blank page — what went wrong, Try again, Back to the drawings. */
export function LoadError({ message, onRetry, busy = false }: { message: string; onRetry: () => void; busy?: boolean }) {
  return (
    <div className="not-found load-error" data-testid="load-error" role="alert">
      <div>
        <h2>This drawing could not be shown</h2>
        <p>{message}</p>
        <div className="row">
          <button className="btn primary" data-testid="load-retry" disabled={busy} aria-busy={busy} onClick={onRetry}>Try again</button>
          <button className="btn" data-testid="load-back" onClick={() => navigate("/")}>Back to the drawings</button>
        </div>
      </div>
    </div>
  );
}

/** Catches an editor that fails while showing a drawing, so the page explains it instead of going blank. */
export class EditorBoundary extends Component<{ children: ReactNode }, { error: Error | null; round: number }> {
  state = { error: null as Error | null, round: 0 };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error("The editor failed:", error); }
  render() {
    if (this.state.error) {
      return <LoadError message={`The editor failed while showing it: ${this.state.error.message}`}
        onRetry={() => this.setState((s) => ({ error: null, round: s.round + 1 }))} />;
    }
    return <div key={this.state.round} style={{ display: "contents" }}>{this.props.children}</div>;
  }
}

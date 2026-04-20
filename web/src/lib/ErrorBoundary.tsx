import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { panelId: string; children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[panel:${this.props.panelId}]`, error, info.componentStack);
  }

  // Reset is intentionally naive: clear state -> children re-mount -> their
  // own useQuery refetches. If a panel throws synchronously on every render,
  // Retry will loop; React keeps catching, and the user sees the same card.
  // Acceptable for a localhost dev tool.
  private reset = (): void => this.setState({ error: null });

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="panel panel--error">
          <div className="panel-header">{this.props.panelId} — error</div>
          <div className="panel-body">
            <p style={{ color: 'var(--danger)' }}>{this.state.error.message}</p>
            <button type="button" className="panel-refresh" onClick={this.reset}>
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

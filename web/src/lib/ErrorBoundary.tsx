import { Component, type ReactNode } from 'react';

type Props = { panelId: string; children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    console.error(`[panel:${this.props.panelId}]`, error);
  }

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

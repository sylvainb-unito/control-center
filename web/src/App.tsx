import type { PanelSize } from '@cc/shared';
import { ErrorBoundary } from './lib/ErrorBoundary';
import { panels } from './panels';

const SPAN: Record<PanelSize, string> = { sm: 'span 4', md: 'span 6', lg: 'span 8' };

export function App() {
  const sorted = [...panels].sort((a, b) => a.meta.order - b.meta.order);
  const topBar = sorted.filter(({ meta }) => meta.placement === 'top-bar');
  const grid = sorted.filter(({ meta }) => meta.placement !== 'top-bar');

  return (
    <main className="app">
      {topBar.length > 0 && (
        <div className="top-bar">
          {topBar.map(({ meta, UI }) => (
            <ErrorBoundary key={meta.id} panelId={meta.id}>
              <UI />
            </ErrorBoundary>
          ))}
        </div>
      )}
      <header className="app-header">
        <h1 className="app-title">CONTROL CENTER</h1>
      </header>
      <section className="panel-grid">
        {grid.length === 0 ? (
          <div className="empty">No panels registered yet.</div>
        ) : (
          grid.map(({ meta, UI }) => (
            <div
              key={meta.id}
              className="panel-slot"
              style={{ gridColumn: SPAN[meta.defaultSize] }}
            >
              <ErrorBoundary panelId={meta.id}>
                <UI />
              </ErrorBoundary>
            </div>
          ))
        )}
      </section>
    </main>
  );
}

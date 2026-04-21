import type { PanelSize } from '@cc/shared';
import { ErrorBoundary } from './lib/ErrorBoundary';
import { panels } from './panels';

const SPAN: Record<PanelSize, string> = { sm: 'span 4', md: 'span 6', lg: 'span 8' };

const TITLE_WORDS = ['Unito', 'Control', 'Center'];

export function App() {
  const sorted = [...panels].sort((a, b) => a.meta.order - b.meta.order);
  const topBar = sorted.filter(({ meta }) => meta.placement === 'top-bar');
  const grid = sorted.filter(({ meta }) => meta.placement !== 'top-bar');

  return (
    <main className="app">
      <div className="top-bar">
        <h1 className="app-title">
          {TITLE_WORDS.map((word) => (
            <span key={word} className="app-title-word">
              <span className="app-title-cap">{word[0]}</span>
              <span className="app-title-rest">{word.slice(1)}</span>
            </span>
          ))}
        </h1>
        {topBar.map(({ meta, UI }) => (
          <ErrorBoundary key={meta.id} panelId={meta.id}>
            <UI />
          </ErrorBoundary>
        ))}
      </div>
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

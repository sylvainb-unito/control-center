import type { PanelSize } from '@cc/shared';
import { panels } from './panels';

const SPAN: Record<PanelSize, string> = { sm: 'span 4', md: 'span 6', lg: 'span 8' };

export function App() {
  const sorted = [...panels].sort((a, b) => a.meta.order - b.meta.order);
  return (
    <main className="app">
      <header className="app-header">
        <h1 className="app-title">CONTROL CENTER</h1>
      </header>
      <section className="panel-grid">
        {sorted.length === 0 ? (
          <div className="empty">No panels registered yet.</div>
        ) : (
          sorted.map(({ meta, UI }) => (
            <div
              key={meta.id}
              className="panel-slot"
              style={{ gridColumn: SPAN[meta.defaultSize] }}
            >
              <UI />
            </div>
          ))
        )}
      </section>
    </main>
  );
}

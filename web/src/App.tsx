import type { PanelSize } from '@cc/shared';
import { CaptureModal } from './components/CaptureModal';
import { ErrorBoundary } from './lib/ErrorBoundary';
import { CaptureModalProvider, useCaptureModal } from './lib/useCaptureModal';
import { useGlobalShortcut } from './lib/useGlobalShortcut';
import { panels } from './panels';

const SPAN: Record<PanelSize, string> = { sm: 'span 4', md: 'span 6', lg: 'span 8' };

function AppShell() {
  const { open } = useCaptureModal();
  useGlobalShortcut({ key: 'b', meta: true, shift: true }, open);

  const sorted = [...panels].sort((a, b) => a.meta.order - b.meta.order);
  const topBar = sorted.filter(({ meta }) => meta.placement === 'top-bar');
  const grid = sorted.filter(({ meta }) => meta.placement !== 'top-bar');

  return (
    <main className="app">
      <div className="top-bar">
        <h1 className="app-title">
          <img className="app-title-icon" src="/nico.png" alt="" aria-hidden="true" />
          <span className="app-title-cap">N.I.C.</span>
          <span className="app-title-rest">(Neon Info Center)</span>
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
      <CaptureModal />
    </main>
  );
}

export function App() {
  return (
    <CaptureModalProvider>
      <AppShell />
    </CaptureModalProvider>
  );
}

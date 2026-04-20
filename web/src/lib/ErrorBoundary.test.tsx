import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

afterEach(cleanup);

function Boom(): never {
  throw new Error('kaboom');
}

describe('ErrorBoundary', () => {
  test('renders children when no error', () => {
    render(
      <ErrorBoundary panelId="x">
        <div>ok</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('ok')).toBeInTheDocument();
  });

  test('renders error fallback on throw', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary panelId="x">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/kaboom/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    spy.mockRestore();
  });

  test('Retry clears error state when cause is fixed', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Flaky() {
      // Throws on first render, recovers after. We simulate "cause fixed" by
      // toggling outside state via a ref module-scoped variable.
      if (!recovered.current) throw new Error('first-render');
      return <div>recovered</div>;
    }
    const recovered = { current: false };

    function Harness() {
      const [, force] = useState(0);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              recovered.current = true;
              force((x) => x + 1);
            }}
          >
            fix
          </button>
          <ErrorBoundary panelId="flaky">
            <Flaky />
          </ErrorBoundary>
        </>
      );
    }

    const { container } = render(<Harness />);
    const scope = within(container);
    // Initial render throws → fallback shows
    expect(scope.getByText(/first-render/i)).toBeInTheDocument();
    // "Fix" the cause (flip recovered flag and re-render harness)
    fireEvent.click(scope.getByRole('button', { name: /fix/i }));
    // Click Retry → boundary clears state → children re-mount → render succeeds
    fireEvent.click(scope.getByRole('button', { name: /retry/i }));
    expect(scope.getByText('recovered')).toBeInTheDocument();
    spy.mockRestore();
  });
});

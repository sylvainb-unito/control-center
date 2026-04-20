import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

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
});

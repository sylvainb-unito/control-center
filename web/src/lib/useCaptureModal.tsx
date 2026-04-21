import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';

type Ctx = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

const CaptureModalContext = createContext<Ctx | null>(null);

export function CaptureModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const value = useMemo(() => ({ isOpen, open, close }), [isOpen, open, close]);
  return <CaptureModalContext.Provider value={value}>{children}</CaptureModalContext.Provider>;
}

export function useCaptureModal(): Ctx {
  const ctx = useContext(CaptureModalContext);
  if (!ctx) throw new Error('useCaptureModal must be used inside <CaptureModalProvider>');
  return ctx;
}

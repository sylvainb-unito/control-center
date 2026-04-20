import type { Hono } from 'hono';
import type { FC } from 'react';

export type PanelSize = 'sm' | 'md' | 'lg';

export type PanelMeta = {
  id: string;
  title: string;
  icon?: string;
  order: number;
  defaultSize: PanelSize;
};

export type PanelUI = FC;
export type PanelAPI = Hono;

export type EnvelopeError = { code: string; message: string };
export type Envelope<T> = { ok: true; data: T } | { ok: false; error: EnvelopeError };

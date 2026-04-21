import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { fetchJson } from '../lib/fetchJson';
import { useCaptureModal } from '../lib/useCaptureModal';
import s from './CaptureModal.module.css';

const MAX = 8000;

export function CaptureModal() {
  const { isOpen, close } = useCaptureModal();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: async (rawText: string) =>
      fetchJson<{ id: string }>('/api/braindump', {
        method: 'POST',
        body: JSON.stringify({ rawText }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['braindump'] });
      setText('');
      setError(null);
      close();
    },
    onError: (err) => {
      setError((err as Error).message);
    },
  });

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setText('');
    const t = setTimeout(() => textareaRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, close]);

  if (!isOpen) return null;

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      setError('Empty entry');
      return;
    }
    if (text.length > MAX) {
      setError(`Too long (${text.length} / ${MAX})`);
      return;
    }
    save.mutate(text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  const counterClass = text.length > MAX * 0.9 ? `${s.counter} ${s.counterWarn}` : s.counter;

  return (
    <div
      className={s.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <dialog className={s.card} aria-label="Braindump" open>
        <div className={s.title}>Braindump</div>
        <textarea
          ref={textareaRef}
          className={s.textarea}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="dump a thought, a TODO, or something to read later…"
          rows={6}
        />
        {error && <div className={s.error}>{error}</div>}
        <div className={s.footer}>
          <span className={counterClass}>
            {text.length} / {MAX}
          </span>
          <div className={s.buttons}>
            <button type="button" className={s.btn} onClick={close}>
              Cancel (Esc)
            </button>
            <button
              type="button"
              className={`${s.btn} ${s.btnPrimary}`}
              onClick={submit}
              disabled={save.isPending}
            >
              {save.isPending ? 'Saving…' : 'Save (⌘↵)'}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}

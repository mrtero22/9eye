import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cx } from './cx';

type ToastTone = 'neutral' | 'red';
/** One follow-up a toast may offer ("Details"); the toast then stays a little longer. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}
interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
  action?: ToastAction;
}

const Ctx = createContext<(text: string, tone?: ToastTone, action?: ToastAction) => void>(() => {});

/** Short confirmations ("Saved", "Applied to 23 blocks"); errors stay on screen as notices instead. */
export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const drop = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (text: string, tone: ToastTone = 'neutral', action?: ToastAction) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-2), { id, text, tone, action }]);
      setTimeout(() => drop(id), action ? 8000 : 3500);
    },
    [drop],
  );
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="no-print pointer-events-none fixed bottom-20 right-4 z-[60] flex flex-col items-end gap-2 sm:bottom-6">
        {toasts.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto flex max-w-[440px] items-baseline gap-3 rounded-item border px-3 py-2 text-small shadow-pop', t.tone === 'red' ? 'border-red-soft bg-red-soft text-red-text' : 'border-border bg-surface text-text')}>
            <span>{t.text}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  drop(t.id);
                  t.action!.onClick();
                }}
                className="shrink-0 cursor-pointer border-0 bg-transparent p-0 font-medium text-accent-text hover:underline"
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

// Sign-in (decision 0021, docs/design/sign-in-page.md): e-mail and password, then back to the page that
// was asked for. The day on the right is sample data that shows what the product does.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { FRAME_RATES, formatTc } from '@9eye/core';
import { safeNext, useMe } from '@/app/session';
import { usePrefs } from '@/app/prefs';
import { api, errorText } from '@/lib/api';
import type { Me } from '@/lib/types';
import { Button, IconButton, Notice, PRODUCT_NAME, PasswordField, SignInLayout, TextField, Wordmark, cx } from '@/ui';

export function SignInPage() {
  const prefs = usePrefs();
  const me = useMe();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const expired = params.get('reason') === 'expired';
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const signIn = useMutation({
    mutationFn: () => api<Me>('POST', '/auth/sign-in', { email, password }),
    onSuccess: (who) => {
      qc.clear();
      qc.setQueryData(['me'], who);
      navigate(next, { replace: true });
    },
    onError: (e) => {
      setError(errorText(e));
      setPassword('');
      passwordRef.current?.focus();
    },
  });

  if (me.data) return <Navigate to={next} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Type your email and password.');
      return;
    }
    setError(null);
    signIn.mutate();
  };
  const dark = prefs.theme === 'dark';

  return (
    <SignInLayout
      brand={<Wordmark />}
      corner={<IconButton icon={dark ? 'sun' : 'moon'} label={dark ? 'Light theme' : 'Dark theme'} tone="quiet" onClick={() => prefs.setTheme(dark ? 'light' : 'dark')} />}
      footer={
        <>
          <span>{PRODUCT_NAME} · scheduling and traffic for TV channels</span>
          <span>Development build</span>
        </>
      }
      aside={<DayPreview />}
    >
      <form onSubmit={submit} noValidate aria-labelledby="sign-in-title" className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 id="sign-in-title" className="m-0 text-title font-semibold tracking-[-0.02em]">
            Sign in
          </h1>
          <p className="m-0 text-text-2">Welcome back. Use your work email to continue.</p>
        </div>
        {expired && !error && <Notice>You were signed out. Sign in again to continue.</Notice>}
        <div className="flex flex-col gap-4">
          <TextField
            large
            label="Email"
            type="email"
            name="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <PasswordField large ref={passwordRef} label="Password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <Notice tone="red">{error}</Notice>}
        <Button type="submit" variant="primary" size="lg" disabled={signIn.isPending} className="w-full">
          {signIn.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="m-0 text-small text-text-3">Forgot your password? Ask your company admin.</p>
      </form>
    </SignInLayout>
  );
}

// ---------------------------------------------------------------- the sample day on the right

const R = FRAME_RATES['25'];
const sec = (s: number) => s * R.nominal;

type Kind = 'program' | 'commercial' | 'ident' | 'promo' | 'filler';

const KIND: Record<Kind, { bar: string; label: string }> = {
  program: { bar: 'bg-[var(--ct-program)]', label: 'Program' },
  commercial: { bar: 'bg-[var(--ct-commercial)]', label: 'Ad break' },
  ident: { bar: 'bg-[var(--ct-ident)]', label: 'Ident' },
  promo: { bar: 'bg-[var(--ct-promo)]', label: 'Trailer' },
  filler: { bar: 'bg-[var(--ct-filler)]', label: 'Filler' },
};

const SAMPLE: { title: string; kind: Kind; length: number }[] = [
  { title: 'Morning Report', kind: 'program', length: sec(58 * 60 + 30) },
  { title: 'Break 1', kind: 'commercial', length: sec(3 * 60) },
  { title: 'Station ident', kind: 'ident', length: sec(10) },
  { title: 'Coastal Patrol · S2 E4', kind: 'program', length: sec(44 * 60 + 20) },
  { title: 'Break 2', kind: 'commercial', length: sec(4 * 60) },
  { title: 'Weekend Cinema', kind: 'promo', length: sec(30) },
  { title: 'Planet Atlas · E7', kind: 'program', length: sec(52 * 60) },
];
const ON_AIR = 3;

function DayPreview() {
  let start = sec(6 * 3600);
  const rows = SAMPLE.map((r) => {
    const row = { ...r, start };
    start += r.length;
    return row;
  });
  return (
    <figure aria-label="A sample day on a channel" className="m-0 flex w-full max-w-[540px] flex-col gap-8">
      <div aria-hidden="true" className="overflow-hidden rounded-panel border border-border bg-surface">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-item bg-surface-3 text-small font-semibold text-text-2">C1</span>
          <span className="flex min-w-0 flex-1 flex-col leading-[1.3]">
            <span className="font-medium">Channel one</span>
            <span className="text-meta text-text-3">Today · 25 fps</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-meta font-medium text-text-2">
            <span className="size-1.5 rounded-full bg-red" />
            On air
          </span>
        </div>
        <ol className="m-0 list-none p-0">
          {rows.map((r, i) => (
            <li key={r.title} className={cx('grid grid-cols-[auto_3px_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-hairline px-4 py-2 last:border-b-0', i === ON_AIR && 'bg-surface-2')}>
              <span className={cx('mono text-small', i === ON_AIR ? 'text-text' : 'text-text-3')}>{formatTc(r.start, R)}</span>
              <span className={cx('h-8 rounded-[2px]', KIND[r.kind].bar)} />
              <span className="flex min-w-0 flex-col leading-[1.35]">
                <span className="truncate text-small font-medium">{r.title}</span>
                {i === ON_AIR ? (
                  <span className="mt-1 flex h-1 w-full max-w-[180px] overflow-hidden rounded-[2px] bg-surface-3">
                    <span className="w-[62%] bg-text-3" />
                  </span>
                ) : (
                  <span className="truncate text-meta text-text-3">{KIND[r.kind].label}</span>
                )}
              </span>
              <span className="mono text-meta text-text-3">{formatTc(r.length, R)}</span>
            </li>
          ))}
        </ol>
      </div>
      <figcaption className="flex flex-col gap-1.5">
        <span className="text-section font-semibold tracking-[-0.01em]">Plan the grid, build the playlist, send it to playout.</span>
        <span className="text-small text-text-2">Media, layouts, scheduling, playlists and ads for every channel, in one place.</span>
      </figcaption>
    </figure>
  );
}

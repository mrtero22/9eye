// The signed-in person (decision 0021): the app's pages show only once the server knows who it is.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { ApiError, api, errorText } from '@/lib/api';
import type { Me } from '@/lib/types';
import { Button, Notice } from '@/ui';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('GET', '/auth/me'), retry: false, staleTime: Infinity });
}

/** Where to go after signing in: a page of this app, never another site or the sign-in itself. */
export function safeNext(path: string | null): string {
  return path && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') && !path.startsWith('/sign-in') ? path : '/';
}

export function RequireSignIn({ children }: { children: ReactNode }) {
  const me = useMe();
  const { pathname, search } = useLocation();
  if (me.isPending) return null;
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <Navigate to={pathname === '/' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(pathname + search)}`} replace />;
    }
    return (
      <div className="min-h-screen bg-bg px-4 pt-8 sm:px-8">
        <div className="max-w-2xl">
          <Notice tone="red" action={<Button size="sm" onClick={() => me.refetch()}>Try again</Button>}>
            {errorText(me.error)}
          </Notice>
        </div>
      </div>
    );
  }
  return children;
}

export function useSignOut() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    try {
      await api('POST', '/auth/sign-out');
    } catch {
      /* the session is gone either way */
    }
    qc.clear();
    navigate('/sign-in', { replace: true });
  };
}

// Talking to the 9eye API (proxied at /api in development).

export interface Problem {
  code: string;
  message: string;
  blockId?: string;
  weekday?: number;
  templateId?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public problems: Problem[],
  ) {
    super(message);
  }
}

const TENANT_KEY = '9eye.company';

/**
 * The company the person works in: picked in the top bar, kept in this browser. None kept yet (or
 * one that is not theirs): the top bar opens their first company.
 */
export function currentCompany(): string {
  try {
    return localStorage.getItem(TENANT_KEY) || '';
  } catch {
    return '';
  }
}

export function setCurrentCompany(slug: string) {
  try {
    localStorage.setItem(TENANT_KEY, slug);
  } catch {
    /* private mode: stays for this page only */
  }
}

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Tenant': currentCompany() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    if (r.status === 401 && !path.startsWith('/auth/')) backToSignIn();
    const j = (await r.json().catch(() => ({}))) as { error?: string; problems?: Problem[] };
    throw new ApiError(r.status, j.error ?? `The server answered ${r.status}.`, j.problems ?? []);
  }
  return (r.status === 204 ? undefined : await r.json()) as T;
}

/** The session ran out or was signed out elsewhere: sign in again, then come back to this page. */
function backToSignIn() {
  const { pathname, search } = window.location;
  if (pathname !== '/sign-in') window.location.assign(`/sign-in?reason=expired&next=${encodeURIComponent(pathname + search)}`);
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message === 'Failed to fetch' ? 'The server cannot be reached.' : e.message;
  return 'Something went wrong.';
}

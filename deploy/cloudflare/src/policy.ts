// The Worker's decisions as plain functions, so they can be tested without Cloudflare.

export const STATUS_FAILURES_BEFORE_STOP = 5; // checks in a row that could not ask the service
const MAX_FILE_BYTES = 1_500_000; // a Durable Object's SQLite row holds 2 MB at most

export function decideIdle(s: { quietMs: number; idleMs: number; pending: number | null; failedChecks: number }): 'stop' | 'keep' {
  if (s.quietMs <= s.idleMs) return 'keep';
  if (s.pending === null) return s.failedChecks >= STATUS_FAILURES_BEFORE_STOP ? 'stop' : 'keep'; // cannot tell is not "none"
  return s.pending === 0 ? 'stop' : 'keep';
}

// `/f/PATH`, `/e/PATH` or `/l/PATH` with a path of letters, digits and . _ - / only; null for anything else.
export function storeRoute(pathname: string): { route: 'f' | 'e' | 'l'; path: string } | null {
  const m = /^\/(f|e|l)\/(.+)$/.exec(pathname);
  if (!m) return null;
  let path: string;
  try {
    path = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  if (path.includes('..') || path.includes('//') || !/^[A-Za-z0-9._\-\/]+$/.test(path)) return null;
  return { route: m[1] as 'f' | 'e' | 'l', path };
}

// The service trusts one proxy hop, so the header it reads must be the one Cloudflare vouches for.
export function forwardedHeaders(original: Headers): Headers {
  const headers = new Headers(original);
  const caller = original.get('CF-Connecting-IP');
  if (caller) headers.set('X-Forwarded-For', caller);
  else headers.delete('X-Forwarded-For');
  return headers;
}

export function tooLarge(bytes: number): boolean {
  return bytes > MAX_FILE_BYTES;
}

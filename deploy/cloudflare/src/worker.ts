// The only non-Guion file that runs Lotcast: Cloudflare starts a Container only from Worker code.
// It decides nothing. It starts the one container that runs `lotcast serve`, passes /v1/... requests to
// it with the caller's address, and keeps the container awake while a draw is still waiting on a beacon.
// The checking page is static (see `assets` in wrangler.jsonc) and is served before this code runs.
import { Container, getContainer } from '@cloudflare/containers';

export { ContainerProxy } from '@cloudflare/containers';


interface Env {
  LOTCAST: DurableObjectNamespace<Lotcast>;
  LOTCAST_OPERATOR_KEY: string;
  PUBLIC_URL: string; // https://NAME.SUBDOMAIN.workers.dev: where the container reaches the store
  IDLE_MINUTES?: string; // minutes without an outside request before sleeping (default 30)
}

// The log's files live in this Durable Object's SQLite database, not on the container's disk (which
// is erased whenever the container stops). The service reaches them through the Worker's own address
// at /internal/store/..., with a bearer token only the container and the Worker know (derived from the
// operator key, which is itself never sent). See vfs.gu in the lotcast-log package for the protocol.
export class Lotcast extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '24h'; // the library's own timer is only a backstop; checkIdle decides
  // Set after construction: `env` is only available then.
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      LOTCAST_OPERATOR_KEY: env.LOTCAST_OPERATOR_KEY,
      LOTCAST_STORE_URL: `${env.PUBLIC_URL}/internal/store`,
      LOTCAST_STORE_HOST: new URL(env.PUBLIC_URL).hostname,
      LOTCAST_STORE_TOKEN: '', // replaced below, once the token is derived
    };
    ctx.blockConcurrencyWhile(async () => {
      this.envVars = { ...this.envVars, LOTCAST_STORE_TOKEN: await storeToken(env.LOTCAST_OPERATOR_KEY) };
    });
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, data BLOB NOT NULL)');
  }

  // Sleep is decided here, not by the library's timer (which did not fire on Cloudflare while the
  // service was polling the store): the container stops when no outside request has arrived for
  // IDLE_MS and no draw is pending. Store calls from the container itself do not count as activity.
  private idleMs(): number {
    const minutes = Number(this.env.IDLE_MINUTES ?? '30');
    return (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60 * 1000;
  }

  async fetch(request: Request): Promise<Response> {
    this.ctx.storage.kv.put('lastSeen', Date.now());
    return super.fetch(request);
  }

  // What the idle logic last saw, for the operator (see docs/operations.md).
  async diag(): Promise<Response> {
    const kv = this.ctx.storage.kv;
    return Response.json({
      running: this.ctx.container?.running ?? false,
      lastSeen: kv.get('lastSeen') ?? null,
      lastAlarm: kv.get('lastAlarm') ?? null,
      lastCheck: kv.get('lastCheck') ?? null,
      outcome: kv.get('outcome') ?? null,
      idleMinutes: this.idleMs() / 60000,
      now: Date.now(),
    });
  }

  // The library runs its alarm loop for as long as the container runs (every three minutes or less),
  // so the idle check rides on it rather than on a schedule of its own.
  async alarm(alarmProps?: { isRetry: boolean; retryCount: number }): Promise<void> {
    this.ctx.storage.kv.put('lastAlarm', Date.now());
    try {
      await this.checkIdle();
    } catch (e) {
      console.error('idle check failed', e);
    }
    return super.alarm(alarmProps);
  }

  async checkIdle(): Promise<void> {
    const kv = this.ctx.storage.kv;
    const last = kv.get<{ at: number }>('lastCheck');
    if (last && Date.now() - last.at < 30_000) return;
    kv.put('lastCheck', { at: Date.now(), running: this.ctx.container?.running ?? false });
    if (!this.ctx.container?.running) return;
    const quiet = Date.now() - (kv.get<number>('lastSeen') ?? 0);
    if (quiet <= this.idleMs()) return;
    let pending = 1;
    try {
      const status = await this.ctx.container.getTcpPort(this.defaultPort).fetch('http://container/v1/status');
      pending = ((await status.json()) as { pending?: number }).pending ?? 1;
    } catch (e) {
      kv.put('outcome', `status failed: ${String(e)}`);
      pending = 0; // cannot be asked: do not keep a broken container alive
    }
    console.log(`idle check: quiet ${Math.round(quiet / 1000)}s, pending draws ${pending}`);
    kv.put('outcome', `quiet ${Math.round(quiet / 1000)}s, pending ${pending}`);
    if (pending === 0) {
      console.log('stopping the container');
      try {
        await this.stop();
        // The service is process 1 in its container, which ignores SIGTERM unless it handles it: give it
        // ten seconds, then kill it. Nothing is lost: no draw is pending and the log lives in this object.
        for (let i = 0; i < 10 && this.ctx.container?.running; i++) await new Promise((r) => setTimeout(r, 1000));
        const killed = this.ctx.container?.running ?? false;
        if (killed) await this.destroy();
        kv.put('outcome', `${killed ? 'killed' : 'stopped'} after quiet ${Math.round(quiet / 1000)}s`);
      } catch (e) {
        kv.put('outcome', `stop failed: ${String(e)}`);
        throw e;
      }
    }
  }

  async store(request: Request): Promise<Response> {
    const sql = this.ctx.storage.sql;
    const url = new URL(request.url);
    const route = url.pathname.slice(0, 2); // /f /e /l
    const path = decodeURIComponent(url.pathname.slice(3));
    if (path === '' || path.includes('..') || path.includes('//') || !/^[A-Za-z0-9._\-\/]+$/.test(path)) {
      return new Response('bad path', { status: 400 });
    }
    const exists = (key: string) => sql.exec('SELECT 1 FROM files WHERE path = ?', key).toArray().length > 0;
    const below = (dir: string) =>
      sql.exec('SELECT path FROM files WHERE path >= ? AND path < ?', `${dir}/`, `${dir}0`).toArray().map((r) => r.path as string);
    if (route === '/f' && request.method === 'PUT') {
      const data = await request.arrayBuffer();
      if (request.headers.get('if-none-match') === '*') {
        // The check and the write happen together, so only one caller can create the lock.
        return this.ctx.storage.transactionSync(() => {
          if (exists(path)) return new Response('exists', { status: 412 });
          sql.exec('INSERT INTO files (path, data) VALUES (?, ?)', path, data);
          return new Response(null, { status: 201 });
        });
      }
      sql.exec('INSERT OR REPLACE INTO files (path, data) VALUES (?, ?)', path, data);
      return new Response(null, { status: 204 });
    }
    if (route === '/f' && request.method === 'GET') {
      const rows = sql.exec('SELECT data FROM files WHERE path = ?', path).toArray();
      return rows.length ? new Response(rows[0].data as ArrayBuffer) : new Response('missing', { status: 404 });
    }
    if (route === '/f' && request.method === 'DELETE') {
      const key = exists(path) ? path : `${path}/.dir`;
      if (!exists(key)) return new Response('missing', { status: 404 });
      sql.exec('DELETE FROM files WHERE path = ?', key);
      return new Response(null, { status: 204 });
    }
    if (route === '/e' && request.method === 'GET') {
      const there = exists(path) || exists(`${path}/.dir`) || below(path).length > 0;
      return new Response(there ? 'yes' : 'no', { status: there ? 200 : 404 });
    }
    if (route === '/l' && request.method === 'GET') {
      const rows = below(path);
      const names = new Set<string>();
      for (const row of rows) {
        const name = row.slice(path.length + 1).split('/')[0];
        if (name !== '.dir') names.add(name);
      }
      return new Response(JSON.stringify([...names].sort()), { headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  }

  // The idle timer ran out. Sleep only if no draw is waiting: a draw cut off by sleep would resume
  // on the next wake (the service recovers), but staying up lets it finish on time.
  async onActivityExpired(): Promise<void> {
    try {
      // The raw port, not containerFetch: containerFetch counts as activity and would keep it awake forever.
      const status = await this.ctx.container!.getTcpPort(this.defaultPort).fetch('http://container/v1/status');
      const body = (await status.json()) as { pending?: number };
      console.log(`idle timer expired; pending draws: ${body.pending}`);
      if (typeof body.pending === 'number' && body.pending > 0) {
        this.renewActivityTimeout();
        return;
      }
    } catch {
      // If the service cannot be asked, do not keep a broken container alive forever.
    }
    console.log('stopping the container');
    await this.stop();
  }
}

async function storeToken(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`lotcast-store:${key}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/internal/store/')) {
      const sent = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
      if (!sameText(sent, await storeToken(env.LOTCAST_OPERATOR_KEY))) return new Response('forbidden', { status: 403 });
      url.pathname = url.pathname.slice('/internal/store'.length);
      return getContainer(env.LOTCAST, 'lotcast').store(new Request(url, request));
    }
    if (url.pathname === '/internal/diag') {
      const sent = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
      if (!sameText(sent, await storeToken(env.LOTCAST_OPERATOR_KEY))) return new Response('forbidden', { status: 403 });
      return getContainer(env.LOTCAST, 'lotcast').diag();
    }
    if (!url.pathname.startsWith('/v1/')) return new Response('not found', { status: 404 });
    // One name, one Durable Object, one container: only one writer ever touches the log.
    const headers = new Headers(request.headers);
    const caller = request.headers.get('CF-Connecting-IP');
    if (caller) headers.set('X-Forwarded-For', caller); // replaces anything the client sent
    return getContainer(env.LOTCAST, 'lotcast').fetch(new Request(request, { headers }));
  },
};

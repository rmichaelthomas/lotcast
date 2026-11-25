// The only non-Guion file that runs Lotcast: Cloudflare starts a Container only from Worker code.
// It decides nothing. It starts the one container that runs `lotcast serve`, passes /v1/... requests to
// it with the caller's address, and keeps the container awake while a draw is still waiting on a beacon.
// The checking page is static (see `assets` in wrangler.jsonc) and is served before this code runs.
import { Container, getContainer } from '@cloudflare/containers';

interface Env {
  LOTCAST: DurableObjectNamespace<Lotcast>;
  LOTCAST_OPERATOR_KEY: string;
  SLEEP_AFTER?: string; // for tests only; the default is 30 minutes
}

export class Lotcast extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '30m';
  // Set after construction: `env` is only available then.
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    if (env.SLEEP_AFTER) this.sleepAfter = env.SLEEP_AFTER;
    this.envVars = { LOTCAST_OPERATOR_KEY: env.LOTCAST_OPERATOR_KEY };
  }

  // The idle timer ran out. Sleep only if no draw is waiting: a draw cut off by sleep would resume
  // on the next wake (the service recovers), but staying up lets it finish on time.
  async onActivityExpired(): Promise<void> {
    try {
      // The raw port, not containerFetch: containerFetch counts as activity and would keep it awake forever.
      const status = await this.ctx.container!.getTcpPort(this.defaultPort).fetch('http://container/v1/status');
      const body = (await status.json()) as { pending?: number };
      if (typeof body.pending === 'number' && body.pending > 0) {
        this.renewActivityTimeout();
        return;
      }
    } catch {
      // If the service cannot be asked, do not keep a broken container alive forever.
    }
    await this.stop();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/v1/')) return new Response('not found', { status: 404 });
    // One name, one Durable Object, one container: only one writer ever touches the log.
    const headers = new Headers(request.headers);
    const caller = request.headers.get('CF-Connecting-IP');
    if (caller) headers.set('X-Forwarded-For', caller); // replaces anything the client sent
    return getContainer(env.LOTCAST, 'lotcast').fetch(new Request(request, { headers }));
  },
};

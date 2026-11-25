// The draw page's flow with no DOM: seal the question, post the request, check the answer against
// what was sent, wait for the receipt, check that, and survive a reload in between. Everything that
// needs trust runs in Guion (the entry points in verify.gu); this file only moves bytes and waits.

export const STEPS = 5000000; // the same budget the checker uses
export const PENDING_KEY = 'lotcast:pending';
export const LIVE_SOURCES = ['curby-rng', 'drand-quicknet', 'nist-beacon-2'];
const TEN_MINUTES = 10 * 60 * 1000;
const FIRST_BACKOFF = 2000;
const LAST_BACKOFF = 10000;

export const MESSAGES = {
  'rate-limited': 'Lotcast allows one draw a minute from each connection. Try again in a minute.',
  unreachable: "Couldn't reach Lotcast. Check your connection and try again.",
  'anchor-failed': "This draw couldn't be time-stamped, so nothing was drawn. You can draw again.",
  'still-waiting': 'Your draw is still waiting for random numbers. Leave this page open, or come back later on this device.',
};

const failure = (kind, message) => ({ kind, message });
const untrusted = (problem) => failure('untrusted', `Do not trust this draw: ${problem}`);
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

// deps.vm(entry, args) -> string, built from Guion's browser VM and public/verify.gub.
export function makeVm(run, modules, artifact, steps = STEPS) {
  return (entry, args) => {
    const out = run(modules, artifact, { steps, allowRaisedSteps: true }, { entry, arguments: args });
    if (!out.ok) throw new Error(`the checker failed: ${out.message || out.code}`);
    return out.value;
  };
}

// What the visitor can be told from a view: how far along the draw is.
export function progress(view) {
  const waiting = Array.isArray(view?.waiting_on) ? view.waiting_on : [];
  const on = (source) => waiting.some((w) => w.source === source);
  const stillOut = new Set(waiting.map((w) => w.source).filter((s) => LIVE_SOURCES.includes(s)));
  const done = view?.status === 'complete';
  return {
    logged: done || !on('log'),
    stamped: done || (!on('log') && !on('anchor')),
    sourcesIn: done ? 3 : 3 - stillOut.size,
    sourcesTotal: 3,
    done,
  };
}

export function resumePending(store) {
  try {
    const raw = store.getItem(PENDING_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw);
    return pending && typeof pending.id === 'string' ? pending : null;
  } catch {
    return null;
  }
}

function clearPending(store) {
  try { store.removeItem(PENDING_KEY); } catch { /* storage may be unavailable */ }
}

async function readJson(res) {
  try { return JSON.parse(await res.text()); } catch { return null; }
}

// choice = { tradition, method, options: {..text}, question }
export async function startDraw(choice, deps) {
  const { vm, fetch, random, store, operatorKey } = deps;
  const nonceHex = hex(random(16));
  const saltHex = hex(random(32));
  const question = choice.question ?? '';
  const plan = JSON.parse(vm('draw_plan', [choice.tradition, choice.method, JSON.stringify(choice.options ?? {}), question, nonceHex, saltHex]));
  if (plan.error) return failure('refused', `Lotcast turned this request down: ${plan.error}`);
  let res;
  try {
    res = await fetch('/v1/draws', { method: 'POST', headers: { 'content-type': 'application/json' }, body: plan.body });
  } catch {
    return failure('unreachable', MESSAGES.unreachable);
  }
  if (res.status === 429) return failure('rate-limited', MESSAGES['rate-limited']);
  const reply = await readJson(res);
  const busy = res.status === 503 && reply?.error?.code === 'E_BUSY'; // not logged yet; the poll binds it later
  if (!res.ok && !busy) {
    return failure('refused', `Lotcast turned this request down: ${reply?.error?.message ?? `status ${res.status}`}`);
  }
  if (!busy) {
    const problem = vm('check_view', [JSON.stringify(reply), operatorKey, plan.request_json, plan.entry_hash]);
    if (problem !== '') return untrusted(problem);
  }
  const pending = {
    id: plan.entry_hash.slice(0, 32),
    index: busy ? null : reply.index,
    tradition: choice.tradition,
    method: choice.method,
    request_json: plan.request_json,
    entry_hash: plan.entry_hash,
    question: plan.asked ? question : '',
    salt_hex: saltHex,
    startedAt: deps.now ? deps.now() : Date.now(),
  };
  try { store.setItem(PENDING_KEY, JSON.stringify(pending)); } catch { /* the draw still works without storage */ }
  return pending;
}

// A queued view has no index or promise yet: there is nothing to check and nothing to show.
const queued = (view) => view && view.status === 'pending' && view.promise === undefined && (view.waiting_on ?? []).some((w) => w.source === 'log');

export async function pollDraw(pending, deps, onProgress = () => {}) {
  const { vm, fetch, store, operatorKey, sleep, now } = deps;
  let backoff = FIRST_BACKOFF;
  for (;;) {
    if (now() - pending.startedAt >= TEN_MINUTES) return failure('still-waiting', MESSAGES['still-waiting']);
    let res;
    let text;
    try {
      res = await fetch(`/v1/draws/${pending.id}`);
      text = res.ok ? await res.text() : null;
    } catch {
      res = null;
    }
    if (!res || text === null) {
      await sleep(backoff);
      backoff = Math.min(backoff * 2, LAST_BACKOFF);
      continue;
    }
    backoff = FIRST_BACKOFF;
    let view;
    try { view = JSON.parse(text); } catch { return untrusted("the service's answer is not JSON"); }
    if (!queued(view)) {
      const problem = vm('check_view', [text, operatorKey, pending.request_json, pending.entry_hash]);
      if (problem !== '') return untrusted(problem);
    }
    onProgress(progress(view), view);
    if (view.status === 'anchor-failed') {
      clearPending(store);
      return failure('anchor-failed', MESSAGES['anchor-failed']);
    }
    if (view.status === 'complete') {
      const verdict = JSON.parse(vm('verify_draw', [JSON.stringify(view.receipt), operatorKey, pending.question, pending.salt_hex]));
      clearPending(store);
      return { receipt: view.receipt, outcome: view.receipt.outcome, verdict };
    }
    await sleep(Number.isFinite(view.poll_after_ms) ? view.poll_after_ms : 2000);
  }
}

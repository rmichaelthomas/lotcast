// The draw flow against Guion's real browser VM and the built checker, with a fake fetch that
// replays scripted responses: node --test draw-flow.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadModules, run } from './public/loader.mjs';
import { makeVm, startDraw, pollDraw, progress, resumePending, loadRegistry, MESSAGES, PENDING_KEY } from './public/draw-flow.mjs';

const modules = await loadModules(null, await readFile('public/guion_vm.wasm'));
const artifact = new Uint8Array(await readFile('public/verify.gub'));
const vm = makeVm(run, modules, artifact);
const operatorKey = (await readFile('fixtures/anchored-operator-key.hex', 'utf8')).trim();
const fixtureView = JSON.parse(await readFile('fixtures/view-complete.json', 'utf8'));

const memoryStore = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
const bytes = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256);

// Replays `script` in order: a function is called, a response is returned, an Error is thrown.
function scripted(script) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const next = script.shift();
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(url, init) : next;
  };
  return { fetch, calls };
}

const choice = { tradition: 'tarot', method: 'rws', options: { count: '3', reversals: 'true' }, question: 'Will it rain?' };

// The fixture's promise is for the fixture's entry, never for a request made here, so a draw that
// passes the binding is simulated by letting check_view say "" (its real behaviour is covered by the
// fixture tests below and by the native tests).
const trusting = (real = vm) => (entry, args) => (entry === 'check_view' ? '' : real(entry, args));

const fixturePending = () => ({
  id: fixtureView.id, index: fixtureView.index, tradition: 'iching', method: 'coins',
  request_json: JSON.stringify(fixtureView.receipt.request), entry_hash: fixtureView.entry_hash,
  question: '', salt_hex: '11'.repeat(32), startedAt: 0,
});

function pollDraw_deps(script, extra = {}) { return pollDeps(script, extra); }

function pollDeps(script, extra = {}) {
  const { fetch, calls } = scripted(script);
  let clock = 0;
  const sleeps = [];
  return {
    calls, sleeps,
    deps: { vm, fetch, store: memoryStore(), operatorKey, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; }, ...extra },
  };
}

test('startDraw never sends the question', async () => {
  const { fetch, calls } = scripted([reply(200, fixtureView)]);
  await startDraw(choice, { vm: trusting(), fetch, random: bytes, store: memoryStore(), operatorKey });
  const sent = calls[0].init;
  assert.equal(calls[0].url, '/v1/draws');
  assert.equal(sent.method, 'POST');
  assert.equal(sent.headers['content-type'], 'application/json');
  const body = JSON.parse(sent.body);
  assert.equal('question' in body, false);
  assert.ok(body.commitment);
  assert.equal(body.nonce.length, 64, 'the service wants a 32-byte nonce');
  assert.equal(sent.body.includes('Will it rain?'), false);
});

test('a 429 is rate-limited and leaves no pending record', async () => {
  const store = memoryStore();
  const { fetch } = scripted([reply(429, { error: { code: 'E_RATE', message: 'slow down' } })]);
  const out = await startDraw(choice, { vm, fetch, random: bytes, store, operatorKey });
  assert.deepEqual(out, { kind: 'rate-limited', message: MESSAGES['rate-limited'] });
  assert.equal(store.getItem(PENDING_KEY), null);
});

test("a reply whose promise doesn't verify is untrusted", async () => {
  const bad = { ...fixtureView, promise: fixtureView.promise.replace('lotcast.example', 'lotcast.exampla') };
  const store = memoryStore();
  const { fetch } = scripted([reply(200, bad)]);
  const out = await startDraw(choice, { vm, fetch, random: bytes, store, operatorKey });
  assert.equal(out.kind, 'untrusted');
  assert.match(out.message, /^Do not trust this draw: /);
  assert.equal(store.getItem(PENDING_KEY), null);
});

test('a refused request and an unreachable service are told apart', async () => {
  const refused = await startDraw(choice, { vm, fetch: scripted([reply(400, { error: { message: 'no such method' } })]).fetch, random: bytes, store: memoryStore(), operatorKey });
  assert.deepEqual(refused, { kind: 'refused', message: 'Lotcast turned this request down: no such method' });
  const down = await startDraw(choice, { vm, fetch: scripted([new Error('offline')]).fetch, random: bytes, store: memoryStore(), operatorKey });
  assert.deepEqual(down, { kind: 'unreachable', message: MESSAGES.unreachable });
});

test('pending is saved before polling and resumePending returns it', async () => {
  const store = memoryStore();
  const { fetch } = scripted([reply(200, fixtureView)]);
  const pending = await startDraw(choice, { vm: trusting(), fetch, random: bytes, store, operatorKey, now: () => 1234 });
  assert.equal(pending.question, 'Will it rain?');
  assert.equal(pending.startedAt, 1234);
  assert.equal(pending.salt_hex.length, 64);
  assert.equal(pending.id, pending.entry_hash.slice(0, 32));
  assert.deepEqual(resumePending(store), pending);
  assert.equal(resumePending(memoryStore()), null);
});

test('polling reports progress then verifies', async () => {
  const pendingView = (waiting) => ({ ...fixtureView, status: 'pending', waiting_on: waiting, receipt: undefined, poll_after_ms: 2000 });
  const { deps, sleeps } = pollDeps([
    reply(200, { id: fixtureView.id, status: 'pending', waiting_on: [{ source: 'log' }], poll_after_ms: 500 }),
    reply(200, pendingView([{ source: 'anchor' }])),
    reply(200, pendingView([{ source: 'curby-rng' }, { source: 'nist-beacon-2' }])),
    reply(200, fixtureView),
  ]);
  deps.store.setItem(PENDING_KEY, 'x');
  const seen = [];
  const out = await pollDraw(fixturePending(), deps, (p) => seen.push(p));
  assert.deepEqual(seen.map((p) => [p.logged, p.stamped, p.sourcesIn, p.done]), [
    [false, false, 3, false], [true, false, 3, false], [true, true, 1, false], [true, true, 3, true],
  ]);
  assert.equal(out.verdict.verdict, 'verified');
  assert.equal(out.outcome.hexagram, 35);
  assert.equal(deps.store.getItem(PENDING_KEY), null);
  assert.deepEqual(sleeps, [500, 2000, 2000]);
});

test('anchor-failed clears pending and shows no outcome', async () => {
  const { deps } = pollDeps([reply(200, { ...fixtureView, status: 'anchor-failed', waiting_on: [], receipt: undefined })]);
  deps.store.setItem(PENDING_KEY, 'x');
  const out = await pollDraw(fixturePending(), deps);
  assert.deepEqual(out, { kind: 'anchor-failed', message: MESSAGES['anchor-failed'] });
  assert.equal('outcome' in out, false);
  assert.equal(deps.store.getItem(PENDING_KEY), null);
});

test('a dropped poll retries with backoff', async () => {
  const { deps, sleeps } = pollDeps([new Error('dropped'), reply(503, {}), new Error('dropped'), reply(200, fixtureView)]);
  const out = await pollDraw(fixturePending(), deps);
  assert.equal(out.verdict.verdict, 'verified');
  assert.deepEqual(sleeps, [2000, 4000, 8000]);
});

test('after ten minutes the visitor is told it is still waiting, polling goes on slowly, and a later result is still picked up', async () => {
  const waiting = () => reply(200, { ...fixtureView, status: 'pending', waiting_on: [{ source: 'curby-rng' }], receipt: undefined, poll_after_ms: 2000 });
  const script = [...Array.from({ length: 400 }, waiting), reply(200, fixtureView)];
  const { fetch, calls } = scripted(script);
  let clock = 0;
  const sleeps = [];
  const store = memoryStore();
  store.setItem(PENDING_KEY, 'x');
  const told = [];
  const out = await pollDraw(fixturePending(), { vm, fetch, store, operatorKey, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } }, () => {}, (message) => told.push([message, clock]));
  assert.equal(out.verdict.verdict, 'verified');
  assert.equal(told.length, 1, 'told once');
  assert.equal(told[0][0], MESSAGES['still-waiting']);
  assert.ok(told[0][1] >= 10 * 60 * 1000);
  assert.equal(sleeps.at(-1), 30000, 'slow polling after the message');
  assert.ok(calls.length > 300);
  assert.equal(store.getItem(PENDING_KEY), null);
});

test('a queued 202 reply is not distrusted: pending is saved without an index and polling binds the draw', async () => {
  const store = memoryStore();
  const queuedView = (id) => ({ id, status: 'pending', waiting_on: [{ source: 'log' }], poll_after_ms: 500 });
  const { fetch } = scripted([(url, init) => reply(202, queuedView('x'))]);
  const pending = await startDraw(choice, { vm, fetch, random: bytes, store, operatorKey, now: () => 5 });
  assert.equal(pending.kind, undefined, JSON.stringify(pending));
  assert.equal(pending.index, null);
  assert.deepEqual(resumePending(store), pending);
  // Polling: still queued, then the complete view for the same entry.
  const view = { ...fixtureView };
  const p = { ...pending, id: view.id, request_json: JSON.stringify(view.receipt.request), entry_hash: view.entry_hash, question: '' };
  const { deps } = pollDraw_deps([reply(200, queuedView(view.id)), reply(200, view)]);
  const out = await pollDraw(p, deps);
  assert.equal(out.verdict.verdict, 'verified');
});

test('a registry that cannot be loaded does not lose a finished draw: pending is kept', async () => {
  const { deps } = pollDraw_deps([reply(200, fixtureView)], { prepare: async () => { throw new Error('registry returned 502'); } });
  deps.store.setItem(PENDING_KEY, 'x');
  const out = await pollDraw(fixturePending(), deps);
  assert.deepEqual(out, { kind: 'unreachable', message: MESSAGES.unreachable });
  assert.equal(deps.store.getItem(PENDING_KEY), 'x');
});

test('loadRegistry checks the status instead of parsing an error page', async () => {
  await assert.rejects(loadRegistry(async () => reply(502, { error: 'bad gateway' })), /502/);
  const ok = await loadRegistry(async () => reply(200, { iching: { hexagrams: [] } }));
  assert.deepEqual(ok, { iching: { hexagrams: [] } });
});

test('a changed receipt in a complete view is untrusted', async () => {
  const bad = structuredClone(fixtureView);
  bad.receipt.request.method = 'yarrow';
  const { deps } = pollDeps([reply(200, bad)]);
  const out = await pollDraw(fixturePending(), deps);
  assert.equal(out.kind, 'untrusted');
});

test('progress reads waiting_on', () => {
  assert.deepEqual(progress({ status: 'pending', waiting_on: [] }), { logged: true, stamped: true, sourcesIn: 3, sourcesTotal: 3, done: false });
  assert.equal(progress({ status: 'complete', waiting_on: [] }).done, true);
});

test('a draw picked up again after a long absence is looked at once, and may be done', async () => {
  const { deps } = pollDeps([reply(200, fixtureView)], { now: () => 3 * 60 * 60 * 1000 });
  const out = await pollDraw(fixturePending(), deps);
  assert.equal(out.verdict.verdict, 'verified');
});

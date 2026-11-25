// Wiring only: the form to startDraw/pollDraw, progress to the time ribbon, a result to the
// hexagram or the cards, the Save buttons, resume on load, and the check-a-receipt box.
// Everything that needs trust runs in Guion (verify.gub); see draw-flow.mjs.
import { loadModules, run } from './loader.mjs';
import { makeVm, startDraw, pollDraw, resumePending, loadRegistry, STEPS } from './draw-flow.mjs';
import { hexagram, cards, cardFace } from './names.mjs';

const $ = (id) => document.getElementById(id);
const MAX_TEXT = 65536;

const HEADLINES = {
  verified: ['verified', 'Verified.'],
  'verified-pending-live': ['pending', 'Not fully checked yet: one live check is still owed.'],
  'verified-unanchored': ['pending', 'Partly verified: the result follows from a real random number, but nothing shows the request came first.'],
  invalid: ['invalid', 'This receipt does not check out.'],
  unreadable: ['unreadable', 'This could not be read.'],
};

// ---------------------------------------------------------------- what the page needs to start
const fetchBytes = async (name) => {
  const r = await fetch(new URL(name, import.meta.url));
  if (!r.ok) throw new Error(`${name} returned ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
};

let ready = null;
function start() {
  ready ??= Promise.all([fetchBytes('guion_vm.wasm'), fetchBytes('verify.gub')])
    .then(async ([vmBytes, artifact]) => {
      const modules = await loadModules(null, vmBytes);
      return { modules, artifact, vm: makeVm(run, modules, artifact) };
    })
    .catch((e) => { ready = null; throw e; });
  return ready;
}

let operatorKey = '';
const keyReady = fetch(new URL('operator-key.txt', import.meta.url))
  .then((r) => (r.ok ? r.text() : ''))
  .then((t) => { const k = t.trim(); if (/^[0-9a-f]{64}$/.test(k)) operatorKey = k; })
  .catch(() => {});

// Loaded before a finished draw's pending record is cleared (see `prepare` below), so a failed load
// cannot lose a draw that is already checked.
let registry = null;
async function ensureRegistry() {
  registry ??= await loadRegistry((...a) => fetch(...a));
  return registry;
}

const memory = new Map();
const store = (() => {
  try {
    const probe = '__lotcast_probe';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) };
  }
})();

// ---------------------------------------------------------------- small DOM helpers
const SVG = 'http://www.w3.org/2000/svg';
function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...kids);
  return node;
}
function svg(attrs, ...paths) {
  const s = document.createElementNS(SVG, 'svg');
  for (const [k, v] of Object.entries({ fill: 'none', stroke: '#16142e', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'aria-hidden': 'true', ...attrs })) s.setAttribute(k, v);
  for (const d of paths) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    s.append(p);
  }
  return s;
}
const download = (name, text) => {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// ---------------------------------------------------------------- which part of the page is showing
function setState(state) {
  document.body.dataset.state = state;
  $('draw').hidden = state !== 'draw';
  $('waiting').hidden = state !== 'waiting';
  $('result').hidden = state !== 'result';
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------- the choice
let methods = { iching: 'coins', tarot: 'rws' };
const tradition = () => document.querySelector('input[name=tradition]:checked').value;

async function loadTraditions() {
  try {
    const list = (await (await fetch('/v1/traditions')).json()).methods ?? [];
    for (const t of ['iching', 'tarot']) {
      const ready = list.find((m) => m.tradition === t && m.status === 'ready');
      if (ready) methods[t] = ready.method;
      else $(`t-${t}`).disabled = true;
      if (t === 'tarot' && ready) {
        $('count-field').hidden = !ready.options.includes('count');
        $('reversals-field').hidden = !ready.options.includes('reversals');
      }
    }
    if ($('t-tarot').disabled && !$('t-iching').disabled) $('t-iching').checked = true;
  } catch { /* the defaults stand */ }
}

function choice() {
  const t = tradition();
  const options = {};
  if (t === 'tarot') {
    if (!$('count-field').hidden) options.count = $('count').value;
    if (!$('reversals-field').hidden && $('reversals').checked) options.reversals = 'true';
  }
  return { tradition: t, method: methods[t], options, question: $(t === 'iching' ? 'q-iching' : 'q-tarot').value };
}

// ---------------------------------------------------------------- waiting
let clockTimer = null;
function startClock(since) {
  clearInterval(clockTimer);
  const tick = () => {
    const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
    $('clock').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  tick();
  clockTimer = setInterval(tick, 1000);
}

function showProgress(p, pending) {
  const mark = (id, done, now) => { const li = $(id); li.toggleAttribute('data-done', done); li.toggleAttribute('data-now', now); };
  mark('step-log', p.logged, !p.logged);
  mark('step-stamp', p.stamped, p.logged && !p.stamped);
  mark('step-chance', p.done || (p.stamped && p.sourcesIn === 3), p.stamped && !p.done);
  mark('step-done', p.done, false);
  $('step-log').querySelector('p').textContent = p.logged && pending.index != null ? `Draw no. ${pending.index} in the public log` : 'In the public log';
  $('step-stamp').querySelector('p').textContent = p.stamped ? 'By outside services' : 'Waiting for outside services';
  $('step-chance').querySelector('p').textContent = p.stamped ? `${p.sourcesIn} of ${p.sourcesTotal} random sources in` : 'Random sources';
}

function showWaiting(pending) {
  $('wait-note').textContent = '';
  setState('waiting');
  startClock(pending.startedAt);
  showProgress({ logged: pending.index != null, stamped: false, sourcesIn: 0, sourcesTotal: 3, done: false }, pending);
}

// ---------------------------------------------------------------- the result
let lastDraw = null; // what Save needs: kept in memory only

const GLYPHS = {
  swords: 'M12 2l3 6v24h-6V8z M5 32h14 M12 32v12',
  wands: 'M12 2v42 M12 10c-5-2-6-6-6-8 5 0 6 4 6 8z M12 20c5-2 6-6 6-8-5 0-6 4-6 8z M12 30c-5-2-6-6-6-8 5 0 6 4 6 8z',
  cups: 'M5 6h14c0 8-3 14-7 14S5 14 5 6z M12 20v18 M6 40h12',
  pentacles: 'M12 14l2.5 6h6l-5 4 2 6-5.5-4-5.5 4 2-6-5-4h6z M12 3a10 10 0 100 20 10 10 0 100-20z',
};

function cardArt(id, number) {
  const [, , kind, n] = id.split(':');
  if (kind === 'major') return svg({ width: 96, height: 96, viewBox: '0 0 48 48' }, 'M24 4a20 20 0 100 40 20 20 0 100-40z', 'M24 10l4 11h12l-9 7 3 11-10-7-10 7 3-11-9-7h12z');
  const count = Number(n);
  if (count > 10) return svg({ width: 56, height: 100, viewBox: '0 0 24 46' }, GLYPHS[kind]);
  const wrap = el('div', { class: 'pips' });
  const w = count <= 4 ? 30 : 20;
  for (let i = 0; i < count; i++) wrap.append(svg({ width: w, height: Math.round(w * 1.9), viewBox: '0 0 24 46' }, GLYPHS[kind]));
  return wrap;
}

function renderCards(outcome) {
  const list = cards(outcome);
  const box = $('cards');
  box.replaceChildren();
  list.forEach((c, i) => {
    const li = $('card-template').content.firstElementChild.cloneNode(true);
    const face = cardFace(c.id);
    const faceBox = li.querySelector('.face');
    faceBox.setAttribute('aria-label', `${c.name}, ${c.reversed ? 'reversed' : 'upright'}`);
    if (c.reversed) faceBox.setAttribute('data-reversed', '');
    li.querySelector('.num').textContent = face.numeral ?? '';
    li.querySelector('.art').replaceChildren(cardArt(c.id));
    li.querySelector('.nm').textContent = c.name;
    li.querySelector('.pos').textContent = String(c.position);
    li.querySelector('.nm2').textContent = c.name;
    const way = li.querySelector('.way');
    way.textContent = c.reversed ? 'Reversed' : 'Upright';
    if (c.reversed) way.setAttribute('data-reversed', '');
    li.style.animationDelay = `${0.2 + i * 0.5}s`;
    box.append(li);
  });
  const n = list.length;
  $('tarot-eyebrow').textContent = `Your tarot draw · ${n} ${n === 1 ? 'card' : 'cards'}`;
  return list;
}

function miniLines(target, lines) {
  target.replaceChildren(...lines.map((yang) => el('div', { class: `line ${yang ? 'yang' : 'yin'}` }, el('span'), el('span'))));
}

function renderHexagram(outcome, reg) {
  const h = hexagram(outcome, reg);
  const lines = $('hex-lines');
  lines.replaceChildren(...h.lines.map((l, i) => {
    const row = el('div', { class: `line ${l.yang ? 'yang' : 'yin'}${l.changing ? ' changing' : ''}` }, el('span'), el('span'));
    row.querySelectorAll('span').forEach((s) => { s.style.animationDelay = `${i * 0.5}s`; });
    return row;
  }));
  const words = h.lines.map((l) => `${l.yang ? 'yang' : 'yin'}${l.changing ? ' changing' : ''}`).join(', ');
  $('hexagram').setAttribute('aria-label', `Hexagram ${h.number}, ${h.name}. From the bottom: ${words}.`);
  $('hex-chg').hidden = h.changing.length === 0;
  $('hex-eyebrow').textContent = `Your hexagram · No. ${h.number}`;
  $('hex-name').textContent = h.name;
  const bridge = $('bridge');
  bridge.hidden = h.relating === null;
  if (h.relating) {
    const which = h.changing.length === 1 ? `Line ${h.changing[0]} is changing.` : `Lines ${h.changing.join(' and ')} are changing.`;
    $('bridge-text').textContent = `${which} Changed, it becomes`;
    const target = reg.iching.hexagrams.find((x) => x.number === h.relating.number);
    const yang = (target?.lines ?? []).map((n) => n === 1);
    miniLines($('mini'), yang);
    $('mini').setAttribute('aria-label', `Hexagram ${h.relating.number}, ${h.relating.name}. From the bottom: ${yang.map((y) => (y ? 'yang' : 'yin')).join(', ')}.`);
    const name = $('to-name');
    name.replaceChildren(el('small', { text: `No. ${h.relating.number}` }), document.createTextNode(h.relating.name));
  }
  return h;
}

function showSeal(verdict, what) {
  const [state, headline] = HEADLINES[verdict.verdict] ?? ['unreadable', 'Unexpected answer.'];
  const row = $('seal-row');
  row.dataset.state = state;
  if (verdict.verdict === 'verified') {
    $('verdict-head').textContent = what === 'cards' ? "Verified. These cards weren't re-drawn." : "Verified. This draw wasn't re-rolled.";
    $('verdict-detail').textContent = `Checked in your browser: your request was logged first, and ${what === 'cards' ? 'these cards follow' : 'these lines follow'} from public random numbers.`;
  } else {
    $('verdict-head').textContent = headline;
    $('verdict-detail').textContent = verdict.detail;
  }
}

async function showResult(done, pending) {
  const reg = await ensureRegistry();
  const isTarot = Array.isArray(done.outcome.cards);
  $('result-iching').hidden = isTarot;
  $('result-tarot').hidden = !isTarot;
  const index = done.receipt.log?.index ?? pending.index;
  let facts;
  if (isTarot) {
    const list = renderCards(done.outcome);
    facts = `Draw no. ${index} in the public log · ${list.map((c) => `${c.id.replace('tarot:rws:', '')}${c.reversed ? ' reversed' : ''}`).join(', ')}`;
  } else {
    renderHexagram(done.outcome, reg);
    facts = `Draw no. ${index} in the public log · lines ${done.outcome.lines.join(' ')}, bottom up`;
  }
  showSeal(done.verdict, isTarot ? 'cards' : 'lines');
  $('receipt-facts').textContent = facts;
  $('save-question').hidden = pending.question === '';
  lastDraw = { receipt: done.receipt, index, question: pending.question, salt: pending.salt_hex };
  setState('result');
}

$('save-receipt').addEventListener('click', () => {
  if (lastDraw) download(`lotcast-draw-${lastDraw.index}.json`, `${JSON.stringify(lastDraw.receipt, null, 2)}\n`);
});
$('save-question').addEventListener('click', () => {
  if (lastDraw && lastDraw.question !== '') {
    download(`lotcast-question-${lastDraw.index}.json`, `${JSON.stringify({ draw: lastDraw.index, question: lastDraw.question, salt: lastDraw.salt }, null, 2)}\n`);
  }
});
$('draw-again').addEventListener('click', () => { $('draw-note').textContent = ''; setState('draw'); });

// ---------------------------------------------------------------- drawing
async function deps() {
  const { vm } = await start();
  await keyReady;
  return { vm, fetch: (...a) => fetch(...a), random: (n) => crypto.getRandomValues(new Uint8Array(n)), store, operatorKey, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now(), prepare: ensureRegistry };
}

async function follow(pending) {
  showWaiting(pending);
  const d = await deps();
  const out = await pollDraw(pending, d, (p) => showProgress(p, pending), (message) => { $('wait-note').textContent = message; });
  if (out.kind === 'unreachable') {
    // The draw is done but a file the page needs to show it did not load: the pending record is
    // still there, so try again shortly.
    $('wait-note').textContent = out.message;
    setTimeout(() => follow(pending).catch(() => {}), 10000);
    return;
  }
  clearInterval(clockTimer);
  if (out.kind) {
    $('draw-note').textContent = out.message;
    setState('draw');
    return;
  }
  if (out.verdict.verdict === 'invalid' || out.verdict.verdict === 'unreadable') {
    $('draw-note').textContent = `Do not trust this draw: ${out.verdict.detail}`;
    setState('draw');
    return;
  }
  await showResult(out, pending);
}

$('draw-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('draw-btn');
  $('draw-note').textContent = '';
  button.disabled = true;
  button.textContent = 'Sealing…';
  try {
    if (operatorKey === '') await keyReady;
    if (operatorKey === '') {
      $('draw-note').textContent = "This page has no operator key to check draws against, so it can't make one. Paste the key from the Lotcast README under Check a receipt, then try again.";
      return;
    }
    const d = await deps();
    const result = await startDraw(choice(), d);
    if (result.kind) {
      $('draw-note').textContent = result.message;
      return;
    }
    await follow(result);
  } catch (error) {
    $('draw-note').textContent = `The page could not start the draw. (${error.message ?? error})`;
  } finally {
    button.disabled = false;
    button.textContent = 'Draw';
  }
});

// ---------------------------------------------------------------- check a receipt
function showCheck(state, headline, detail, owed) {
  const box = $('check-result');
  box.hidden = false;
  box.dataset.state = state;
  $('check-headline').textContent = headline;
  $('check-detail').textContent = detail;
  $('check-owed').hidden = !owed;
  $('check-owed').replaceChildren();
  if (owed) $('check-owed').append(el('p', { text: 'To finish the check, run this on your computer (Guion 0.9 or later):' }), el('pre', { text: owed }));
}

async function check() {
  const receipt = $('receipt').value.trim();
  const key = $('key').value.trim();
  if (receipt.length > MAX_TEXT) {
    showCheck('unreadable', 'This could not be read.', `The receipt is ${receipt.length.toLocaleString('en-US')} characters; this page takes at most ${MAX_TEXT.toLocaleString('en-US')}. Use lotcast verify on your computer instead.`);
    return;
  }
  $('check-btn').disabled = true;
  $('check-result').hidden = false;
  $('check-headline').textContent = 'Checking…';
  try {
    const { modules, artifact } = await start();
    const out = run(modules, artifact, { steps: STEPS, allowRaisedSteps: true }, { entry: 'verify_page', arguments: [receipt, key] });
    if (!out.ok) {
      showCheck('unreadable', 'The checker stopped.', `${out.code}: ${out.message}`);
      return;
    }
    const answer = JSON.parse(out.value);
    const [state, headline] = HEADLINES[answer.verdict] ?? ['unreadable', 'Unexpected answer.'];
    const owed = answer.verdict === 'verified-pending-live' ? `lotcast verify RECEIPT.json --operator-key ${key} --live` : '';
    showCheck(state, headline, answer.detail, owed);
  } catch (error) {
    showCheck('unreadable', 'The checker did not load.', `Check your connection and try again. (${error.message ?? error})`);
  } finally {
    syncCheck();
  }
}

function syncCheck() { $('check-btn').disabled = $('receipt').value.trim() === '' || $('key').value.trim() === ''; }
$('check-btn').addEventListener('click', check);
$('receipt').addEventListener('input', syncCheck);
$('key').addEventListener('input', syncCheck);
$('receipt').addEventListener('dragover', (e) => e.preventDefault());
$('receipt').addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) { $('receipt').value = await file.text(); syncCheck(); }
});

keyReady.then(() => {
  if (operatorKey) {
    $('key').value = operatorKey;
    $('key-note').textContent = 'Filled in from the key this service published. For an independent check, compare it with the key in the Lotcast README before you trust the result.';
  } else {
    $('key-note').textContent = 'Paste the key from the Lotcast README.';
  }
  syncCheck();
});

// ---------------------------------------------------------------- on load
loadTraditions();
start().catch(() => {});
const resumed = resumePending(store);
if (resumed) {
  const t = $(`t-${resumed.tradition}`);
  if (t) t.checked = true;
  follow(resumed).catch((error) => {
    $('draw-note').textContent = `The page could not pick the draw back up. (${error.message ?? error})`;
    setState('draw');
  });
} else {
  setState('draw');
}

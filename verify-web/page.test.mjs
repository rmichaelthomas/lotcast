// Checks of the page's markup and CSS as text: node --test page.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile('public/index.html', 'utf8');
const allhere = JSON.parse(await readFile('allhere.json', 'utf8'));
const spec = await readFile('../docs/superpowers/specs/2026-11-25-draw-page-design.md', 'utf8');
const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';

const used = [...html.matchAll(/<(\w+)\b[^>]*\bdata-ahi="([^"]+)"/g)].map((m) => ({ tag: m[1].toLowerCase(), id: m[2] }));

test('every data-ahi value is in allhere.json, on the element its contract names', () => {
  assert.ok(used.length > 0);
  for (const { tag, id } of used) {
    const entry = allhere.instruments[id];
    assert.ok(entry, `${id} is not in allhere.json`);
    assert.equal(tag, entry.element, `${id} must be a <${entry.element}>, not <${tag}>`);
  }
});

test("the page uses every id in the spec's AllHereHTML table", () => {
  const table = spec.slice(spec.indexOf('AllHereHTML pieces used'), spec.indexOf('Tarot card names'));
  const wanted = new Set([...table.matchAll(/`(ahi\.[a-z-]+\.[a-z-]+)`/g)].map((m) => m[1]));
  assert.ok(wanted.size >= 14, `${wanted.size} ids in the spec table`);
  for (const id of wanted) assert.ok(used.some((u) => u.id === id), `${id} is not on the page`);
});

test('allhere.json names the AllHere commit it was copied from', () => {
  assert.match(allhere.commit, /^[0-9a-f]{40}$/);
});

test('nothing points to another origin; fonts are local', () => {
  assert.doesNotMatch(html, /\b(?:src|href|action)="(?:https?:)?\/\//i);
  assert.doesNotMatch(css, /url\(\s*['"]?(?:https?:)?\/\//i);
  assert.doesNotMatch(html, /@import|fonts\.googleapis|<link[^>]+rel="preconnect"/i);
  assert.match(css, /url\(['"]?\/?fonts\/Geist-Variable\.woff2/);
  assert.match(css, /url\(['"]?\/?fonts\/GeistMono-Variable\.woff2/);
});

test('every state is in the page, and the stages are named', () => {
  for (const id of ['draw', 'waiting', 'result', 'result-iching', 'result-tarot', 'fair', 'check']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
});

test('all motion stops under prefers-reduced-motion', () => {
  const block = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?\})\s*\}/)?.[1] ?? '';
  assert.match(block, /animation:\s*none/);
});

function rules(source) {
  return [...source.matchAll(/([^{}@][^{}]*)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
}

test('the seal never covers anything: it is in normal flow, after the result, in its own row', () => {
  const sealRules = rules(css).filter((r) => /\.seal\b/.test(r.selector));
  assert.ok(sealRules.length > 0);
  for (const r of sealRules) assert.doesNotMatch(r.body, /position:\s*(absolute|fixed)/, r.selector);
  const resultAt = html.indexOf('id="result"');
  const sealAt = html.indexOf('class="seal"');
  assert.ok(sealAt > resultAt, 'the seal is inside the result section');
  // The seal must sit after, not within, the hexagram figure and the card list.
  const figure = html.slice(html.indexOf('id="result-iching"'), html.indexOf('id="result-tarot"'));
  const cardList = html.slice(html.indexOf('id="result-tarot"'), sealAt);
  assert.doesNotMatch(figure, /class="seal"/);
  assert.ok(!/class="seal"/.test(cardList), 'the seal is not inside the tarot block');
  assert.ok(sealAt > html.indexOf('id="result-tarot"'));
});

test('seal red is only for the seal and the Draw button', () => {
  const holders = rules(css).filter((r) => /#c8361f|var\(--seal\)/i.test(r.body) && !/^:root$/.test(r.selector));
  assert.ok(holders.length >= 2);
  for (const r of holders) assert.match(r.selector, /\.seal|\.draw-btn/, `seal red used by ${r.selector}`);
  assert.doesNotMatch(html.replace(/<style>[\s\S]*?<\/style>/, ''), /#c8361f/i, 'no inline seal red');
});

test('the question field says it never leaves the device', () => {
  assert.match(html, /never leaves this device/);
});

test('the page says no more than names', () => {
  assert.doesNotMatch(html.replaceAll('It never tells you what it means', ''), /means|meaning|interpretation/i);
});

test('the page keeps the wording of the checker headlines', async () => {
  const script = await readFile('public/page.mjs', 'utf8');
  assert.match(script, /'verified-pending-live': \['pending', 'Not fully checked yet/);
  assert.match(script, /'verified-unanchored': \['pending', 'Partly verified/);
});

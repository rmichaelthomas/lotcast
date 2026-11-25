// node --test names.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { TAROT_NAMES, cardFace, hexagram, cards } from './public/names.mjs';

const registry = JSON.parse(await readFile('../registry/lotcast-registry-v1.json', 'utf8'));

test('every tarot id in the registry has a name, and there are exactly 78', () => {
  const ids = registry.tarot.rws.map((c) => c.id);
  assert.equal(ids.length, 78);
  for (const id of ids) assert.ok(TAROT_NAMES[id], `no name for ${id}`);
  assert.equal(Object.keys(TAROT_NAMES).length, 78);
});

test('well-known names', () => {
  assert.equal(TAROT_NAMES['tarot:rws:major:15'], 'The Devil');
  assert.equal(TAROT_NAMES['tarot:rws:major:20'], 'Judgement');
  assert.equal(TAROT_NAMES['tarot:rws:swords:4'], 'Four of Swords');
  assert.equal(TAROT_NAMES['tarot:rws:cups:11'], 'Page of Cups');
  assert.equal(TAROT_NAMES['tarot:rws:pentacles:14'], 'King of Pentacles');
  assert.equal(TAROT_NAMES['tarot:rws:major:0'], 'The Fool');
  assert.equal(TAROT_NAMES['tarot:rws:wands:1'], 'Ace of Wands');
});

test('cardFace gives a numeral for majors and 1 to 10, none for courts', () => {
  assert.deepEqual(cardFace('tarot:rws:major:0'), { name: 'The Fool', numeral: '0', suit: null });
  assert.deepEqual(cardFace('tarot:rws:major:15'), { name: 'The Devil', numeral: 'XV', suit: null });
  assert.deepEqual(cardFace('tarot:rws:swords:4'), { name: 'Four of Swords', numeral: '4', suit: 'swords' });
  assert.deepEqual(cardFace('tarot:rws:cups:12'), { name: 'Knight of Cups', numeral: null, suit: 'cups' });
});

test('a hexagram with a changing line, and what it changes to', () => {
  const h = hexagram({ hexagram: 58, lines: [7, 7, 8, 7, 9, 8], changing: [5], relating: 54 }, registry);
  assert.equal(h.number, 58);
  assert.equal(h.name, 'Dui');
  assert.deepEqual(h.relating, { number: 54, name: 'Gui Mei' });
  assert.deepEqual(h.lines[4], { yang: true, changing: true });
  assert.equal(h.lines[5].yang, false);
  assert.deepEqual(h.changing, [5]);
  assert.equal(hexagram({ hexagram: 1, lines: [7, 7, 7, 7, 7, 7], changing: [], relating: null }, registry).relating, null);
});

test('cards keep their order and say which are reversed', () => {
  const list = cards({ cards: [{ id: 'tarot:rws:major:15', reversed: true }, { id: 'tarot:rws:swords:4', reversed: false }] });
  assert.deepEqual(list.map((c) => [c.position, c.name, c.reversed]), [[1, 'The Devil', true], [2, 'Four of Swords', false]]);
});

test('the page says no more than names: no meanings, no interpretation', async () => {
  for (const f of ['index.html', 'page.mjs', 'names.mjs', 'draw-flow.mjs']) {
    let text;
    try { text = await readFile(`public/${f}`, 'utf8'); } catch { continue; }
    const stripped = text.replaceAll('It never tells you what it means', '');
    assert.doesNotMatch(stripped, /means|meaning|interpretation/i, f);
  }
});

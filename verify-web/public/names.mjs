// Names and shapes for showing a draw. Names only.

const MAJORS = ['The Fool', 'The Magician', 'The High Priestess', 'The Empress', 'The Emperor', 'The Hierophant',
  'The Lovers', 'The Chariot', 'Strength', 'The Hermit', 'Wheel of Fortune', 'Justice', 'The Hanged Man', 'Death',
  'Temperance', 'The Devil', 'The Tower', 'The Star', 'The Moon', 'The Sun', 'Judgement', 'The World'];
const RANKS = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Page', 'Knight', 'Queen', 'King'];
const SUITS = ['wands', 'cups', 'swords', 'pentacles'];
const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];
const capital = (s) => s[0].toUpperCase() + s.slice(1);

export const TAROT_NAMES = {};
MAJORS.forEach((name, n) => { TAROT_NAMES[`tarot:rws:major:${n}`] = name; });
for (const suit of SUITS) RANKS.forEach((rank, i) => { TAROT_NAMES[`tarot:rws:${suit}:${i + 1}`] = `${rank} of ${capital(suit)}`; });

export function cardFace(id) {
  const [, , kind, n] = id.split(':');
  const number = Number(n);
  const name = TAROT_NAMES[id] ?? id;
  if (kind === 'major') return { name, numeral: ROMAN[number] ?? null, suit: null };
  return { name, numeral: number <= 10 ? String(number) : null, suit: kind };
}

const names = (registry) => new Map(registry.iching.hexagrams.map((h) => [h.number, h.name]));

// lines are bottom first: 6 and 8 are yin, 7 and 9 are yang, 6 and 9 are changing.
export function hexagram(outcome, registry) {
  const byNumber = names(registry);
  const relating = outcome.relating == null ? null : { number: outcome.relating, name: byNumber.get(outcome.relating) ?? '' };
  return {
    number: outcome.hexagram,
    name: byNumber.get(outcome.hexagram) ?? '',
    lines: outcome.lines.map((n) => ({ yang: n === 7 || n === 9, changing: n === 6 || n === 9 })),
    changing: outcome.changing ?? [],
    relating,
  };
}

export function cards(outcome) {
  return outcome.cards.map((c, i) => ({ position: i + 1, id: c.id, name: TAROT_NAMES[c.id] ?? c.id, reversed: Boolean(c.reversed) }));
}

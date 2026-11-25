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
  if (kind === 'major') return { name, numeral: ROMAN[number] ?? null, suit: null, underline: false };
  // An upside-down 6 reads as a 9 (and the other way round), so both are underlined, as on dice.
  return { name, numeral: number <= 10 ? String(number) : null, suit: kind, underline: number === 6 || number === 9 };
}

// The words around a tarot draw: singular for one card, plural for several.
export function tarotWording(count) {
  if (count === 1) return { lead: 'Your card, ', emphasis: 'as it was drawn.', verified: "Verified. This card wasn't re-drawn.", follows: 'this card follows' };
  return { lead: 'In the order ', emphasis: 'they were drawn.', verified: "Verified. These cards weren't re-drawn.", follows: 'these cards follow' };
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

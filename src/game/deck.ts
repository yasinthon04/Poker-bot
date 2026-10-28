export type Suit = 's' | 'h' | 'd' | 'c'; // spades, hearts, diamonds, clubs
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14; // 11=J, 12=Q, 13=K, 14=A

export interface Card {
  suit: Suit;
  rank: Rank;
}

export const SUIT_NAMES: Record<Suit, { nameTh: string; symbol: string; color: string }> = {
  s: { nameTh: 'โพธิ์ดำ', symbol: '♠', color: '#1e293b' },
  h: { nameTh: 'โพธิ์แดง', symbol: '♥', color: '#ef4444' },
  d: { nameTh: 'ข้าวหลามตัด', symbol: '♦', color: '#3b82f6' },
  c: { nameTh: 'ดอกจิก', symbol: '♣', color: '#10b981' },
};

export const RANK_NAMES: Record<Rank, string> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
};

/**
 * Creates a standard 52-card deck.
 */
export function createDeck(): Card[] {
  const suits: Suit[] = ['s', 'h', 'd', 'c'];
  const ranks: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const deck: Card[] = [];

  for (const s of suits) {
    for (const r of ranks) {
      deck.push({ suit: s, rank: r });
    }
  }

  return deck;
}

/**
 * Shuffles a deck using Fisher-Yates shuffle algorithm.
 */
export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Converts a Card to compact string notation (e.g. "As", "10h", "7d", "2c").
 */
export function cardToString(card: Card): string {
  return `${RANK_NAMES[card.rank]}${card.suit}`;
}

/**
 * Formats a Card for readable Thai display (e.g. "A♠", "K♥").
 */
export function cardToDisplay(card: Card): string {
  return `${RANK_NAMES[card.rank]}${SUIT_NAMES[card.suit].symbol}`;
}

/**
 * Parses compact string notation back to a Card object (e.g. "Ah" -> { rank: 14, suit: 'h' }).
 */
export function parseCard(cardStr: string): Card | null {
  if (!cardStr || cardStr.length < 2) return null;
  const suitChar = cardStr.slice(-1).toLowerCase() as Suit;
  if (!['s', 'h', 'd', 'c'].includes(suitChar)) return null;

  const rankStr = cardStr.slice(0, -1).toUpperCase();
  let rank: Rank;
  if (rankStr === 'A') rank = 14;
  else if (rankStr === 'K') rank = 13;
  else if (rankStr === 'Q') rank = 12;
  else if (rankStr === 'J') rank = 11;
  else {
    const num = parseInt(rankStr, 10);
    if (isNaN(num) || num < 2 || num > 10) return null;
    rank = num as Rank;
  }

  return { suit: suitChar, rank };
}

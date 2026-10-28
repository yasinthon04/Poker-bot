import { Card, cardToDisplay } from './deck';

export enum HandRank {
  HIGH_CARD = 1,
  ONE_PAIR = 2,
  TWO_PAIR = 3,
  THREE_OF_A_KIND = 4,
  STRAIGHT = 5,
  FLUSH = 6,
  FULL_HOUSE = 7,
  FOUR_OF_A_KIND = 8,
  STRAIGHT_FLUSH = 9,
  ROYAL_FLUSH = 10,
}

export const HAND_RANK_NAMES_TH: Record<HandRank, string> = {
  [HandRank.HIGH_CARD]: 'ไฮการ์ด (High Card)',
  [HandRank.ONE_PAIR]: 'หนึ่งคู่ (One Pair)',
  [HandRank.TWO_PAIR]: 'สองคู่ (Two Pair)',
  [HandRank.THREE_OF_A_KIND]: 'ตอง (Three of a Kind)',
  [HandRank.STRAIGHT]: 'เรียง / สเตรท (Straight)',
  [HandRank.FLUSH]: 'สี / ฟลัช (Flush)',
  [HandRank.FULL_HOUSE]: 'ฟูลเฮาส์ (Full House)',
  [HandRank.FOUR_OF_A_KIND]: 'โฟร์การ์ด (Four of a Kind)',
  [HandRank.STRAIGHT_FLUSH]: 'สเตรทฟลัช (Straight Flush)',
  [HandRank.ROYAL_FLUSH]: 'รอยัลสเตรทฟลัช 👑 (Royal Flush)',
};

export interface EvaluatedHand {
  rank: HandRank;
  score: number;
  nameTh: string;
  bestFive: Card[];
  descriptionTh: string;
}

/**
 * Generates all subsets of size k from an array.
 */
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];
  const head = arr[0];
  const tail = arr.slice(1);
  const withHead = combinations(tail, k - 1).map(c => [head, ...c]);
  const withoutHead = combinations(tail, k);
  return [...withHead, ...withoutHead];
}

/**
 * Evaluates an exact 5-card poker hand and calculates a score for tie-breaking.
 */
function evaluateFiveCards(fiveCards: Card[]): { rank: HandRank; score: number; descriptionTh: string } {
  // Sort descending by rank
  const cards = [...fiveCards].sort((a, b) => b.rank - a.rank);

  const isFlush = cards.every(c => c.suit === cards[0].suit);

  // Check straight
  let isStraight = false;
  let straightHigh = 0;

  // Regular straight check
  if (
    cards[0].rank - 1 === cards[1].rank &&
    cards[1].rank - 1 === cards[2].rank &&
    cards[2].rank - 1 === cards[3].rank &&
    cards[3].rank - 1 === cards[4].rank
  ) {
    isStraight = true;
    straightHigh = cards[0].rank;
  } else if (
    // Wheel straight: A-2-3-4-5 (Aces count as 1)
    cards[0].rank === 14 &&
    cards[1].rank === 5 &&
    cards[2].rank === 4 &&
    cards[3].rank === 3 &&
    cards[4].rank === 2
  ) {
    isStraight = true;
    straightHigh = 5; // Top rank of A-2-3-4-5 is 5
  }

  // Count rank frequencies
  const counts: Record<number, number> = {};
  for (const c of cards) {
    counts[c.rank] = (counts[c.rank] || 0) + 1;
  }

  const freqEntries = Object.entries(counts)
    .map(([rankStr, count]) => ({ rank: parseInt(rankStr, 10), count }))
    .sort((a, b) => {
      // Sort by frequency descending, then by rank descending
      if (b.count !== a.count) return b.count - a.count;
      return b.rank - a.rank;
    });

  // Calculate tie-breaker score based on ordered ranks
  const tieBreakers = freqEntries.reduce((acc, curr) => acc * 15 + curr.rank, 0);

  // 1. Royal Flush / Straight Flush
  if (isFlush && isStraight) {
    if (straightHigh === 14) {
      return {
        rank: HandRank.ROYAL_FLUSH,
        score: HandRank.ROYAL_FLUSH * 1e8,
        descriptionTh: 'รอยัลสเตรทฟลัช (A-K-Q-J-10 ดอกเดียวกัน)',
      };
    }
    return {
      rank: HandRank.STRAIGHT_FLUSH,
      score: HandRank.STRAIGHT_FLUSH * 1e8 + straightHigh,
      descriptionTh: `สเตรทฟลัชแต้มสูงสุด ${straightHigh}`,
    };
  }

  // 2. Four of a Kind
  if (freqEntries[0].count === 4) {
    return {
      rank: HandRank.FOUR_OF_A_KIND,
      score: HandRank.FOUR_OF_A_KIND * 1e8 + tieBreakers,
      descriptionTh: `โฟร์การ์ดแต้ม ${freqEntries[0].rank}`,
    };
  }

  // 3. Full House
  if (freqEntries[0].count === 3 && freqEntries[1].count === 2) {
    return {
      rank: HandRank.FULL_HOUSE,
      score: HandRank.FULL_HOUSE * 1e8 + tieBreakers,
      descriptionTh: `ฟูลเฮาส์ ตอง ${freqEntries[0].rank} คู่ ${freqEntries[1].rank}`,
    };
  }

  // 4. Flush
  if (isFlush) {
    return {
      rank: HandRank.FLUSH,
      score: HandRank.FLUSH * 1e8 + tieBreakers,
      descriptionTh: `ฟลัช ไพ่สูงสุด ${cards[0].rank}`,
    };
  }

  // 5. Straight
  if (isStraight) {
    return {
      rank: HandRank.STRAIGHT,
      score: HandRank.STRAIGHT * 1e8 + straightHigh,
      descriptionTh: `สเตรท ไพ่สูงสุด ${straightHigh}`,
    };
  }

  // 6. Three of a Kind
  if (freqEntries[0].count === 3) {
    return {
      rank: HandRank.THREE_OF_A_KIND,
      score: HandRank.THREE_OF_A_KIND * 1e8 + tieBreakers,
      descriptionTh: `ตอง ${freqEntries[0].rank}`,
    };
  }

  // 7. Two Pair
  if (freqEntries[0].count === 2 && freqEntries[1].count === 2) {
    return {
      rank: HandRank.TWO_PAIR,
      score: HandRank.TWO_PAIR * 1e8 + tieBreakers,
      descriptionTh: `สองคู่ (${freqEntries[0].rank} & ${freqEntries[1].rank})`,
    };
  }

  // 8. One Pair
  if (freqEntries[0].count === 2) {
    return {
      rank: HandRank.ONE_PAIR,
      score: HandRank.ONE_PAIR * 1e8 + tieBreakers,
      descriptionTh: `หนึ่งคู่ (${freqEntries[0].rank})`,
    };
  }

  // 9. High Card
  return {
    rank: HandRank.HIGH_CARD,
    score: HandRank.HIGH_CARD * 1e8 + tieBreakers,
    descriptionTh: `ไฮการ์ด (${cards[0].rank})`,
  };
}

/**
 * Evaluates the best 5-card hand out of any set of cards (typically 7: 2 hole + 5 community).
 */
export function evaluateBestHand(cards: Card[]): EvaluatedHand {
  if (cards.length < 5) {
    throw new Error(`Cannot evaluate hand with fewer than 5 cards (got ${cards.length})`);
  }

  const allFiveCombinations = combinations(cards, 5);
  let bestHand: EvaluatedHand | null = null;

  for (const combo of allFiveCombinations) {
    const result = evaluateFiveCards(combo);
    if (!bestHand || result.score > bestHand.score) {
      bestHand = {
        rank: result.rank,
        score: result.score,
        nameTh: HAND_RANK_NAMES_TH[result.rank],
        bestFive: combo.sort((a, b) => b.rank - a.rank),
        descriptionTh: result.descriptionTh,
      };
    }
  }

  return bestHand!;
}

/**
 * Formats evaluated hand for display.
 */
export function formatHandDescription(hand: EvaluatedHand): string {
  const cardsStr = hand.bestFive.map(cardToDisplay).join(' ');
  return `**${hand.nameTh}** (${hand.descriptionTh}) [${cardsStr}]`;
}

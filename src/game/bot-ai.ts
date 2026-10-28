import { Card } from './deck';
import { evaluateBestHand, HandRank } from './evaluator';

export type BotDifficulty = 'easy' | 'medium' | 'hard';

export interface BotDecisionContext {
  botCards: Card[];
  communityCards: Card[];
  botChips: number;
  botCurrentBet: number;
  currentHighBet: number;
  minRaiseAmount: number;
  potSize: number;
  difficulty: BotDifficulty;
}

export type BotActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in';

export interface BotDecisionResult {
  action: BotActionType;
  amount: number; // additional chips or total bet amount
  reasoning: string;
}

/**
 * Calculates pre-flop hand score (0-100).
 */
function getPreflopStrength(cards: Card[]): number {
  if (cards.length !== 2) return 30;
  const c1 = cards[0];
  const c2 = cards[1];
  const isPair = c1.rank === c2.rank;
  const isSuited = c1.suit === c2.suit;
  const highRank = Math.max(c1.rank, c2.rank);
  const lowRank = Math.min(c1.rank, c2.rank);
  const gap = highRank - lowRank;

  if (isPair) {
    if (highRank >= 11) return 95; // JJ, QQ, KK, AA
    if (highRank >= 8) return 80;  // 88, 99, 10-10
    return 65;                    // 22 - 77
  }

  let score = (highRank + lowRank) * 2;
  if (isSuited) score += 10;
  if (gap === 1) score += 6; // Connected
  else if (gap === 2) score += 3; // One gapper

  if (highRank === 14 && lowRank >= 10) score += 20; // AK, AQ, AJ, AT

  return Math.min(99, Math.max(10, score));
}

/**
 * Determines the AI Bot's next poker action.
 */
export function decideBotAction(ctx: BotDecisionContext): BotDecisionResult {
  const {
    botCards,
    communityCards,
    botChips,
    botCurrentBet,
    currentHighBet,
    minRaiseAmount,
    potSize,
    difficulty,
  } = ctx;

  const toCall = Math.max(0, currentHighBet - botCurrentBet);
  const canCheck = toCall === 0;

  // Easy Difficulty (Calling Station / Passive)
  if (difficulty === 'easy') {
    if (canCheck) {
      if (Math.random() < 0.1 && botChips >= minRaiseAmount) {
        return { action: 'bet', amount: minRaiseAmount, reasoning: 'Easy bot random test bet' };
      }
      return { action: 'check', amount: 0, reasoning: 'Easy bot checks freely' };
    }

    // Facing a bet
    if (toCall >= botChips) {
      // Facing All-in
      return Math.random() < 0.3
        ? { action: 'call', amount: botChips, reasoning: 'Easy bot calls all-in by chance' }
        : { action: 'fold', amount: 0, reasoning: 'Easy bot folds to all-in' };
    }

    if (toCall <= botChips * 0.15 || Math.random() < 0.6) {
      return { action: 'call', amount: toCall, reasoning: 'Easy bot calls moderate bet' };
    }

    return { action: 'fold', amount: 0, reasoning: 'Easy bot folds' };
  }

  // Medium / Hard: Analyze Hand Strength
  let handStrength = 0; // 0 - 100

  if (communityCards.length === 0) {
    // Pre-flop
    handStrength = getPreflopStrength(botCards);
  } else {
    // Post-flop (3, 4, or 5 community cards)
    const allCards = [...botCards, ...communityCards];
    const evaluated = evaluateBestHand(allCards);

    switch (evaluated.rank) {
      case HandRank.ROYAL_FLUSH:
      case HandRank.STRAIGHT_FLUSH:
      case HandRank.FOUR_OF_A_KIND:
        handStrength = 99;
        break;
      case HandRank.FULL_HOUSE:
        handStrength = 95;
        break;
      case HandRank.FLUSH:
        handStrength = 88;
        break;
      case HandRank.STRAIGHT:
        handStrength = 82;
        break;
      case HandRank.THREE_OF_A_KIND:
        handStrength = 75;
        break;
      case HandRank.TWO_PAIR:
        handStrength = 65;
        break;
      case HandRank.ONE_PAIR:
        // Check if top pair
        const pairRank = evaluated.bestFive[0].rank;
        const highestBoardRank = Math.max(...communityCards.map(c => c.rank));
        handStrength = pairRank >= highestBoardRank ? 55 : 45;
        break;
      default:
        // High card
        handStrength = Math.min(35, botCards[0].rank * 2);
    }
  }

  // Hard difficulty bluffing bonus
  if (difficulty === 'hard') {
    // 20% chance to simulate a strong bluff
    if (Math.random() < 0.20 && toCall <= botChips * 0.2) {
      handStrength += 35;
    }
  }

  // Action decisions based on hand strength
  if (canCheck) {
    // Strong hand -> Bet or Raise
    if (handStrength >= 75 && botChips >= minRaiseAmount) {
      const betSize = Math.min(
        botChips,
        Math.max(minRaiseAmount, Math.round((potSize * 0.6) / 10) * 10)
      );
      return { action: 'bet', amount: betSize, reasoning: `Value bet with hand strength ${handStrength}` };
    }

    // Medium hand -> Sometimes bet, mostly check
    if (handStrength >= 50 && Math.random() < 0.35 && botChips >= minRaiseAmount) {
      return { action: 'bet', amount: minRaiseAmount, reasoning: 'Probing bet' };
    }

    return { action: 'check', amount: 0, reasoning: 'Checks in position' };
  }

  // Facing a bet (toCall > 0)
  const potOdds = toCall / (potSize + toCall); // e.g. 0.25 (need 25% equity)

  // Monster hand -> Raise / Re-raise
  if (handStrength >= 85 && botChips > toCall) {
    const raiseSize = Math.min(botChips, toCall + Math.max(minRaiseAmount, Math.round(potSize * 0.5)));
    return { action: 'raise', amount: raiseSize, reasoning: `Raising monster hand (${handStrength})` };
  }

  // Strong hand -> Call or Raise
  if (handStrength >= 65) {
    if (Math.random() < 0.3 && botChips > toCall + minRaiseAmount) {
      const raiseSize = Math.min(botChips, toCall + minRaiseAmount);
      return { action: 'raise', amount: raiseSize, reasoning: `Value raise (${handStrength})` };
    }
    return { action: 'call', amount: Math.min(botChips, toCall), reasoning: `Calling with good hand (${handStrength})` };
  }

  // Medium hand -> Call if pot odds are reasonable
  if (handStrength >= 40) {
    if (potOdds <= 0.35 || toCall <= botChips * 0.15) {
      return { action: 'call', amount: Math.min(botChips, toCall), reasoning: `Calling with fair odds (${potOdds.toFixed(2)})` };
    }
  }

  // Weak hand -> Fold
  return { action: 'fold', amount: 0, reasoning: `Folding weak hand (${handStrength}) to bet` };
}

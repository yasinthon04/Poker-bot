import { test, describe } from 'node:test';
import assert from 'node:assert';
import { evaluateBestHand, HandRank } from '../src/game/evaluator';
import { parseCard } from '../src/game/deck';

function makeCards(cardStrings: string[]) {
  return cardStrings.map(str => {
    const c = parseCard(str);
    if (!c) throw new Error(`Invalid card string: ${str}`);
    return c;
  });
}

describe('Texas Hold\'em Poker Hand Evaluator', () => {
  test('Identifies Royal Flush', () => {
    const cards = makeCards(['Ah', 'Kh', 'Qh', 'Jh', '10h', '2c', '3d']);
    const hand = evaluateBestHand(cards);
    assert.strictEqual(hand.rank, HandRank.ROYAL_FLUSH);
  });

  test('Identifies Straight Flush', () => {
    const cards = makeCards(['9s', '8s', '7s', '6s', '5s', 'Kd', '2c']);
    const hand = evaluateBestHand(cards);
    assert.strictEqual(hand.rank, HandRank.STRAIGHT_FLUSH);
  });

  test('Identifies Wheel Straight Flush (A-2-3-4-5)', () => {
    const cards = makeCards(['As', '5s', '4s', '3s', '2s', 'Kh', 'Qd']);
    const hand = evaluateBestHand(cards);
    assert.strictEqual(hand.rank, HandRank.STRAIGHT_FLUSH);
  });

  test('Identifies Four of a Kind', () => {
    const cards = makeCards(['8h', '8d', '8c', '8s', 'Ah', '2c', '3d']);
    const hand = evaluateBestHand(cards);
    assert.strictEqual(hand.rank, HandRank.FOUR_OF_A_KIND);
  });

  test('Identifies Full House', () => {
    const cards = makeCards(['Kh', 'Kd', 'Kc', '4h', '4d', '2s', '3c']);
    const hand = evaluateBestHand(cards);
    assert.strictEqual(hand.rank, HandRank.FULL_HOUSE);
  });

  test('Identifies Flush', () => {
    const cards = makeCards(['Ah', '10h', '7h', '6h', '2h', 'Ks', 'Qc']);
    const hand = evaluateBestHand(cards);
    assert.strictEqual(hand.rank, HandRank.FLUSH);
  });

  test('Identifies Straight', () => {
    const cards = makeCards(['9h', '8d', '7c', '6s', '5h', '2c', '3d']);
    const hand = evaluateBestHand(cards);
    assert.strictEqual(hand.rank, HandRank.STRAIGHT);
  });

  test('Identifies Wheel Straight (A-2-3-4-5)', () => {
    const cards = makeCards(['Ah', '5d', '4c', '3s', '2h', 'Kh', 'Qd']);
    const hand = evaluateBestHand(cards);
    assert.strictEqual(hand.rank, HandRank.STRAIGHT);
  });

  test('Identifies Three of a Kind', () => {
    const cards = makeCards(['7h', '7d', '7c', 'Ah', 'Kd', '2s', '3c']);
    const hand = evaluateBestHand(cards);
    assert.strictEqual(hand.rank, HandRank.THREE_OF_A_KIND);
  });

  test('Identifies Two Pair', () => {
    const cards = makeCards(['Ah', 'Ad', 'Kh', 'Kd', 'Qc', '2s', '3h']);
    const hand = evaluateBestHand(cards);
    assert.strictEqual(hand.rank, HandRank.TWO_PAIR);
  });

  test('Identifies One Pair', () => {
    const cards = makeCards(['Ah', 'Ad', 'Kh', 'Qc', 'Jd', '2s', '3h']);
    const hand = evaluateBestHand(cards);
    assert.strictEqual(hand.rank, HandRank.ONE_PAIR);
  });

  test('Identifies High Card', () => {
    const cards = makeCards(['Ah', 'Kd', 'Qc', 'Js', '9h', '4c', '2d']);
    const hand = evaluateBestHand(cards);
    assert.strictEqual(hand.rank, HandRank.HIGH_CARD);
  });

  test('Tie breaker: Higher pair wins', () => {
    const handA = evaluateBestHand(makeCards(['Ah', 'Ad', '10c', '8s', '4d', '2c', '3d'])); // Pair Aces
    const handB = evaluateBestHand(makeCards(['Kh', 'Kd', 'Qc', 'Js', '9h', '2c', '3d']));   // Pair Kings
    assert.ok(handA.score > handB.score, 'Pair of Aces must beat Pair of Kings');
  });

  test('Tie breaker: Same pair, kicker decides', () => {
    const handA = evaluateBestHand(makeCards(['Ah', 'Ad', 'Kc', '8s', '4d', '2c', '3d'])); // Pair Aces, King kicker
    const handB = evaluateBestHand(makeCards(['Ac', 'As', 'Qc', '8s', '4d', '2c', '3d'])); // Pair Aces, Queen kicker
    assert.ok(handA.score > handB.score, 'King kicker must beat Queen kicker');
  });

  test('Tie breaker: Full house higher trips wins', () => {
    const handA = evaluateBestHand(makeCards(['Kh', 'Kd', 'Kc', '4h', '4d', '2c', '3d'])); // KKK44
    const handB = evaluateBestHand(makeCards(['Qh', 'Qd', 'Qc', 'Ah', 'Ad', '2c', '3d'])); // QQQAA
    assert.ok(handA.score > handB.score, 'Trip Kings Full House must beat Trip Queens');
  });
});

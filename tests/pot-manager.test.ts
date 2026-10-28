import { test, describe } from 'node:test';
import assert from 'node:assert';
import { calculatePots, PlayerContribution } from '../src/game/pot-manager';

describe('Pot and Side-Pot Manager', () => {
  test('Single pot with equal bets', () => {
    const contributions: PlayerContribution[] = [
      { userId: 'p1', amount: 100, hasFolded: false },
      { userId: 'p2', amount: 100, hasFolded: false },
    ];

    const pots = calculatePots(contributions);
    assert.strictEqual(pots.length, 1);
    assert.strictEqual(pots[0].amount, 200);
    assert.deepStrictEqual(pots[0].eligiblePlayerIds.sort(), ['p1', 'p2'].sort());
  });

  test('Main pot and 1 side pot when 1 player is all-in with fewer chips', () => {
    const contributions: PlayerContribution[] = [
      { userId: 'p1', amount: 50, hasFolded: false },  // All-in for 50
      { userId: 'p2', amount: 100, hasFolded: false }, // Called 100
      { userId: 'p3', amount: 100, hasFolded: false }, // Called 100
    ];

    const pots = calculatePots(contributions);
    assert.strictEqual(pots.length, 2);

    // Main pot: 50 from each = 150
    assert.strictEqual(pots[0].amount, 150);
    assert.deepStrictEqual(pots[0].eligiblePlayerIds.sort(), ['p1', 'p2', 'p3'].sort());

    // Side pot: (100 - 50) from p2 and p3 = 100
    assert.strictEqual(pots[1].amount, 100);
    assert.deepStrictEqual(pots[1].eligiblePlayerIds.sort(), ['p2', 'p3'].sort());
  });

  test('Multiple side pots with 3 different stack tiers', () => {
    const contributions: PlayerContribution[] = [
      { userId: 'p1', amount: 20, hasFolded: false },  // All-in 20
      { userId: 'p2', amount: 60, hasFolded: false },  // All-in 60
      { userId: 'p3', amount: 120, hasFolded: false }, // Bet 120
      { userId: 'p4', amount: 120, hasFolded: false }, // Bet 120
    ];

    const pots = calculatePots(contributions);
    assert.strictEqual(pots.length, 3);

    // Pot 0: 20 * 4 = 80 (eligible: p1, p2, p3, p4)
    assert.strictEqual(pots[0].amount, 80);
    assert.strictEqual(pots[0].eligiblePlayerIds.length, 4);

    // Pot 1: (60 - 20) * 3 = 120 (eligible: p2, p3, p4)
    assert.strictEqual(pots[1].amount, 120);
    assert.deepStrictEqual(pots[1].eligiblePlayerIds.sort(), ['p2', 'p3', 'p4'].sort());

    // Pot 2: (120 - 60) * 2 = 120 (eligible: p3, p4)
    assert.strictEqual(pots[2].amount, 120);
    assert.deepStrictEqual(pots[2].eligiblePlayerIds.sort(), ['p3', 'p4'].sort());
  });

  test('Folded player contributes chips but is ineligible to win', () => {
    const contributions: PlayerContribution[] = [
      { userId: 'p1', amount: 50, hasFolded: false }, // All-in
      { userId: 'p2', amount: 100, hasFolded: true },  // Folded
      { userId: 'p3', amount: 100, hasFolded: false }, // Active
    ];

    const pots = calculatePots(contributions);
    assert.strictEqual(pots.length, 2);

    // Main pot: 150 (p2 chips are in, but p2 is not eligible)
    assert.strictEqual(pots[0].amount, 150);
    assert.deepStrictEqual(pots[0].eligiblePlayerIds.sort(), ['p1', 'p3'].sort());

    // Side pot: 100 (50 from p2 + 50 from p3, only p3 eligible)
    assert.strictEqual(pots[1].amount, 100);
    assert.deepStrictEqual(pots[1].eligiblePlayerIds, ['p3']);
  });
});

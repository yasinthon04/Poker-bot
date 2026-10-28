import { test, describe } from 'node:test';
import assert from 'node:assert';
import { calculateSettlements } from '../src/services/settlement';

describe('Settlement and Debt Clearance Engine', () => {
  test('Standard Zero-Sum Settlement without Bots', () => {
    const players = [
      { userId: 'u1', name: 'Alice', buyIn: 100, cashOut: 200 }, // +100
      { userId: 'u2', name: 'Bob', buyIn: 100, cashOut: 50 },    // -50
      { userId: 'u3', name: 'Charlie', buyIn: 100, cashOut: 50 },// -50
    ];

    const result = calculateSettlements(players);
    assert.strictEqual(result.isBalanced, true);
    assert.strictEqual(result.hasBots, false);
    assert.strictEqual(result.discrepancy, 0);
    assert.strictEqual(result.transactions.length, 2);

    // Verify transactions clear all debts
    const aliceReceives = result.transactions
      .filter(t => t.toUserId === 'u1')
      .reduce((sum, t) => sum + t.amount, 0);
    assert.strictEqual(aliceReceives, 100);
  });

  test('Settlement with Bots calculates transactions properly for solo testing', () => {
    const playersWithBot = [
      { userId: 'u1', name: 'Alice', buyIn: 100, cashOut: 250, isBot: false },
      { userId: 'u2', name: 'Bob', buyIn: 100, cashOut: 0, isBot: false },
      { userId: 'bot_123', name: 'Bot Shark', buyIn: 100, cashOut: 50, isBot: true },
    ];

    const result = calculateSettlements(playersWithBot);
    assert.strictEqual(result.isBalanced, true);
    assert.strictEqual(result.hasBots, true);
    // Transactions are calculated so single players can test settlement with bots!
    assert.strictEqual(result.transactions.length > 0, true);
    assert.strictEqual(result.players.length, 3);
  });

  test('Early Leaver rejoining: aggregated into single net balance', () => {
    const players = [
      { userId: 'u1', name: 'Alice', buyIn: 100, cashOut: 0 },   // Initial session
      { userId: 'u1', name: 'Alice', buyIn: 100, cashOut: 250 }, // Rebuy & cashout
      { userId: 'u2', name: 'Bob', buyIn: 100, cashOut: 50 },
    ];

    const result = calculateSettlements(players);
    const alice = result.players.find(p => p.userId === 'u1');
    assert.ok(alice);
    assert.strictEqual(alice.buyIn, 200);
    assert.strictEqual(alice.cashOut, 250);
    assert.strictEqual(alice.net, 50);
  });
});

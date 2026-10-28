import { test, describe } from 'node:test';
import assert from 'node:assert';
import { PokerTable } from '../src/game/poker-table';

describe('Texas Hold\'em Poker Table State Machine', () => {
  test('Heads-up (2 players): Dealer is Small Blind and acts first preflop', () => {
    const table = new PokerTable('tab1', 'chan1', 'user1', 100);
    table.sitDown(0, { id: 'u1', username: 'alice', displayName: 'Alice' }, 200);
    table.sitDown(1, { id: 'u2', username: 'bob', displayName: 'Bob' }, 200);

    table.dealerSeat = 0; // Alice is Dealer
    const started = table.startHand();
    assert.strictEqual(started, true);

    // In Heads-up: Dealer (Alice, seat 0) is Small Blind, Bob (seat 1) is Big Blind
    const alice = table.seats[0]!;
    const bob = table.seats[1]!;

    assert.strictEqual(alice.currentRoundBet, table.smallBlind);
    assert.strictEqual(bob.currentRoundBet, table.bigBlind);

    // In Heads-up: Small Blind (Dealer, Alice) acts first preflop!
    assert.strictEqual(table.currentTurnSeat, 0);
  });

  test('3+ Players: Small blind left of Dealer, BB left of SB, UTG acts first', () => {
    const table = new PokerTable('tab2', 'chan2', 'user1', 100);
    table.sitDown(0, { id: 'u1', username: 'alice', displayName: 'Alice' }, 200);
    table.sitDown(1, { id: 'u2', username: 'bob', displayName: 'Bob' }, 200);
    table.sitDown(2, { id: 'u3', username: 'charlie', displayName: 'Charlie' }, 200);

    table.dealerSeat = 0; // Alice is Button
    table.startHand();

    const alice = table.seats[0]!;
    const bob = table.seats[1]!;
    const charlie = table.seats[2]!;

    // Bob is SB (seat 1), Charlie is BB (seat 2)
    assert.strictEqual(bob.currentRoundBet, table.smallBlind);
    assert.strictEqual(charlie.currentRoundBet, table.bigBlind);

    // UTG is left of BB (Alice, seat 0) -> acts first preflop!
    assert.strictEqual(table.currentTurnSeat, 0);
  });

  test('Big Blind option: BB can check if everyone calls preflop', () => {
    const table = new PokerTable('tab3', 'chan3', 'user1', 100);
    table.sitDown(0, { id: 'u1', username: 'alice', displayName: 'Alice' }, 200);
    table.sitDown(1, { id: 'u2', username: 'bob', displayName: 'Bob' }, 200);

    table.dealerSeat = 0; // Alice is Dealer (SB), Bob is BB
    table.startHand();

    // Alice calls BB (adds 10 to make 20)
    table.handleAction('u1', 'call');

    // Action MUST go to Bob (BB option), not advance directly to Flop!
    assert.strictEqual(table.currentTurnSeat, 1);
    assert.strictEqual(table.phase, 'preflop');

    // Bob checks his option
    table.handleAction('u2', 'check');

    // NOW the round is complete and advances to Flop!
    assert.strictEqual(table.phase, 'flop');
    assert.strictEqual(table.communityCards.length, 3);
  });

  test('Re-raise re-opens action for previous callers', () => {
    const table = new PokerTable('tab4', 'chan4', 'user1', 100);
    table.sitDown(0, { id: 'u1', username: 'alice', displayName: 'Alice' }, 500);
    table.sitDown(1, { id: 'u2', username: 'bob', displayName: 'Bob' }, 500);
    table.sitDown(2, { id: 'u3', username: 'charlie', displayName: 'Charlie' }, 500);

    table.dealerSeat = 0; // Alice: Button (UTG), Bob: SB, Charlie: BB
    table.startHand();

    // Alice calls BB (20)
    table.handleAction('u1', 'call');

    // Bob calls (completes SB from 10 to 20)
    table.handleAction('u2', 'call');

    // Charlie (BB) raises to 60!
    table.handleAction('u3', 'raise', 60);

    // Alice previously called 20, but because Charlie raised to 60, Alice MUST act again!
    assert.strictEqual(table.currentTurnSeat, 0);
    assert.strictEqual(table.phase, 'preflop');
    assert.strictEqual(table.currentHighBet, 60);
  });

  test('Early Leave locks chips and marks status', () => {
    const table = new PokerTable('tab5', 'chan5', 'user1', 100);
    table.sitDown(0, { id: 'u1', username: 'alice', displayName: 'Alice' }, 200);
    table.sitDown(1, { id: 'u2', username: 'bob', displayName: 'Bob' }, 200);

    const left = table.earlyLeave('u1', 180);
    assert.strictEqual(left, true);

    const alice = table.seats[0]!;
    assert.strictEqual(alice.chips, 180);
    assert.strictEqual(alice.isEarlyLeaver, true);
    assert.strictEqual(alice.isFolded, true);
  });

  test('Update profile alters displayName and avatarUrl for seated player', () => {
    const table = new PokerTable('tab6', 'chan6', 'user1', 100);
    table.sitDown(0, { id: 'u1', username: 'alice', displayName: 'Alice' }, 200);

    const updated = table.updatePlayerProfile('u1', 'SuperAlice', 'https://example.com/avatar.png');
    assert.strictEqual(updated, true);

    const alice = table.seats[0]!;
    assert.strictEqual(alice.displayName, 'SuperAlice');
    assert.strictEqual(alice.avatarUrl, 'https://example.com/avatar.png');
  });

  test('Rebuy increases chips and totalBuyIn, emitting rebuy event', () => {
    const table = new PokerTable('tab7', 'chan7', 'user1', 100);
    table.sitDown(0, { id: 'u1', username: 'alice', displayName: 'Alice' }, 100);

    const rebuySuccess = table.rebuy('u1', 200);
    assert.strictEqual(rebuySuccess, true);

    const alice = table.seats[0]!;
    assert.strictEqual(alice.chips, 300);
    assert.strictEqual(alice.totalBuyIn, 300);
    assert.strictEqual(table.lastEvent?.type, 'rebuy');
    assert.strictEqual(table.lastEvent?.amount, 200);
  });

  test('Add bot sets hasBots true and removing bot restores hasBots state', () => {
    const table = new PokerTable('tab8', 'chan8', 'user1', 100);
    table.sitDown(0, { id: 'u1', username: 'alice', displayName: 'Alice' }, 200);
    assert.strictEqual(table.hasBots, false);

    table.addBot(1, 'Bot Shark', 'hard', 200);
    assert.strictEqual(table.hasBots, true);
    assert.strictEqual(table.seats[1]?.isBot, true);
    assert.strictEqual(table.seats[1]?.botDifficulty, 'hard');

    table.removeBot(1);
    assert.strictEqual(table.hasBots, false);
    assert.strictEqual(table.seats[1], null);
  });

  test('Fold by one player awards pot to the remaining winner', () => {
    const table = new PokerTable('tab9', 'chan9', 'user1', 100);
    table.sitDown(0, { id: 'u1', username: 'alice', displayName: 'Alice' }, 200);
    table.sitDown(1, { id: 'u2', username: 'bob', displayName: 'Bob' }, 200);

    table.dealerSeat = 0;
    table.startHand(); // Alice is SB (10), Bob is BB (20). Alice acts first.

    // Alice folds
    table.handleAction('u1', 'fold');

    assert.strictEqual(table.phase, 'hand_ended');
    assert.strictEqual(table.handWinners?.length, 1);
    assert.strictEqual(table.handWinners[0].userId, 'u2');
    // Bob should have won the pot: 5 (Alice SB) + 10 (Bob BB) = 15 -> 190 + 15 = 205
    const bob = table.seats[1]!;
    assert.strictEqual(bob.chips, 205);
    assert.strictEqual(table.lastEvent?.type, 'showdown');
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseManualInputLines, formatPlayersForModal, resolvePlayerDiscordMembers } from '../src/services/manual-parser';
import * as repo from '../src/database/repo';

describe('Manual Settlement Parsing & Formatting', () => {
  test('Parses multi-line entries with default buy-in', () => {
    const raw = `@Ton 350\n@Nadear 50\n@JJ 200`;
    const res = parseManualInputLines(raw, 200);

    assert.strictEqual(res.errors.length, 0);
    assert.strictEqual(res.players.length, 3);

    assert.strictEqual(res.players[0].name, 'Ton');
    assert.strictEqual(res.players[0].cashOut, 350);
    assert.strictEqual(res.players[0].buyIn, 200);

    assert.strictEqual(res.players[1].name, 'Nadear');
    assert.strictEqual(res.players[1].cashOut, 50);
    assert.strictEqual(res.players[1].buyIn, 200);

    assert.strictEqual(res.players[2].name, 'JJ');
    assert.strictEqual(res.players[2].cashOut, 200);
    assert.strictEqual(res.players[2].buyIn, 200);
  });

  test('Parses comma-separated entries on a single line', () => {
    const raw = `@Ton 350, @Nadear 50, @JJ 200`;
    const res = parseManualInputLines(raw, 200);

    assert.strictEqual(res.errors.length, 0);
    assert.strictEqual(res.players.length, 3);
    assert.strictEqual(res.players[0].name, 'Ton');
    assert.strictEqual(res.players[0].cashOut, 350);
    assert.strictEqual(res.players[1].name, 'Nadear');
    assert.strictEqual(res.players[1].cashOut, 50);
  });

  test('Parses individual custom buy-in syntax', () => {
    // 1. buyin: 400
    const raw1 = `@Ton 350 buyin:400`;
    const res1 = parseManualInputLines(raw1, 200);
    assert.strictEqual(res1.players[0].cashOut, 350);
    assert.strictEqual(res1.players[0].buyIn, 400);

    // 2. Slash format: 350/500
    const raw2 = `Charlie 350/500`;
    const res2 = parseManualInputLines(raw2, 200);
    assert.strictEqual(res2.players[0].name, 'Charlie');
    assert.strictEqual(res2.players[0].cashOut, 350);
    assert.strictEqual(res2.players[0].buyIn, 500);

    // 3. Parenthesis format: 150 (300)
    const raw3 = `Dave 150 (300)`;
    const res3 = parseManualInputLines(raw3, 200);
    assert.strictEqual(res3.players[0].name, 'Dave');
    assert.strictEqual(res3.players[0].cashOut, 150);
    assert.strictEqual(res3.players[0].buyIn, 300);

    // 4. Thai keywords: ทุน 600, บายอิน 400
    const raw4 = `สมชาย 400 ทุน 600\nสมศรี 800 บายอิน: 400`;
    const res4 = parseManualInputLines(raw4, 200);
    assert.strictEqual(res4.players[0].name, 'สมชาย');
    assert.strictEqual(res4.players[0].cashOut, 400);
    assert.strictEqual(res4.players[0].buyIn, 600);
    assert.strictEqual(res4.players[1].name, 'สมศรี');
    assert.strictEqual(res4.players[1].cashOut, 800);
    assert.strictEqual(res4.players[1].buyIn, 400);
  });

  test('Parses signed net profit (+150 or -150)', () => {
    const raw = `Alice +150\nBob -100`;
    const res = parseManualInputLines(raw, 200);

    assert.strictEqual(res.players[0].name, 'Alice');
    assert.strictEqual(res.players[0].buyIn, 200);
    assert.strictEqual(res.players[0].cashOut, 350); // 200 + 150

    assert.strictEqual(res.players[1].name, 'Bob');
    assert.strictEqual(res.players[1].buyIn, 200);
    assert.strictEqual(res.players[1].cashOut, 100); // 200 - 100
  });

  test('Parses Discord snowflake mentions <@123456789>', () => {
    const raw = `<@9876543210> 500 buyin:300`;
    const res = parseManualInputLines(raw, 200);

    assert.strictEqual(res.players[0].userId, '9876543210');
    assert.strictEqual(res.players[0].cashOut, 500);
    assert.strictEqual(res.players[0].buyIn, 300);
  });

  test('Formats players list back into editable string for modal', () => {
    const players = [
      { user_id: '111', username: 'alice', display_name: 'Alice', buy_in: 200, cash_out: 350 },
      { user_id: '222', username: 'bob', display_name: 'Bob', buy_in: 400, cash_out: 50 },
      { user_id: 'guest_charlie', username: 'guest_charlie', display_name: null, buy_in: 200, cash_out: 200 },
    ];

    const formatted = formatPlayersForModal(200, players);
    assert.strictEqual(
      formatted,
      `<@111> 350\n<@222> 50 buyin:400\nguest_charlie 200`
    );
  });
});

describe('Manual Settlement Database & Leaderboard Integration', () => {
  const guildId = `test_guild_${Date.now()}`;
  const channelId = `test_chan_${Date.now()}`;
  const hostId = `test_host_${Date.now()}`;

  test('Creates completed manual session, stores settlements, and updates Leaderboard', async () => {
    const userA = `user_a_${Date.now()}`;
    const userB = `user_b_${Date.now()}`;

    await repo.upsertUser(userA, 'UserA', 'Alice Winner');
    await repo.upsertUser(userB, 'UserB', 'Bob Sponsor');

    const playerEntries = [
      { userId: userA, name: 'Alice Winner', buyIn: 200, cashOut: 350 },
      { userId: userB, name: 'Bob Sponsor', buyIn: 200, cashOut: 50 },
    ];

    const { settlement, session } = await repo.saveOrUpdateManualSession(
      guildId,
      channelId,
      hostId,
      200,
      playerEntries
    );

    assert.strictEqual(session.status, 'completed');
    assert.strictEqual(settlement.isBalanced, true);
    assert.strictEqual(settlement.transactions.length, 1);
    assert.strictEqual(settlement.transactions[0].fromUserId, userB);
    assert.strictEqual(settlement.transactions[0].toUserId, userA);
    assert.strictEqual(settlement.transactions[0].amount, 150);

    // Verify stats for User A
    const statsA = await repo.getUserStats(userA);
    assert.strictEqual(statsA.totalProfit, 150);
    assert.strictEqual(statsA.gamesPlayed, 1);
    assert.strictEqual(statsA.wins, 1);

    // Verify stats for User B
    const statsB = await repo.getUserStats(userB);
    assert.strictEqual(statsB.totalProfit, -150);
    assert.strictEqual(statsB.gamesPlayed, 1);
    assert.strictEqual(statsB.losses, 1);

    // Verify Leaderboard ranking
    const leaderboard = await repo.getRankedStats(guildId);
    assert.strictEqual(leaderboard.length, 2);
    assert.strictEqual(leaderboard[0].userId, userA);
    assert.strictEqual(leaderboard[0].totalProfit, 150);
    assert.strictEqual(leaderboard[1].userId, userB);
    assert.strictEqual(leaderboard[1].totalProfit, -150);

    // Now EDIT this session: modify cashouts so Bob is winner and Alice lost!
    const editedEntries = [
      { userId: userA, name: 'Alice Winner', buyIn: 200, cashOut: 50 },
      { userId: userB, name: 'Bob Sponsor', buyIn: 200, cashOut: 350 },
    ];

    const editedResult = await repo.saveOrUpdateManualSession(
      guildId,
      channelId,
      hostId,
      200,
      editedEntries,
      session.id
    );

    assert.strictEqual(editedResult.session.id, session.id);
    assert.strictEqual(editedResult.settlement.isBalanced, true);
    assert.strictEqual(editedResult.settlement.transactions[0].fromUserId, userA);
    assert.strictEqual(editedResult.settlement.transactions[0].toUserId, userB);
    assert.strictEqual(editedResult.settlement.transactions[0].amount, 150);

    // Verify stats immediately recalculated without orphan data
    const updatedStatsA = await repo.getUserStats(userA);
    assert.strictEqual(updatedStatsA.totalProfit, -150);
    assert.strictEqual(updatedStatsA.gamesPlayed, 1);

    const updatedStatsB = await repo.getUserStats(userB);
    assert.strictEqual(updatedStatsB.totalProfit, 150);
    assert.strictEqual(updatedStatsB.gamesPlayed, 1);

    // Leaderboard ranking swapped
    const updatedLeaderboard = await repo.getRankedStats(guildId);
    assert.strictEqual(updatedLeaderboard[0].userId, userB);
    assert.strictEqual(updatedLeaderboard[0].totalProfit, 150);
    assert.strictEqual(updatedLeaderboard[1].userId, userA);
    assert.strictEqual(updatedLeaderboard[1].totalProfit, -150);
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { pokerCommand, processTableScan } from '../src/commands/poker';
import { helpCommand } from '../src/commands/help';
import { PokerTable } from '../src/game/poker-table';
import * as repo from '../src/database/repo';
import * as vision from '../src/services/vision';

describe('Discord Bot Slash Commands & Default Buy-in Configuration', () => {
  test('/poker start, start-voice, and scan-table configure default buy-in to 200', () => {
    const json = pokerCommand.data.toJSON();
    const subcommands = json.options?.filter((o: any) => o.type === 1) || [];

    // 1. /poker start
    const startSub = subcommands.find((s: any) => s.name === 'start');
    assert.ok(startSub, 'start subcommand should exist');
    const startBuyinOpt = startSub.options?.find((o: any) => o.name === 'buyin');
    assert.ok(startBuyinOpt, 'buyin option in start should exist');
    assert.ok(startBuyinOpt.description.includes('200'), 'start buyin description should mention 200');

    // 2. /poker start-voice
    const startVoiceSub = subcommands.find((s: any) => s.name === 'start-voice');
    assert.ok(startVoiceSub, 'start-voice subcommand should exist');
    const startVoiceBuyinOpt = startVoiceSub.options?.find((o: any) => o.name === 'buyin');
    assert.ok(startVoiceBuyinOpt, 'buyin option in start-voice should exist');
    assert.ok(startVoiceBuyinOpt.description.includes('200'), 'start-voice buyin description should mention 200');

    // 3. /poker scan-table
    const scanTableSub = subcommands.find((s: any) => s.name === 'scan-table');
    assert.ok(scanTableSub, 'scan-table subcommand should exist');
    const scanBuyinOpt = scanTableSub.options?.find((o: any) => o.name === 'buyin');
    assert.ok(scanBuyinOpt, 'buyin option in scan-table should exist');
    assert.ok(scanBuyinOpt.description.includes('200'), 'scan-table buyin description should mention 200');
    // 4. /poker reset-all
    const resetAllSub = subcommands.find((s: any) => s.name === 'reset-all');
    assert.ok(resetAllSub, 'reset-all subcommand should exist');
    const confirmOpt = resetAllSub.options?.find((o: any) => o.name === 'confirm');
    assert.ok(confirmOpt, 'confirm option in reset-all should exist');
    assert.strictEqual(confirmOpt.required, true, 'confirm option should be required');
  });

  test('repo.resetAllData resets sessions and settlements', async () => {
    await repo.resetAllData();
    const active = await repo.getActiveSession('test_chan');
    assert.strictEqual(active, undefined);
  });

  test('PokerTable constructor defaults buyIn to 200 when not specified', () => {
    const table = new PokerTable('tab_test_default', 'chan_default', 'user_host');
    assert.strictEqual(table.defaultBuyIn, 200);
    assert.strictEqual(table.smallBlind, 10);
    assert.strictEqual(table.bigBlind, 20);
    assert.strictEqual(table.minRaise, 20);
  });

  test('helpCommand executes successfully and all fields are <= 1024 characters', async () => {
    let repliedPayload: any = null;
    const fakeInteraction: any = {
      reply: async (obj: any) => {
        repliedPayload = obj;
      },
    };

    await helpCommand.execute(fakeInteraction);
    assert.ok(repliedPayload, 'helpCommand should reply with payload');
    assert.ok(repliedPayload.embeds && repliedPayload.embeds.length > 0, 'should have embeds');

    const embed = repliedPayload.embeds[0].data;
    assert.ok(embed.title.includes('คู่มือและคำสั่งทั้งหมด'));
    for (const field of embed.fields || []) {
      assert.ok(
        field.value.length <= 1024,
        `Field "${field.name}" length (${field.value.length}) exceeds 1024 char limit`
      );
    }
  });

  test('processTableScan can scan without an open session and uses default buyin 200', async () => {
    // Mock parsePokerScreenshot
    vision.setMockPokerScreenshotParser(async () => [
      { name: 'Ton', chips: 350 },
      { name: 'Nadear', chips: 50 },
    ]);

    const editedReplies: any[] = [];
    const followUps: any[] = [];

    const mockContext = {
      guildId: 'guild_test_1',
      channelId: `chan_test_${Date.now()}`,
      user: {
        id: 'u_ton',
        username: 'ton',
        displayName: 'Ton',
      },
      member: {
        id: 'u_ton',
        displayName: 'Ton',
      },
      guild: {
        id: 'guild_test_1',
        members: {
          cache: new Map([
            ['u_ton', { id: 'u_ton', user: { id: 'u_ton', username: 'ton', bot: false }, displayName: 'Ton' }],
            ['u_nadear', { id: 'u_nadear', user: { id: 'u_nadear', username: 'nadear', bot: false }, displayName: 'Nadear' }],
          ]),
          search: async () => new Map(),
        },
        voiceStates: {
          cache: new Map(),
        },
      },
      replied: true,
      deferred: true,
      editReply: async (data: any) => {
        editedReplies.push(data);
        return data;
      },
      followUp: async (data: any) => {
        followUps.push(data);
        return data;
      },
    };

    try {
      // Execute scan-table without an existing session (session = null)
      await processTableScan(
        mockContext,
        null,
        'https://example.com/test-table.png',
        'test-table.png',
        false,
        null,
        null,
        200
      );

      // Verify that scan succeeded
      assert.strictEqual(editedReplies.length > 0, true);
      assert.ok(editedReplies[0].content.includes('AI สแกนรูปภาพสำเร็จ'));
      assert.ok(editedReplies[0].content.includes('Buy-in 200฿'));
      assert.ok(editedReplies[0].content.includes('Ton'));
      assert.ok(editedReplies[0].content.includes('Nadear'));

      // Verify that followUp was sent with summary embed and next round button
      assert.strictEqual(followUps.length > 0, true);
      const summaryEmbed = followUps[0].embeds[0];
      assert.ok(summaryEmbed);

      // Verify session in DB
      const session = await repo.getActiveSession(mockContext.channelId);
      // Because it finalized, the active session is completed
      assert.strictEqual(session, undefined); // completed session is not active

      const lastSession = await repo.getLastSession(mockContext.channelId);
      assert.ok(lastSession);
      assert.strictEqual(lastSession.default_buyin, 200);
      assert.strictEqual(lastSession.status, 'completed');

      const players = await repo.getSessionPlayers(lastSession.id);
      assert.strictEqual(players.length, 2);

      const ton = players.find(p => p.username.toLowerCase().includes('ton'));
      const nadear = players.find(p => p.username.toLowerCase().includes('nadear'));

      assert.ok(ton);
      assert.ok(nadear);
      assert.strictEqual(ton.buy_in, 200);
      assert.strictEqual(ton.cash_out, 350);
      assert.strictEqual(nadear.buy_in, 200);
      assert.strictEqual(nadear.cash_out, 50);
    } finally {
      vision.setMockPokerScreenshotParser(null);
    }
  });

  test('processTableScan without open session handles guest players outside Discord', async () => {
    // Mock parsePokerScreenshot
    vision.setMockPokerScreenshotParser(async () => [
      { name: 'UnknownGuestA', chips: 400 },
      { name: 'UnknownGuestB', chips: 0 },
    ]);

    const editedReplies: any[] = [];
    const followUps: any[] = [];

    const mockContext = {
      guildId: 'guild_test_2',
      channelId: `chan_test_guest_${Date.now()}`,
      user: {
        id: 'u_caller',
        username: 'caller',
        displayName: 'Caller',
      },
      guild: {
        id: 'guild_test_2',
        members: {
          cache: new Map(),
          search: async () => new Map(),
        },
        voiceStates: {
          cache: new Map(),
        },
      },
      replied: true,
      deferred: true,
      editReply: async (data: any) => {
        editedReplies.push(data);
        return data;
      },
      followUp: async (data: any) => {
        followUps.push(data);
        return data;
      },
    };

    try {
      await processTableScan(
        mockContext,
        null,
        'https://example.com/test-guest.png',
        'test-guest.png',
        false,
        null,
        null,
        200
      );

      assert.strictEqual(editedReplies.length > 0, true);
      assert.ok(editedReplies[0].content.includes('UnknownGuestA'));
      assert.ok(editedReplies[0].content.includes('UnknownGuestB'));

      const lastSession = await repo.getLastSession(mockContext.channelId);
      assert.ok(lastSession);
      const players = await repo.getSessionPlayers(lastSession.id);
      assert.strictEqual(players.length, 2);

      const guestA = players.find(p => p.display_name === 'UnknownGuestA');
      const guestB = players.find(p => p.display_name === 'UnknownGuestB');
      assert.ok(guestA);
      assert.ok(guestB);
      assert.strictEqual(guestA.cash_out, 400);
      assert.strictEqual(guestB.cash_out, 0);
    } finally {
      vision.setMockPokerScreenshotParser(null);
    }
  });
});

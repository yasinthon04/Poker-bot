import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import * as repo from '../src/database/repo';
import { verifyBankSlip, setMockSlipVerifier } from '../src/services/slip-verifier';
import { pokerCommand } from '../src/commands/poker';
import { profileCommand } from '../src/commands/profile';

describe('KhunThong Debt Tracking & Slip Verification Engine', () => {
  beforeEach(async () => {
    await repo.resetAllData();
    setMockSlipVerifier(null);
  });

  test('/poker has slip, remind, confirm-paid, and paid subcommands', () => {
    const json = pokerCommand.data.toJSON();
    const subcommands = json.options?.filter((o: any) => o.type === 1) || [];

    const slipSub = subcommands.find((s: any) => s.name === 'slip');
    assert.ok(slipSub, 'slip subcommand should exist');
    const imageOpt = slipSub.options?.find((o: any) => o.name === 'image');
    assert.ok(imageOpt, 'image option should exist in slip');
    assert.strictEqual(imageOpt.required, true);

    const remindSub = subcommands.find((s: any) => s.name === 'remind');
    assert.ok(remindSub, 'remind subcommand should exist');

    const paidSub = subcommands.find((s: any) => s.name === 'paid');
    assert.ok(paidSub, 'paid subcommand should exist');

    const confirmSub = subcommands.find((s: any) => s.name === 'confirm-paid');
    assert.ok(confirmSub, 'confirm-paid subcommand should exist');
  });

  test('/profile has set-name and clear-name subcommands', () => {
    const json = profileCommand.data.toJSON();
    const subcommands = json.options?.filter((o: any) => o.type === 1) || [];

    const setNameSub = subcommands.find((s: any) => s.name === 'set-name');
    assert.ok(setNameSub, 'set-name subcommand should exist');
    const nameOpt = setNameSub.options?.find((o: any) => o.name === 'name');
    assert.ok(nameOpt, 'name option should exist in set-name');
    assert.strictEqual(nameOpt.required, true);

    const clearNameSub = subcommands.find((s: any) => s.name === 'clear-name');
    assert.ok(clearNameSub, 'clear-name subcommand should exist');
  });

  test('Settlements lifecycle: pending -> paid -> revert to pending', async () => {
    await repo.upsertUser('user_debtor', 'DebtorUser', 'Debtor');
    await repo.upsertUser('user_creditor', 'CreditorUser', 'Creditor');

    // Create session and finalize with debt
    const session = await repo.createSession('guild_1', 'chan_1', 'user_creditor', 200);
    await repo.joinPlayer(session.id, 'user_debtor', 200);
    await repo.joinPlayer(session.id, 'user_creditor', 200);

    // Debtor loses (chips = 0), Creditor wins (chips = 400)
    await repo.finalizeSession(session.id, {
      user_debtor: 0,
      user_creditor: 400,
    });

    const settlements = await repo.getSessionSettlements(session.id);
    assert.strictEqual(settlements.length, 1);
    const debt = settlements[0];
    assert.strictEqual(debt.from_user_id, 'user_debtor');
    assert.strictEqual(debt.to_user_id, 'user_creditor');
    assert.strictEqual(debt.amount, 200);
    assert.strictEqual(debt.status, 'pending');

    // Query pending debts for user
    const pending = await repo.getPendingSettlementsForUser('user_debtor', 'chan_1');
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].amount, 200);

    // Mark paid with slip and ref
    const markSuccess = await repo.markSettlementPaid(debt.id, 'https://slip.url/1.png', 'REF123456');
    assert.strictEqual(markSuccess, true);

    // Verify status is now paid
    const updatedSettlements = await repo.getSessionSettlements(session.id);
    assert.strictEqual(updatedSettlements[0].status, 'paid');
    assert.strictEqual(updatedSettlements[0].slip_url, 'https://slip.url/1.png');
    assert.strictEqual(updatedSettlements[0].trans_ref, 'REF123456');

    // Trans ref is now registered as used
    const isUsed = await repo.isTransRefUsed('REF123456');
    assert.strictEqual(isUsed, true);

    // Pending debts should now be 0
    const pendingAfter = await repo.getPendingSettlementsForUser('user_debtor', 'chan_1');
    assert.strictEqual(pendingAfter.length, 0);

    // Revert paid status (e.g. Creditor says money didn't arrive)
    const revertSuccess = await repo.revertSettlementPaid(debt.id);
    assert.strictEqual(revertSuccess, true);

    const revertedSettlements = await repo.getSessionSettlements(session.id);
    assert.strictEqual(revertedSettlements[0].status, 'pending');
  });

  test('incrementSettlementReminder tracks poke reminder counts', async () => {
    const session = await repo.createSession('guild_1', 'chan_1', 'host_1', 200);
    await repo.joinPlayer(session.id, 'p1', 200);
    await repo.joinPlayer(session.id, 'p2', 200);
    await repo.finalizeSession(session.id, { p1: 0, p2: 400 });

    const count1 = await repo.incrementSettlementReminder(session.id);
    assert.strictEqual(count1, 1);

    const count2 = await repo.incrementSettlementReminder(session.id);
    assert.strictEqual(count2, 2);
  });

  test('verifyBankSlip validates amount, recipient, and duplicate slips with mock verifier', async () => {
    // 1. Success case
    setMockSlipVerifier(async (url, amount) => {
      return {
        success: true,
        isSlip: true,
        reason: 'สลิปถูกต้อง',
        data: {
          isBankSlip: true,
          transAmount: amount,
          bankName: 'KBANK',
          recipientPromptPay: '089-xxx-5678',
          recipientName: 'นาย สมชาย ใจดี',
          transRef: 'SLIP_REF_999',
        },
      };
    });

    const resValid = await verifyBankSlip('http://test.png', 200, '0891235678', 'สมชาย');
    assert.strictEqual(resValid.success, true);
    assert.strictEqual(resValid.isSlip, true);
    assert.strictEqual(resValid.data?.transAmount, 200);

    // 2. Reject: Amount is less than debt
    setMockSlipVerifier(async () => {
      return {
        success: false,
        isSlip: true,
        reason: 'ยอดเงินในสลิป (100฿) น้อยกว่ายอดหนี้ที่ต้องชำระ (200฿)',
        data: {
          isBankSlip: true,
          transAmount: 100,
        },
      };
    });

    const resLessAmount = await verifyBankSlip('http://test.png', 200);
    assert.strictEqual(resLessAmount.success, false);
    assert.strictEqual(resLessAmount.isSlip, true);
    assert.ok(resLessAmount.reason.includes('น้อยกว่า'));

    // 3. Reject: Non-slip image (meme / random photo)
    setMockSlipVerifier(async () => {
      return {
        success: false,
        isSlip: false,
        reason: 'รูปภาพนี้ไม่ใช่สลิปโอนเงินของธนาคาร',
        data: {
          isBankSlip: false,
        },
      };
    });

    const resMeme = await verifyBankSlip('http://meme.png', 200);
    assert.strictEqual(resMeme.success, false);
    assert.strictEqual(resMeme.isSlip, false);
  });

  test('verifyAndMatchSlip matches the correct debt when debtor owes multiple people', async () => {
    const mockDebts: any[] = [
      {
        id: 101,
        session_id: 1,
        from_user_id: 'debtor_1',
        to_user_id: 'creditor_chii',
        amount: 65,
        status: 'pending',
        to_name: 'Chii',
      },
      {
        id: 102,
        session_id: 1,
        from_user_id: 'debtor_1',
        to_user_id: 'creditor_ploy',
        amount: 35,
        status: 'pending',
        to_name: 'P.ploy',
      },
    ];

    // Mock slip for 35฿
    setMockSlipVerifier(async () => {
      return {
        success: true,
        isSlip: true,
        reason: 'สลิปถูกต้อง',
        data: {
          isBankSlip: true,
          transAmount: 35,
          bankName: 'KBANK',
          recipientName: 'นางสาว สุกัญญา ปรีสิทธิ์',
          transRef: 'REF35',
        },
      };
    });

    const { verifyAndMatchSlip } = await import('../src/services/slip-verifier');
    const res35 = await verifyAndMatchSlip('http://slip35.png', mockDebts);
    assert.strictEqual(res35.success, true);
    assert.strictEqual(res35.matchedDebt?.id, 102);
    assert.strictEqual(res35.matchedDebt?.to_user_id, 'creditor_ploy');
  });
});


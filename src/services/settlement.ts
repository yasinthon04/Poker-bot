export interface PlayerBalance {
  userId: string;
  name: string;
  buyIn: number;
  cashOut: number;
  net: number; // cashOut - buyIn (+ is profit, - is loss)
}

export interface SettlementTransaction {
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  amount: number;
}

export interface SettlementResult {
  isBalanced: boolean;
  totalBuyIn: number;
  totalCashOut: number;
  discrepancy: number; // totalCashOut - totalBuyIn
  transactions: SettlementTransaction[];
  players: PlayerBalance[];
}

/**
 * Calculates minimal cash flow transactions to settle all debts.
 * Solves the N-person zero-sum debt settlement problem using a greedy match approach.
 */
export function calculateSettlements(
  playerInputs: { userId: string; name: string; buyIn: number; cashOut: number }[]
): SettlementResult {
  const players: PlayerBalance[] = playerInputs.map(p => ({
    userId: p.userId,
    name: p.name,
    buyIn: Math.round(p.buyIn * 100) / 100,
    cashOut: Math.round(p.cashOut * 100) / 100,
    net: Math.round((p.cashOut - p.buyIn) * 100) / 100,
  }));

  const totalBuyIn = Math.round(players.reduce((sum, p) => sum + p.buyIn, 0) * 100) / 100;
  const totalCashOut = Math.round(players.reduce((sum, p) => sum + p.cashOut, 0) * 100) / 100;
  const discrepancy = Math.round((totalCashOut - totalBuyIn) * 100) / 100;

  // If there's an imbalance greater than 1 satang/cent, flag it
  const isBalanced = Math.abs(discrepancy) < 0.05;

  // Debtors: net < 0 (they owe money)
  // Creditors: net > 0 (they are owed money)
  const debtors = players
    .filter(p => p.net < -0.01)
    .map(p => ({ ...p, remainingDebt: -p.net }))
    .sort((a, b) => b.remainingDebt - a.remainingDebt);

  const creditors = players
    .filter(p => p.net > 0.01)
    .map(p => ({ ...p, remainingCredit: p.net }))
    .sort((a, b) => b.remainingCredit - a.remainingCredit);

  const transactions: SettlementTransaction[] = [];

  let dIdx = 0;
  let cIdx = 0;

  while (dIdx < debtors.length && cIdx < creditors.length) {
    const debtor = debtors[dIdx];
    const creditor = creditors[cIdx];

    const amount = Math.min(debtor.remainingDebt, creditor.remainingCredit);
    const roundedAmount = Math.round(amount * 100) / 100;

    if (roundedAmount > 0) {
      transactions.push({
        fromUserId: debtor.userId,
        fromName: debtor.name,
        toUserId: creditor.userId,
        toName: creditor.name,
        amount: roundedAmount,
      });
    }

    debtor.remainingDebt = Math.round((debtor.remainingDebt - roundedAmount) * 100) / 100;
    creditor.remainingCredit = Math.round((creditor.remainingCredit - roundedAmount) * 100) / 100;

    if (debtor.remainingDebt <= 0.01) {
      dIdx++;
    }
    if (creditor.remainingCredit <= 0.01) {
      cIdx++;
    }
  }

  return {
    isBalanced,
    totalBuyIn,
    totalCashOut,
    discrepancy,
    transactions,
    players: players.sort((a, b) => b.net - a.net), // Highest profit first
  };
}

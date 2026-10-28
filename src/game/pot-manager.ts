export interface Pot {
  id: number;
  amount: number;
  eligiblePlayerIds: string[];
}

export interface PlayerContribution {
  userId: string;
  amount: number;
  hasFolded: boolean;
}

/**
 * Calculates Main Pot and Side Pots from player contributions.
 * Accurately handles multiple all-ins, different stack tiers, and folded players.
 */
export function calculatePots(contributions: PlayerContribution[]): Pot[] {
  // Filter players who contributed anything > 0
  const activeContributors = contributions.filter(c => c.amount > 0);
  if (activeContributors.length === 0) {
    return [{ id: 0, amount: 0, eligiblePlayerIds: [] }];
  }

  // Get all unique contribution amounts (tiers) sorted ascending
  const uniqueAmounts = Array.from(new Set(activeContributors.map(c => c.amount))).sort((a, b) => a - b);

  const pots: Pot[] = [];
  let previousTierAmount = 0;
  let potIndex = 0;

  for (const tierAmount of uniqueAmounts) {
    const incrementalAmount = tierAmount - previousTierAmount;
    if (incrementalAmount <= 0) continue;

    let potChips = 0;
    const eligible: string[] = [];

    for (const c of activeContributors) {
      if (c.amount >= tierAmount) {
        potChips += incrementalAmount;
        if (!c.hasFolded) {
          eligible.push(c.userId);
        }
      } else if (c.amount > previousTierAmount) {
        potChips += c.amount - previousTierAmount;
        if (!c.hasFolded) {
          eligible.push(c.userId);
        }
      }
    }

    if (potChips > 0) {
      if (eligible.length > 0) {
        pots.push({
          id: potIndex++,
          amount: Math.round(potChips * 100) / 100,
          eligiblePlayerIds: eligible,
        });
      } else if (pots.length > 0) {
        // If everyone who reached this tier folded, merge chips into previous eligible pot
        pots[pots.length - 1].amount += Math.round(potChips * 100) / 100;
      } else {
        // Fallback for initial pot
        pots.push({
          id: potIndex++,
          amount: Math.round(potChips * 100) / 100,
          eligiblePlayerIds: [],
        });
      }
    }

    previousTierAmount = tierAmount;
  }

  return pots.length > 0 ? pots : [{ id: 0, amount: 0, eligiblePlayerIds: [] }];
}

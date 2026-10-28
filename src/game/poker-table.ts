import { Card, createDeck, shuffleDeck, cardToString } from './deck';
import { evaluateBestHand, EvaluatedHand, formatHandDescription } from './evaluator';
import { calculatePots, Pot, PlayerContribution } from './pot-manager';
import { decideBotAction, BotDifficulty } from './bot-ai';

export interface TablePlayer {
  userId: string;
  seatIndex: number;
  username: string;
  displayName: string;
  avatarUrl?: string;
  chips: number;
  initialBuyIn: number;
  totalBuyIn: number;
  currentRoundBet: number;
  totalHandBet: number;
  holeCards: Card[];
  isFolded: boolean;
  isAllIn: boolean;
  isBot: boolean;
  botDifficulty?: BotDifficulty;
  lastAction?: string;
  connected: boolean;
}

export type GamePhase =
  | 'waiting'
  | 'preflop'
  | 'flop'
  | 'turn'
  | 'river'
  | 'showdown'
  | 'hand_ended';

export interface HandWinnerResult {
  userId: string;
  name: string;
  potAmount: number;
  handDescription: string;
  cards: Card[];
}

export interface TableStateView {
  tableId: string;
  channelId: string;
  hostId: string;
  phase: GamePhase;
  handNumber: number;
  smallBlind: number;
  bigBlind: number;
  dealerSeat: number;
  currentTurnSeat: number | null;
  currentHighBet: number;
  minRaise: number;
  totalPot: number;
  pots: Pot[];
  communityCards: Card[];
  seats: (TablePlayerPublic | null)[];
  hasBots: boolean;
  handWinners?: HandWinnerResult[];
  lastActionMessage?: string;
}

export interface TablePlayerPublic {
  userId: string;
  seatIndex: number;
  username: string;
  displayName: string;
  avatarUrl?: string;
  chips: number;
  totalBuyIn: number;
  currentRoundBet: number;
  isFolded: boolean;
  isAllIn: boolean;
  isBot: boolean;
  lastAction?: string;
  connected: boolean;
  hasCards: boolean;
  holeCards?: Card[]; // Only visible if viewer is this player or during showdown
}

export class PokerTable {
  public tableId: string;
  public channelId: string;
  public hostId: string;
  public seats: (TablePlayer | null)[] = Array(9).fill(null);
  public phase: GamePhase = 'waiting';
  public handNumber: number = 0;
  public smallBlind: number = 10;
  public bigBlind: number = 20;
  public dealerSeat: number = 0;
  public currentTurnSeat: number | null = null;
  public currentHighBet: number = 0;
  public minRaise: number = 20;
  public deck: Card[] = [];
  public communityCards: Card[] = [];
  public pots: Pot[] = [];
  public lastActionMessage: string = '';
  public handWinners?: HandWinnerResult[];

  // Action timer
  private turnTimeout: NodeJS.Timeout | null = null;
  public onStateChanged?: () => void;
  public onHandFinished?: (summary: { winners: HandWinnerResult[]; hasBots: boolean }) => void;

  constructor(tableId: string, channelId: string, hostId: string, buyIn: number = 100) {
    this.tableId = tableId;
    this.channelId = channelId;
    this.hostId = hostId;
    this.smallBlind = Math.max(1, Math.round(buyIn * 0.05));
    this.bigBlind = this.smallBlind * 2;
    this.minRaise = this.bigBlind;
  }

  public get hasBots(): boolean {
    return this.seats.some(p => p !== null && p.isBot);
  }

  public get activePlayers(): TablePlayer[] {
    return this.seats.filter((p): p is TablePlayer => p !== null);
  }

  public get playersInHand(): TablePlayer[] {
    return this.seats.filter((p): p is TablePlayer => p !== null && !p.isFolded && p.chips + p.totalHandBet > 0);
  }

  /**
   * Sits a human player down at a seat.
   */
  public sitDown(
    seatIndex: number,
    user: { id: string; username: string; displayName: string; avatarUrl?: string },
    buyIn: number
  ): boolean {
    if (seatIndex < 0 || seatIndex >= 9) return false;
    if (this.seats[seatIndex] !== null) return false;

    // Check if player is already seated elsewhere
    const existingIndex = this.seats.findIndex(p => p?.userId === user.id);
    if (existingIndex !== -1) return false;

    this.seats[seatIndex] = {
      userId: user.id,
      seatIndex,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      chips: buyIn,
      initialBuyIn: buyIn,
      totalBuyIn: buyIn,
      currentRoundBet: 0,
      totalHandBet: 0,
      holeCards: [],
      isFolded: false,
      isAllIn: false,
      isBot: false,
      connected: true,
    };

    this.emitChange();
    this.checkAutoStart();
    return true;
  }

  /**
   * Adds an AI Bot player to a seat.
   */
  public addBot(
    seatIndex: number,
    name: string,
    difficulty: BotDifficulty = 'medium',
    chips: number = 200
  ): boolean {
    if (seatIndex < 0 || seatIndex >= 9) return false;
    if (this.seats[seatIndex] !== null) return false;

    const botId = `bot_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    this.seats[seatIndex] = {
      userId: botId,
      seatIndex,
      username: name,
      displayName: name,
      avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${botId}`,
      chips,
      initialBuyIn: chips,
      totalBuyIn: chips,
      currentRoundBet: 0,
      totalHandBet: 0,
      holeCards: [],
      isFolded: false,
      isAllIn: false,
      isBot: true,
      botDifficulty: difficulty,
      connected: true,
    };

    this.lastActionMessage = `🤖 เพิ่ม ${name} (${difficulty.toUpperCase()}) เข้าที่นั่งที่ ${seatIndex + 1}`;
    this.emitChange();
    this.checkAutoStart();
    return true;
  }

  /**
   * Removes a bot player from a seat.
   */
  public removeBot(seatIndex: number): boolean {
    if (seatIndex < 0 || seatIndex >= 9) return false;
    const player = this.seats[seatIndex];
    if (!player || !player.isBot) return false;

    this.seats[seatIndex] = null;
    this.lastActionMessage = `🗑️ นำ ${player.displayName} ออกจากโต๊ะ`;
    this.emitChange();
    return true;
  }

  /**
   * Stands a player up.
   */
  public standUp(userId: string): TablePlayer | null {
    const seatIndex = this.seats.findIndex(p => p?.userId === userId);
    if (seatIndex === -1) return null;
    const player = this.seats[seatIndex]!;
    this.seats[seatIndex] = null;

    if (this.currentTurnSeat === seatIndex) {
      this.advanceTurn();
    }

    this.emitChange();
    return player;
  }

  /**
   * Rebuys chips for a seated player.
   */
  public rebuy(userId: string, amount: number): boolean {
    const player = this.seats.find(p => p?.userId === userId);
    if (!player) return false;
    player.chips += amount;
    player.totalBuyIn += amount;
    this.emitChange();
    return true;
  }

  private checkAutoStart() {
    if (this.phase === 'waiting' && this.activePlayers.filter(p => p.chips > 0).length >= 2) {
      setTimeout(() => this.startHand(), 2000);
    }
  }

  /**
   * Starts a new poker hand.
   */
  public startHand(): boolean {
    const eligible = this.seats.filter(p => p !== null && p.chips > 0);
    if (eligible.length < 2) {
      this.phase = 'waiting';
      this.emitChange();
      return false;
    }

    this.clearTurnTimer();
    this.handNumber++;
    this.phase = 'preflop';
    this.communityCards = [];
    this.pots = [];
    this.handWinners = undefined;
    this.deck = shuffleDeck(createDeck());

    // Advance dealer button to next active player
    this.dealerSeat = this.findNextOccupiedSeat(this.dealerSeat);

    // Reset players for new hand
    for (const p of this.seats) {
      if (p) {
        p.currentRoundBet = 0;
        p.totalHandBet = 0;
        p.holeCards = [];
        p.isFolded = p.chips <= 0;
        p.isAllIn = false;
        p.lastAction = undefined;
      }
    }

    // Deal 2 hole cards to each active player
    for (let i = 0; i < 2; i++) {
      for (const p of this.seats) {
        if (p && !p.isFolded) {
          p.holeCards.push(this.deck.pop()!);
        }
      }
    }

    // Post Blinds
    const sbSeat = this.findNextActiveSeat(this.dealerSeat);
    const bbSeat = this.findNextActiveSeat(sbSeat);

    const sbPlayer = this.seats[sbSeat]!;
    const bbPlayer = this.seats[bbSeat]!;

    const sbAmount = Math.min(sbPlayer.chips, this.smallBlind);
    sbPlayer.chips -= sbAmount;
    sbPlayer.currentRoundBet = sbAmount;
    sbPlayer.totalHandBet = sbAmount;
    sbPlayer.lastAction = `SB ${sbAmount}฿`;
    if (sbPlayer.chips === 0) sbPlayer.isAllIn = true;

    const bbAmount = Math.min(bbPlayer.chips, this.bigBlind);
    bbPlayer.chips -= bbAmount;
    bbPlayer.currentRoundBet = bbAmount;
    bbPlayer.totalHandBet = bbAmount;
    bbPlayer.lastAction = `BB ${bbAmount}฿`;
    if (bbPlayer.chips === 0) bbPlayer.isAllIn = true;

    this.currentHighBet = bbAmount;
    this.minRaise = this.bigBlind;
    this.updatePots();

    // First to act preflop: Under The Gun (UTG) = after BB
    this.currentTurnSeat = this.findNextActiveSeat(bbSeat);
    this.lastActionMessage = `🃏 เริ่มแฮนด์ #${this.handNumber} (SB: ${sbAmount}฿, BB: ${bbAmount}฿)`;

    this.emitChange();
    this.checkBotTurn();
    return true;
  }

  /**
   * Handles player action (fold, check, call, bet, raise, all_in).
   */
  public handleAction(
    userId: string,
    action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in',
    amount: number = 0
  ): boolean {
    if (this.currentTurnSeat === null) return false;
    const player = this.seats[this.currentTurnSeat];
    if (!player || player.userId !== userId) return false;

    this.clearTurnTimer();

    const toCall = this.currentHighBet - player.currentRoundBet;

    switch (action) {
      case 'fold': {
        player.isFolded = true;
        player.lastAction = 'Fold';
        this.lastActionMessage = `❌ ${player.displayName} หมอบ (Fold)`;
        break;
      }
      case 'check': {
        if (toCall > 0) return false; // Cannot check if there's a bet to call
        player.lastAction = 'Check';
        this.lastActionMessage = `⚪ ${player.displayName} เคาะ (Check)`;
        break;
      }
      case 'call': {
        const callAmount = Math.min(player.chips, toCall);
        player.chips -= callAmount;
        player.currentRoundBet += callAmount;
        player.totalHandBet += callAmount;
        if (player.chips === 0) player.isAllIn = true;
        player.lastAction = `Call ${callAmount}฿`;
        this.lastActionMessage = `🔵 ${player.displayName} ตาม (Call) ${callAmount.toLocaleString()}฿`;
        break;
      }
      case 'bet':
      case 'raise': {
        const totalTargetBet = Math.max(this.currentHighBet + this.minRaise, amount);
        const addedChips = totalTargetBet - player.currentRoundBet;
        const actualAdd = Math.min(player.chips, addedChips);

        player.chips -= actualAdd;
        player.currentRoundBet += actualAdd;
        player.totalHandBet += actualAdd;

        const raiseDifference = player.currentRoundBet - this.currentHighBet;
        if (raiseDifference > 0) {
          this.minRaise = Math.max(this.bigBlind, raiseDifference);
          this.currentHighBet = player.currentRoundBet;
        }

        if (player.chips === 0) player.isAllIn = true;
        player.lastAction = `${action.toUpperCase()} ${player.currentRoundBet}฿`;
        this.lastActionMessage = `🟢 ${player.displayName} ${action === 'bet' ? 'เดิมพัน (Bet)' : 'เกทับ (Raise)'} เป็น ${player.currentRoundBet.toLocaleString()}฿`;
        break;
      }
      case 'all_in': {
        const allInChips = player.chips;
        player.chips = 0;
        player.currentRoundBet += allInChips;
        player.totalHandBet += allInChips;
        player.isAllIn = true;

        if (player.currentRoundBet > this.currentHighBet) {
          this.minRaise = Math.max(this.bigBlind, player.currentRoundBet - this.currentHighBet);
          this.currentHighBet = player.currentRoundBet;
        }

        player.lastAction = `All-In (${allInChips}฿)`;
        this.lastActionMessage = `🔥 ${player.displayName} ALL-IN หมดหน้าตัก ${allInChips.toLocaleString()}฿!`;
        break;
      }
    }

    this.updatePots();

    // Check if only 1 player remains in hand
    const remainingInHand = this.seats.filter(p => p !== null && !p.isFolded);
    if (remainingInHand.length === 1) {
      this.awardPotToSingleWinner(remainingInHand[0]!);
      return true;
    }

    // Check if betting round is complete
    if (this.isBettingRoundComplete()) {
      this.advancePhase();
    } else {
      this.advanceTurn();
    }

    return true;
  }

  private isBettingRoundComplete(): boolean {
    const active = this.seats.filter((p): p is TablePlayer => p !== null && !p.isFolded);
    const nonAllIn = active.filter(p => !p.isAllIn);

    if (nonAllIn.length <= 1) {
      return active.every(p => p.currentRoundBet === this.currentHighBet || p.isAllIn);
    }

    return active.every(p => (p.currentRoundBet === this.currentHighBet || p.isAllIn) && p.lastAction !== undefined);
  }

  private advanceTurn() {
    if (this.currentTurnSeat === null) return;
    this.currentTurnSeat = this.findNextActiveSeat(this.currentTurnSeat);
    this.emitChange();
    this.checkBotTurn();
  }

  private advancePhase() {
    // Reset round bets
    for (const p of this.seats) {
      if (p) {
        p.currentRoundBet = 0;
        if (!p.isFolded && !p.isAllIn) p.lastAction = undefined;
      }
    }
    this.currentHighBet = 0;
    this.minRaise = this.bigBlind;

    switch (this.phase) {
      case 'preflop': {
        this.phase = 'flop';
        this.deck.pop(); // Burn card
        this.communityCards.push(this.deck.pop()!, this.deck.pop()!, this.deck.pop()!);
        this.lastActionMessage = `🎴 เปิดไพ่ Flop: ${this.communityCards.map(cardToString).join(' ')}`;
        break;
      }
      case 'flop': {
        this.phase = 'turn';
        this.deck.pop(); // Burn
        this.communityCards.push(this.deck.pop()!);
        this.lastActionMessage = `🎴 เปิดไพ่ Turn: ${this.communityCards.map(cardToString).join(' ')}`;
        break;
      }
      case 'turn': {
        this.phase = 'river';
        this.deck.pop(); // Burn
        this.communityCards.push(this.deck.pop()!);
        this.lastActionMessage = `🎴 เปิดไพ่ River: ${this.communityCards.map(cardToString).join(' ')}`;
        break;
      }
      case 'river': {
        this.phase = 'showdown';
        this.resolveShowdown();
        return;
      }
    }

    // Check if all remaining players are all-in (auto fast forward)
    const active = this.seats.filter((p): p is TablePlayer => p !== null && !p.isFolded);
    const nonAllIn = active.filter(p => !p.isAllIn);
    if (nonAllIn.length <= 1) {
      this.emitChange();
      setTimeout(() => this.advancePhase(), 1500);
      return;
    }

    // Next action starts from first active player to the left of dealer
    this.currentTurnSeat = this.findNextActiveSeat(this.dealerSeat);
    this.emitChange();
    this.checkBotTurn();
  }

  private resolveShowdown() {
    this.clearTurnTimer();
    this.phase = 'showdown';

    const activePlayers = this.seats.filter((p): p is TablePlayer => p !== null && !p.isFolded);
    const evaluatedHands = new Map<string, EvaluatedHand>();

    for (const p of activePlayers) {
      const fullHand = [...p.holeCards, ...this.communityCards];
      const evaluated = evaluateBestHand(fullHand);
      evaluatedHands.set(p.userId, evaluated);
    }

    const winnersMap = new Map<string, { player: TablePlayer; amount: number; desc: string }>();

    // Resolve each pot (Main pot, then side pots)
    for (const pot of this.pots) {
      if (pot.amount <= 0) continue;
      const contenders = activePlayers.filter(p => pot.eligiblePlayerIds.includes(p.userId));
      if (contenders.length === 0) continue;

      let topScore = -1;
      let potWinners: TablePlayer[] = [];

      for (const c of contenders) {
        const ev = evaluatedHands.get(c.userId)!;
        if (ev.score > topScore) {
          topScore = ev.score;
          potWinners = [c];
        } else if (ev.score === topScore) {
          potWinners.push(c);
        }
      }

      const splitShare = Math.round((pot.amount / potWinners.length) * 100) / 100;
      for (const w of potWinners) {
        w.chips += splitShare;
        const ev = evaluatedHands.get(w.userId)!;
        const current = winnersMap.get(w.userId) || { player: w, amount: 0, desc: ev.nameTh };
        current.amount += splitShare;
        winnersMap.set(w.userId, current);
      }
    }

    this.handWinners = Array.from(winnersMap.values()).map(w => ({
      userId: w.player.userId,
      name: w.player.displayName,
      potAmount: w.amount,
      handDescription: w.desc,
      cards: w.player.holeCards,
    }));

    const winnerNames = this.handWinners.map(w => `${w.name} (+${w.potAmount.toLocaleString()}฿)`).join(', ');
    this.lastActionMessage = `🏆 Showdown: ผู้ชนะได้แก่ ${winnerNames}`;

    this.emitChange();

    if (this.onHandFinished) {
      this.onHandFinished({ winners: this.handWinners, hasBots: this.hasBots });
    }

    // Auto start next hand after 6 seconds
    setTimeout(() => {
      this.phase = 'hand_ended';
      this.checkAutoStart();
    }, 6000);
  }

  private awardPotToSingleWinner(winner: TablePlayer) {
    this.clearTurnTimer();
    const totalPot = this.pots.reduce((sum, p) => sum + p.amount, 0);
    winner.chips += totalPot;

    this.handWinners = [
      {
        userId: winner.userId,
        name: winner.displayName,
        potAmount: totalPot,
        handDescription: 'ทุกคนหมอบ (All Others Folded)',
        cards: winner.holeCards,
      },
    ];

    this.lastActionMessage = `🏆 ${winner.displayName} ชนะ Pot ${totalPot.toLocaleString()}฿ (ทุกคนหมอบ)`;
    this.phase = 'hand_ended';
    this.emitChange();

    if (this.onHandFinished) {
      this.onHandFinished({ winners: this.handWinners, hasBots: this.hasBots });
    }

    setTimeout(() => this.checkAutoStart(), 4000);
  }

  private updatePots() {
    const contributions: PlayerContribution[] = this.seats
      .filter((p): p is TablePlayer => p !== null)
      .map(p => ({
        userId: p.userId,
        amount: p.totalHandBet,
        hasFolded: p.isFolded,
      }));
    this.pots = calculatePots(contributions);
  }

  private checkBotTurn() {
    if (this.currentTurnSeat === null) return;
    const player = this.seats[this.currentTurnSeat];
    if (!player || player.isFolded || player.isAllIn) return;

    if (player.isBot) {
      // Human-like delay (1.5 - 2.5s)
      const delay = 1500 + Math.random() * 1000;
      setTimeout(() => {
        if (this.currentTurnSeat === player.seatIndex && this.phase !== 'showdown') {
          const decision = decideBotAction({
            botCards: player.holeCards,
            communityCards: this.communityCards,
            botChips: player.chips,
            botCurrentBet: player.currentRoundBet,
            currentHighBet: this.currentHighBet,
            minRaiseAmount: this.minRaise,
            potSize: this.pots.reduce((sum, p) => sum + p.amount, 0),
            difficulty: player.botDifficulty || 'medium',
          });

          this.handleAction(player.userId, decision.action, decision.amount);
        }
      }, delay);
    } else {
      // 30-second action timer for human player (auto-check or auto-fold)
      this.turnTimeout = setTimeout(() => {
        if (this.currentTurnSeat === player.seatIndex) {
          const toCall = this.currentHighBet - player.currentRoundBet;
          if (toCall === 0) {
            this.handleAction(player.userId, 'check');
          } else {
            this.handleAction(player.userId, 'fold');
          }
        }
      }, 30000);
    }
  }

  private clearTurnTimer() {
    if (this.turnTimeout) {
      clearTimeout(this.turnTimeout);
      this.turnTimeout = null;
    }
  }

  private findNextOccupiedSeat(startIndex: number): number {
    for (let i = 1; i <= 9; i++) {
      const idx = (startIndex + i) % 9;
      if (this.seats[idx] !== null && this.seats[idx]!.chips > 0) {
        return idx;
      }
    }
    return startIndex;
  }

  private findNextActiveSeat(startIndex: number): number {
    for (let i = 1; i <= 9; i++) {
      const idx = (startIndex + i) % 9;
      const p = this.seats[idx];
      if (p !== null && !p.isFolded && !p.isAllIn && p.chips > 0) {
        return idx;
      }
    }
    return startIndex;
  }

  /**
   * Generates a filtered view of the table for a specific viewer (obfuscating opponents' hole cards).
   */
  public getPublicState(viewerUserId?: string): TableStateView {
    const isShowdown = this.phase === 'showdown';

    return {
      tableId: this.tableId,
      channelId: this.channelId,
      hostId: this.hostId,
      phase: this.phase,
      handNumber: this.handNumber,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      dealerSeat: this.dealerSeat,
      currentTurnSeat: this.currentTurnSeat,
      currentHighBet: this.currentHighBet,
      minRaise: this.minRaise,
      totalPot: this.pots.reduce((s, p) => s + p.amount, 0),
      pots: this.pots,
      communityCards: this.communityCards,
      hasBots: this.hasBots,
      handWinners: this.handWinners,
      lastActionMessage: this.lastActionMessage,
      seats: this.seats.map(p => {
        if (!p) return null;
        const canSeeHoleCards = isShowdown || (viewerUserId && p.userId === viewerUserId);
        return {
          userId: p.userId,
          seatIndex: p.seatIndex,
          username: p.username,
          displayName: p.displayName,
          avatarUrl: p.avatarUrl,
          chips: p.chips,
          totalBuyIn: p.totalBuyIn,
          currentRoundBet: p.currentRoundBet,
          isFolded: p.isFolded,
          isAllIn: p.isAllIn,
          isBot: p.isBot,
          lastAction: p.lastAction,
          connected: p.connected,
          hasCards: p.holeCards.length > 0,
          holeCards: canSeeHoleCards ? p.holeCards : undefined,
        };
      }),
    };
  }

  private emitChange() {
    if (this.onStateChanged) {
      this.onStateChanged();
    }
  }
}

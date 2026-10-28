import { Card, createDeck, shuffleDeck, cardToString } from './deck';
import { evaluateBestHand, EvaluatedHand } from './evaluator';
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
  hasActedThisRound: boolean;
  connected: boolean;
  isEarlyLeaver?: boolean;
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

export interface TableEvent {
  type: 'deal' | 'check' | 'call' | 'raise' | 'fold' | 'board_deal' | 'showdown' | 'rebuy' | 'early_leave';
  userId?: string;
  amount?: number;
  phase?: GamePhase;
  timestamp: number;
}

export interface TableStateView {
  tableId: string;
  channelId: string;
  hostId: string;
  phase: GamePhase;
  handNumber: number;
  defaultBuyIn: number;
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
  turnStartedAt: number;
  turnDuration: number; // in seconds
  lastEvent?: TableEvent;
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
  holeCards?: Card[];
}

export class PokerTable {
  public tableId: string;
  public channelId: string;
  public hostId: string;
  public seats: (TablePlayer | null)[] = Array(9).fill(null);
  public phase: GamePhase = 'waiting';
  public handNumber: number = 0;
  public defaultBuyIn: number = 200;
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
  public lastEvent?: TableEvent;

  // Turn Timer
  public turnDuration: number = 20; // in seconds (configurable)
  public turnStartedAt: number = Date.now();
  private turnTimeout: NodeJS.Timeout | null = null;

  public onStateChanged?: () => void;
  public onHandFinished?: (summary: { winners: HandWinnerResult[]; hasBots: boolean }) => void;

  constructor(tableId: string, channelId: string, hostId: string, buyIn: number = 200) {
    this.tableId = tableId;
    this.channelId = channelId;
    this.hostId = hostId;
    this.defaultBuyIn = buyIn > 0 ? buyIn : 200;
    this.smallBlind = Math.max(1, Math.round(this.defaultBuyIn * 0.05));
    this.bigBlind = this.smallBlind * 2;
    this.minRaise = this.bigBlind;
  }

  public updateSettings(settings: {
    smallBlind?: number;
    bigBlind?: number;
    defaultBuyIn?: number;
    turnDuration?: number;
  }): boolean {
    let changed = false;

    if (settings.defaultBuyIn !== undefined && Number(settings.defaultBuyIn) > 0) {
      this.defaultBuyIn = Math.round(Number(settings.defaultBuyIn));
      changed = true;
    }

    if (settings.smallBlind !== undefined && Number(settings.smallBlind) > 0) {
      this.smallBlind = Math.round(Number(settings.smallBlind));
      changed = true;
    }

    if (settings.bigBlind !== undefined && Number(settings.bigBlind) > 0) {
      this.bigBlind = Math.round(Number(settings.bigBlind));
      changed = true;
    } else if (settings.smallBlind !== undefined && Number(settings.smallBlind) > 0) {
      this.bigBlind = this.smallBlind * 2;
      changed = true;
    }

    if (settings.turnDuration !== undefined && Number(settings.turnDuration) >= 5) {
      this.turnDuration = Math.round(Number(settings.turnDuration));
      changed = true;
    }

    if (this.phase === 'waiting' || this.phase === 'hand_ended') {
      this.minRaise = this.bigBlind;
    }

    if (changed) {
      this.lastActionMessage = `⚙️ ปรับการตั้งค่าโต๊ะ: Blinds ${this.smallBlind}/${this.bigBlind}฿ • Buy-in ${this.defaultBuyIn}฿ • เวลา ${this.turnDuration}s`;
      this.emitChange();
    }

    return changed;
  }

  public get hasBots(): boolean {
    return this.seats.some(p => p !== null && p.isBot);
  }

  public get activePlayers(): TablePlayer[] {
    return this.seats.filter((p): p is TablePlayer => p !== null && !p.isEarlyLeaver);
  }

  public get seatedPlayers(): TablePlayer[] {
    return this.seats.filter((p): p is TablePlayer => p !== null);
  }

  public sitDown(
    seatIndex: number,
    user: { id: string; username: string; displayName: string; avatarUrl?: string },
    buyIn?: number
  ): boolean {
    if (seatIndex < 0 || seatIndex >= 9) return false;
    if (this.seats[seatIndex] !== null) return false;

    // Check if player is already seated
    const existingIndex = this.seats.findIndex(p => p?.userId === user.id);
    if (existingIndex !== -1) return false;

    const actualBuyIn = buyIn && buyIn > 0 ? buyIn : this.defaultBuyIn;

    this.seats[seatIndex] = {
      userId: user.id,
      seatIndex,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      chips: actualBuyIn,
      initialBuyIn: actualBuyIn,
      totalBuyIn: actualBuyIn,
      currentRoundBet: 0,
      totalHandBet: 0,
      holeCards: [],
      isFolded: false,
      isAllIn: false,
      isBot: false,
      hasActedThisRound: false,
      connected: true,
    };

    this.emitChange();
    this.checkAutoStart();
    return true;
  }

  public addBot(
    seatIndex: number,
    name: string,
    difficulty: BotDifficulty = 'medium',
    chips?: number
  ): boolean {
    if (seatIndex < 0 || seatIndex >= 9) return false;
    if (this.seats[seatIndex] !== null) return false;

    const actualChips = chips && chips > 0 ? chips : (this.defaultBuyIn * 2 || 200);
    const botId = `bot_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    this.seats[seatIndex] = {
      userId: botId,
      seatIndex,
      username: name,
      displayName: name,
      avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${botId}`,
      chips: actualChips,
      initialBuyIn: actualChips,
      totalBuyIn: actualChips,
      currentRoundBet: 0,
      totalHandBet: 0,
      holeCards: [],
      isFolded: false,
      isAllIn: false,
      isBot: true,
      botDifficulty: difficulty,
      hasActedThisRound: false,
      connected: true,
    };

    this.lastActionMessage = `🤖 เพิ่ม ${name} (${difficulty.toUpperCase()}) เข้าที่นั่งที่ ${seatIndex + 1}`;
    this.emitChange();
    this.checkAutoStart();
    return true;
  }

  public removeBot(seatIndex: number): boolean {
    if (seatIndex < 0 || seatIndex >= 9) return false;
    const player = this.seats[seatIndex];
    if (!player || !player.isBot) return false;

    this.seats[seatIndex] = null;
    this.lastActionMessage = `🗑️ นำ ${player.displayName} ออกจากโต๊ะ`;
    this.emitChange();
    return true;
  }

  public updatePlayerProfile(userId: string, displayName: string, avatarUrl?: string): boolean {
    const player = this.seats.find(p => p?.userId === userId);
    if (!player) return false;
    player.displayName = displayName;
    if (avatarUrl) player.avatarUrl = avatarUrl;
    this.emitChange();
    return true;
  }

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

  public earlyLeave(userId: string, chips: number): boolean {
    const player = this.seats.find(p => p?.userId === userId);
    if (!player) return false;

    player.chips = chips;
    player.isFolded = true;
    player.isEarlyLeaver = true;
    this.lastActionMessage = `🏃 ${player.displayName} ขอออกก่อน (ล็อคชิป ${chips}฿)`;
    this.lastEvent = { type: 'early_leave', userId, amount: chips, timestamp: Date.now() };

    if (this.currentTurnSeat === player.seatIndex) {
      this.advanceTurn();
    }

    this.emitChange();
    return true;
  }

  public rebuy(userId: string, amount: number): boolean {
    const player = this.seats.find(p => p?.userId === userId);
    if (!player) return false;
    player.chips += amount;
    player.totalBuyIn += amount;
    player.isFolded = false;
    player.isAllIn = false;
    this.lastActionMessage = `💰 ${player.displayName} เติมชิป (Rebuy) +${amount}฿`;
    this.lastEvent = { type: 'rebuy', userId, amount, timestamp: Date.now() };
    this.emitChange();
    this.checkAutoStart();
    return true;
  }

  public checkAutoStart() {
    if (this.phase !== 'waiting' && this.phase !== 'hand_ended' && this.phase !== 'showdown') {
      return;
    }

    // Auto-reload bots that have 0 chips so solo testing never stops
    for (const p of this.seats) {
      if (p && p.isBot && p.chips <= 0) {
        const reloadAmount = p.initialBuyIn || 200;
        p.chips = reloadAmount;
        p.totalBuyIn += reloadAmount;
        p.isFolded = false;
        p.isAllIn = false;
      }
    }

    const eligible = this.activePlayers.filter(p => p.chips > 0);
    if (eligible.length >= 2) {
      if (this.phase === 'waiting') {
        setTimeout(() => {
          if (this.phase === 'waiting' && this.activePlayers.filter(p => p.chips > 0).length >= 2) {
            this.startHand();
          }
        }, 1200);
      } else {
        // Hand just finished (showdown or all others folded), start next hand
        this.startHand();
      }
    } else {
      this.phase = 'waiting';
      this.currentTurnSeat = null;
      this.lastActionMessage = 'รอผู้เล่นอย่างน้อย 2 คนที่มีชิปเพื่อเริ่มแฮนด์ใหม่...';
      this.emitChange();
    }
  }

  public startHand(): boolean {
    const eligible = this.activePlayers.filter(p => p.chips > 0);
    if (eligible.length < 2) {
      this.phase = 'waiting';
      this.currentTurnSeat = null;
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

    // Advance dealer button only after the first hand
    if (this.handNumber > 1) {
      this.dealerSeat = this.findNextOccupiedSeat(this.dealerSeat);
    }

    // Reset players for new hand
    for (const p of this.seats) {
      if (p) {
        p.currentRoundBet = 0;
        p.totalHandBet = 0;
        p.holeCards = [];
        p.isFolded = p.chips <= 0 || !!p.isEarlyLeaver;
        p.isAllIn = false;
        p.lastAction = undefined;
        p.hasActedThisRound = false;
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

    // Determine Blinds and Action Order based on player count (Heads-up vs 3+ players)
    const activeSeats = this.seats
      .map((p, idx) => (p && !p.isFolded ? idx : -1))
      .filter(idx => idx !== -1);

    let sbSeat: number;
    let bbSeat: number;

    if (activeSeats.length === 2) {
      // HEADS-UP RULES:
      // Dealer is Small Blind!
      // Other player is Big Blind!
      sbSeat = this.dealerSeat;
      bbSeat = activeSeats.find(s => s !== this.dealerSeat)!;
      // Preflop: SB (Dealer) acts first!
      this.currentTurnSeat = sbSeat;
    } else {
      // 3+ PLAYERS RULES:
      sbSeat = this.findNextActiveSeat(this.dealerSeat);
      bbSeat = this.findNextActiveSeat(sbSeat);
      // Preflop: UTG (left of BB) acts first!
      this.currentTurnSeat = this.findNextActiveSeat(bbSeat);
    }

    const sbPlayer = this.seats[sbSeat]!;
    const bbPlayer = this.seats[bbSeat]!;

    const sbAmount = Math.min(sbPlayer.chips, this.smallBlind);
    sbPlayer.chips -= sbAmount;
    sbPlayer.currentRoundBet = sbAmount;
    sbPlayer.totalHandBet = sbAmount;
    sbPlayer.lastAction = `SB ${sbAmount}฿`;
    sbPlayer.hasActedThisRound = false; // Must still act if raised
    if (sbPlayer.chips === 0) sbPlayer.isAllIn = true;

    const bbAmount = Math.min(bbPlayer.chips, this.bigBlind);
    bbPlayer.chips -= bbAmount;
    bbPlayer.currentRoundBet = bbAmount;
    bbPlayer.totalHandBet = bbAmount;
    bbPlayer.lastAction = `BB ${bbAmount}฿`;
    // CRITICAL POKER RULE: Big blind HAS NOT acted yet (retains option to check/raise if no one raises)
    bbPlayer.hasActedThisRound = false;
    if (bbPlayer.chips === 0) bbPlayer.isAllIn = true;

    this.currentHighBet = Math.max(sbAmount, bbAmount);
    this.minRaise = this.bigBlind;
    this.updatePots();

    this.turnStartedAt = Date.now();
    this.lastActionMessage = `🃏 เริ่มแฮนด์ #${this.handNumber} (SB: ${sbAmount}฿, BB: ${bbAmount}฿)`;
    this.lastEvent = { type: 'deal', timestamp: Date.now() };

    this.emitChange();
    this.checkBotTurn();
    return true;
  }

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
        player.hasActedThisRound = true;
        this.lastActionMessage = `❌ ${player.displayName} หมอบ (Fold)`;
        break;
      }
      case 'check': {
        if (toCall > 0) return false; // Cannot check if facing a bet
        player.lastAction = 'Check';
        player.hasActedThisRound = true;
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
        player.hasActedThisRound = true;
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

          // When a raise occurs, all other active players MUST react again!
          for (const other of this.seats) {
            if (other && other.userId !== player.userId && !other.isFolded && !other.isAllIn) {
              other.hasActedThisRound = false;
            }
          }
        }

        if (player.chips === 0) player.isAllIn = true;
        player.lastAction = `${action.toUpperCase()} ${player.currentRoundBet}฿`;
        player.hasActedThisRound = true;
        this.lastActionMessage = `🟢 ${player.displayName} ${action === 'bet' ? 'เดิมพัน (Bet)' : 'เกทับ (Raise)'} เป็น ${player.currentRoundBet.toLocaleString()}฿`;
        break;
      }
      case 'all_in': {
        const allInChips = player.chips;
        player.chips = 0;
        player.currentRoundBet += allInChips;
        player.totalHandBet += allInChips;
        player.isAllIn = true;
        player.hasActedThisRound = true;

        if (player.currentRoundBet > this.currentHighBet) {
          const raiseDiff = player.currentRoundBet - this.currentHighBet;
          if (raiseDiff >= this.minRaise) {
            this.minRaise = raiseDiff;
          }
          this.currentHighBet = player.currentRoundBet;

          // Full raise reopens action
          for (const other of this.seats) {
            if (other && other.userId !== player.userId && !other.isFolded && !other.isAllIn) {
              other.hasActedThisRound = false;
            }
          }
        }

        player.lastAction = `All-In (${allInChips}฿)`;
        this.lastActionMessage = `🔥 ${player.displayName} ALL-IN หมดหน้าตัก ${allInChips.toLocaleString()}฿!`;
        break;
      }
    }

    this.updatePots();
    const eventType = (action === 'bet' || action === 'all_in') ? 'raise' : action;
    this.lastEvent = { type: eventType, userId, amount: player.currentRoundBet, timestamp: Date.now() };

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

  public isBettingRoundComplete(): boolean {
    const active = this.seats.filter((p): p is TablePlayer => p !== null && !p.isFolded);
    const nonAllIn = active.filter(p => !p.isAllIn);

    if (nonAllIn.length <= 1) {
      // 0 or 1 player left with chips to bet:
      // If remaining players matched the bet or are all in, round is complete!
      return active.every(p => p.currentRoundBet === this.currentHighBet || p.isAllIn);
    }

    // Standard betting round: every active non-all-in player must have acted AND matched high bet
    return active.every(p => p.isAllIn || (p.hasActedThisRound && p.currentRoundBet === this.currentHighBet));
  }

  private advanceTurn() {
    if (this.currentTurnSeat === null) return;
    this.currentTurnSeat = this.findNextActiveSeat(this.currentTurnSeat);
    this.turnStartedAt = Date.now();
    this.emitChange();
    this.checkBotTurn();
  }

  private advancePhase() {
    // Reset round bets and action flags for next round
    for (const p of this.seats) {
      if (p) {
        p.currentRoundBet = 0;
        p.hasActedThisRound = false;
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

    this.lastEvent = { type: 'board_deal', phase: this.phase, timestamp: Date.now() };

    // Fast forward if all remaining non-folded players are all-in
    const active = this.seats.filter((p): p is TablePlayer => p !== null && !p.isFolded);
    const nonAllIn = active.filter(p => !p.isAllIn);
    if (nonAllIn.length <= 1) {
      this.emitChange();
      setTimeout(() => this.advancePhase(), 1500).unref?.();
      return;
    }

    // Action starts left of dealer button
    this.currentTurnSeat = this.findNextActiveSeat(this.dealerSeat);
    this.turnStartedAt = Date.now();
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

    // Distribute each pot (Main pot, then side pots)
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

      const splitShare = Math.floor((pot.amount / potWinners.length) * 100) / 100;
      let remainder = Math.round((pot.amount - splitShare * potWinners.length) * 100) / 100;

      for (let i = 0; i < potWinners.length; i++) {
        const w = potWinners[i];
        let winAmount = splitShare;
        if (remainder > 0) {
          winAmount += 0.01;
          remainder = Math.round((remainder - 0.01) * 100) / 100;
        }

        w.chips += winAmount;
        const ev = evaluatedHands.get(w.userId)!;
        const current = winnersMap.get(w.userId) || { player: w, amount: 0, desc: ev.nameTh };
        current.amount += winAmount;
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
    this.lastEvent = { type: 'showdown', timestamp: Date.now() };

    this.emitChange();

    if (this.onHandFinished) {
      this.onHandFinished({ winners: this.handWinners, hasBots: this.hasBots });
    }

    // Auto-advance to next hand after 3.0 seconds
    setTimeout(() => {
      this.phase = 'hand_ended';
      this.checkAutoStart();
    }, 3000);
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
    this.lastEvent = { type: 'showdown', timestamp: Date.now() };
    this.phase = 'hand_ended';
    this.emitChange();

    if (this.onHandFinished) {
      this.onHandFinished({ winners: this.handWinners, hasBots: this.hasBots });
    }

    // Auto-advance to next hand after 2.5 seconds
    setTimeout(() => this.checkAutoStart(), 2500);
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
      // Humanized delay: 1.5 - 2.5s
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
      }, delay).unref?.();
    } else {
      // 20-second turn countdown timer for human
      this.turnStartedAt = Date.now();
      this.turnTimeout = setTimeout(() => {
        if (this.currentTurnSeat === player.seatIndex) {
          const toCall = this.currentHighBet - player.currentRoundBet;
          if (toCall === 0) {
            this.handleAction(player.userId, 'check');
          } else {
            this.handleAction(player.userId, 'fold');
          }
        }
      }, this.turnDuration * 1000);
      this.turnTimeout.unref?.();
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
      const p = this.seats[idx];
      if (p !== null && !p.isEarlyLeaver && p.chips > 0) {
        return idx;
      }
    }
    return startIndex;
  }

  private findNextActiveSeat(startIndex: number): number {
    for (let i = 1; i <= 9; i++) {
      const idx = (startIndex + i) % 9;
      const p = this.seats[idx];
      if (p !== null && !p.isFolded && !p.isAllIn && !p.isEarlyLeaver && p.chips > 0) {
        return idx;
      }
    }
    return startIndex;
  }

  public getPublicState(viewerUserId?: string): TableStateView {
    const isShowdown = this.phase === 'showdown';

    return {
      tableId: this.tableId,
      channelId: this.channelId,
      hostId: this.hostId,
      phase: this.phase,
      handNumber: this.handNumber,
      defaultBuyIn: this.defaultBuyIn,
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
      turnStartedAt: this.turnStartedAt,
      turnDuration: this.turnDuration,
      lastEvent: this.lastEvent,
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

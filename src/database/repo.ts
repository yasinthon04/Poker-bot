import { getMemoryDb, persistDb, UserRecord, SessionRecord } from './db';
import { calculateSettlements, SettlementResult } from '../services/settlement';

export type UserRow = UserRecord;
export type SessionRow = SessionRecord;

export interface SessionPlayerRow {
  id: number;
  session_id: number;
  user_id: string;
  buy_in: number;
  cash_out: number | null;
  status: 'playing' | 'left';
  left_at: string | null;
  created_at: string;
  username: string;
  display_name: string | null;
  promptpay: string | null;
}

export interface UserStats {
  gamesPlayed: number;
  totalBuyIn: number;
  totalCashOut: number;
  totalProfit: number;
  wins: number;
  losses: number;
  winRate: number;
  biggestWin: number;
  biggestLoss: number;
}

export interface RankedPlayerStats {
  userId: string;
  username: string;
  displayName: string | null;
  gamesPlayed: number;
  totalBuyIn: number;
  totalCashOut: number;
  totalProfit: number;
  winRate: number;
}

// User Operations
export async function upsertUser(id: string, username: string, displayName?: string | null): Promise<void> {
  const db = getMemoryDb();
  const existing = db.users[id];
  db.users[id] = {
    id,
    username,
    display_name: displayName || existing?.display_name || null,
    promptpay: existing?.promptpay || null,
    created_at: existing?.created_at || new Date().toISOString(),
  };
  persistDb();
}

export async function getUser(id: string): Promise<UserRow | undefined> {
  const db = getMemoryDb();
  return db.users[id];
}

export async function setUserPromptPay(userId: string, promptPay: string): Promise<void> {
  const db = getMemoryDb();
  if (db.users[userId]) {
    db.users[userId].promptpay = promptPay;
    persistDb();
  }
}

// Session Operations
export async function getActiveSession(channelId: string): Promise<SessionRow | undefined> {
  const db = getMemoryDb();
  const active = Object.values(db.sessions)
    .filter(s => s.channel_id === channelId && s.status === 'active')
    .sort((a, b) => b.id - a.id);
  return active[0];
}

export async function getSessionById(sessionId: number): Promise<SessionRow | undefined> {
  const db = getMemoryDb();
  return db.sessions[String(sessionId)];
}

export async function createSession(
  guildId: string,
  channelId: string,
  hostId: string,
  defaultBuyin: number
): Promise<SessionRow> {
  const db = getMemoryDb();
  const newId = ++db.counters.sessionId;
  const session: SessionRecord = {
    id: newId,
    guild_id: guildId,
    channel_id: channelId,
    host_id: hostId,
    default_buyin: defaultBuyin,
    status: 'active',
    message_id: null,
    created_at: new Date().toISOString(),
    ended_at: null,
  };
  db.sessions[String(newId)] = session;
  persistDb();
  return session;
}

export async function updateSessionMessageId(sessionId: number, messageId: string): Promise<void> {
  const db = getMemoryDb();
  if (db.sessions[String(sessionId)]) {
    db.sessions[String(sessionId)].message_id = messageId;
    persistDb();
  }
}

export async function cancelSession(sessionId: number): Promise<void> {
  const db = getMemoryDb();
  if (db.sessions[String(sessionId)]) {
    db.sessions[String(sessionId)].status = 'cancelled';
    db.sessions[String(sessionId)].ended_at = new Date().toISOString();
    persistDb();
  }
}

// Session Players Operations
export async function getSessionPlayers(sessionId: number): Promise<SessionPlayerRow[]> {
  const db = getMemoryDb();
  const players = Object.values(db.session_players).filter(p => p.session_id === sessionId);

  return players.map(p => {
    const user = db.users[p.user_id];
    return {
      ...p,
      username: user ? user.username : 'Unknown',
      display_name: user ? user.display_name : null,
      promptpay: user ? user.promptpay : null,
    };
  });
}

export async function addOrRebuyPlayer(
  sessionId: number,
  userId: string,
  amount: number
): Promise<{ isRebuy: boolean; totalBuyIn: number }> {
  const db = getMemoryDb();
  const existing = Object.values(db.session_players).find(
    p => p.session_id === sessionId && p.user_id === userId
  );

  if (existing) {
    existing.buy_in += amount;
    existing.status = 'playing';
    existing.left_at = null;
    persistDb();
    return { isRebuy: true, totalBuyIn: existing.buy_in };
  } else {
    const newId = ++db.counters.sessionPlayerId;
    db.session_players[String(newId)] = {
      id: newId,
      session_id: sessionId,
      user_id: userId,
      buy_in: amount,
      cash_out: null,
      status: 'playing',
      left_at: null,
      created_at: new Date().toISOString(),
    };
    persistDb();
    return { isRebuy: false, totalBuyIn: amount };
  }
}

export async function playerLeaveSession(
  sessionId: number,
  userId: string,
  cashOut: number
): Promise<{ success: boolean; net: number }> {
  const db = getMemoryDb();
  const player = Object.values(db.session_players).find(
    p => p.session_id === sessionId && p.user_id === userId
  );

  if (!player) {
    return { success: false, net: 0 };
  }

  const roundedCashOut = Math.round(cashOut * 100) / 100;
  player.cash_out = roundedCashOut;
  player.status = 'left';
  player.left_at = new Date().toISOString();
  persistDb();

  const net = Math.round((roundedCashOut - player.buy_in) * 100) / 100;
  return { success: true, net };
}

export async function finalizeSession(
  sessionId: number,
  activeChipsMap: Record<string, number>
): Promise<{ settlement: SettlementResult; session: SessionRow }> {
  const db = getMemoryDb();
  const session = db.sessions[String(sessionId)];
  if (!session) throw new Error('Session not found');

  // Update remaining active players
  for (const [userId, chips] of Object.entries(activeChipsMap)) {
    const player = Object.values(db.session_players).find(
      p => p.session_id === sessionId && p.user_id === userId
    );
    if (player) {
      player.cash_out = Math.round(chips * 100) / 100;
    }
  }

  // Fetch all players in session
  const players = await getSessionPlayers(sessionId);

  const playerInputs = players.map(p => ({
    userId: p.user_id,
    name: p.display_name || p.username,
    buyIn: p.buy_in,
    cashOut: p.cash_out ?? 0,
  }));

  const settlement = calculateSettlements(playerInputs);

  // Clear previous settlements for this session
  for (const [k, v] of Object.entries(db.settlements)) {
    if (v.session_id === sessionId) {
      delete db.settlements[k];
    }
  }

  for (const tx of settlement.transactions) {
    const sId = ++db.counters.settlementId;
    db.settlements[String(sId)] = {
      id: sId,
      session_id: sessionId,
      from_user_id: tx.fromUserId,
      to_user_id: tx.toUserId,
      amount: tx.amount,
      created_at: new Date().toISOString(),
    };
  }

  session.status = 'completed';
  session.ended_at = new Date().toISOString();
  persistDb();

  return { settlement, session };
}

// Statistics Queries
export async function getUserStats(userId: string): Promise<UserStats> {
  const db = getMemoryDb();
  const records = Object.values(db.session_players).filter(p => {
    if (p.user_id !== userId || p.cash_out === null) return false;
    const session = db.sessions[String(p.session_id)];
    return session && session.status === 'completed';
  });

  let gamesPlayed = records.length;
  let totalBuyIn = 0;
  let totalCashOut = 0;
  let wins = 0;
  let losses = 0;
  let biggestWin = 0;
  let biggestLoss = 0;

  for (const r of records) {
    totalBuyIn += r.buy_in;
    totalCashOut += r.cash_out!;
    const net = r.cash_out! - r.buy_in;
    if (net > 0) {
      wins++;
      if (net > biggestWin) biggestWin = net;
    } else if (net < 0) {
      losses++;
      if (net < biggestLoss) biggestLoss = net;
    }
  }

  const totalProfit = Math.round((totalCashOut - totalBuyIn) * 100) / 100;
  const winRate = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0;

  return {
    gamesPlayed,
    totalBuyIn: Math.round(totalBuyIn * 100) / 100,
    totalCashOut: Math.round(totalCashOut * 100) / 100,
    totalProfit,
    wins,
    losses,
    winRate,
    biggestWin: Math.round(biggestWin * 100) / 100,
    biggestLoss: Math.round(biggestLoss * 100) / 100,
  };
}

export async function getRankedStats(
  guildId: string,
  options?: { year?: number; month?: number }
): Promise<RankedPlayerStats[]> {
  const db = getMemoryDb();
  let filterPrefix = '';
  if (options?.year && options?.month) {
    filterPrefix = `${options.year}-${String(options.month).padStart(2, '0')}`;
  } else if (options?.year) {
    filterPrefix = `${options.year}`;
  }

  // Filter completed sessions for this guild and date prefix
  const validSessionIds = new Set<number>();
  for (const session of Object.values(db.sessions)) {
    if (session.guild_id !== guildId || session.status !== 'completed' || !session.ended_at) {
      continue;
    }
    if (filterPrefix && !session.ended_at.startsWith(filterPrefix)) {
      continue;
    }
    validSessionIds.add(session.id);
  }

  // Aggregate stats per user
  const userMap: Record<
    string,
    { games: number; buyIn: number; cashOut: number; profit: number; wins: number }
  > = {};

  for (const player of Object.values(db.session_players)) {
    if (!validSessionIds.has(player.session_id) || player.cash_out === null) {
      continue;
    }
    const uId = player.user_id;
    if (!userMap[uId]) {
      userMap[uId] = { games: 0, buyIn: 0, cashOut: 0, profit: 0, wins: 0 };
    }
    userMap[uId].games++;
    userMap[uId].buyIn += player.buy_in;
    userMap[uId].cashOut += player.cash_out;
    const net = player.cash_out - player.buy_in;
    userMap[uId].profit += net;
    if (net > 0) userMap[uId].wins++;
  }

  const results: RankedPlayerStats[] = Object.entries(userMap).map(([userId, s]) => {
    const user = db.users[userId];
    return {
      userId,
      username: user ? user.username : 'Unknown',
      displayName: user ? user.display_name : null,
      gamesPlayed: s.games,
      totalBuyIn: Math.round(s.buyIn * 100) / 100,
      totalCashOut: Math.round(s.cashOut * 100) / 100,
      totalProfit: Math.round(s.profit * 100) / 100,
      winRate: s.games > 0 ? Math.round((s.wins / s.games) * 100) : 0,
    };
  });

  return results.sort((a, b) => b.totalProfit - a.totalProfit);
}

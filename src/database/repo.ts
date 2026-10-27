import { db } from './db';
import { calculateSettlements, SettlementResult } from '../services/settlement';

export interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  promptpay: string | null;
  created_at: string;
}

export interface SessionRow {
  id: number;
  guild_id: string;
  channel_id: string;
  host_id: string;
  default_buyin: number;
  status: 'active' | 'completed' | 'cancelled';
  message_id: string | null;
  created_at: string;
  ended_at: string | null;
}

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
export function upsertUser(id: string, username: string, displayName?: string | null): void {
  const stmt = db.prepare(`
    INSERT INTO users (id, username, display_name)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      display_name = coalesce(excluded.display_name, users.display_name)
  `);
  stmt.run(id, username, displayName || null);
}

export function getUser(id: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function setUserPromptPay(userId: string, promptPay: string): void {
  db.prepare('UPDATE users SET promptpay = ? WHERE id = ?').run(promptPay, userId);
}

// Session Operations
export function getActiveSession(channelId: string): SessionRow | undefined {
  return db.prepare(`
    SELECT * FROM sessions 
    WHERE channel_id = ? AND status = 'active'
    ORDER BY id DESC LIMIT 1
  `).get(channelId) as SessionRow | undefined;
}

export function getSessionById(sessionId: number): SessionRow | undefined {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
}

export function createSession(
  guildId: string,
  channelId: string,
  hostId: string,
  defaultBuyin: number
): SessionRow {
  const stmt = db.prepare(`
    INSERT INTO sessions (guild_id, channel_id, host_id, default_buyin)
    VALUES (?, ?, ?, ?)
  `);
  const info = stmt.run(guildId, channelId, hostId, defaultBuyin);
  return getSessionById(Number(info.lastInsertRowid))!;
}

export function updateSessionMessageId(sessionId: number, messageId: string): void {
  db.prepare('UPDATE sessions SET message_id = ? WHERE id = ?').run(messageId, sessionId);
}

export function cancelSession(sessionId: number): void {
  db.prepare("UPDATE sessions SET status = 'cancelled', ended_at = CURRENT_TIMESTAMP WHERE id = ?").run(sessionId);
}

// Session Players Operations
export function getSessionPlayers(sessionId: number): SessionPlayerRow[] {
  return db.prepare(`
    SELECT sp.*, u.username, u.display_name, u.promptpay
    FROM session_players sp
    JOIN users u ON sp.user_id = u.id
    WHERE sp.session_id = ?
    ORDER BY sp.id ASC
  `).all(sessionId) as SessionPlayerRow[];
}

export function addOrRebuyPlayer(
  sessionId: number,
  userId: string,
  amount: number
): { isRebuy: boolean; totalBuyIn: number } {
  const existing = db.prepare(`
    SELECT * FROM session_players WHERE session_id = ? AND user_id = ?
  `).get(sessionId, userId) as SessionPlayerRow | undefined;

  if (existing) {
    const newBuyIn = existing.buy_in + amount;
    db.prepare(`
      UPDATE session_players 
      SET buy_in = ?, status = 'playing', left_at = NULL
      WHERE id = ?
    `).run(newBuyIn, existing.id);
    return { isRebuy: true, totalBuyIn: newBuyIn };
  } else {
    db.prepare(`
      INSERT INTO session_players (session_id, user_id, buy_in, status)
      VALUES (?, ?, ?, 'playing')
    `).run(sessionId, userId, amount);
    return { isRebuy: false, totalBuyIn: amount };
  }
}

export function playerLeaveSession(
  sessionId: number,
  userId: string,
  cashOut: number
): { success: boolean; net: number } {
  const player = db.prepare(`
    SELECT * FROM session_players WHERE session_id = ? AND user_id = ?
  `).get(sessionId, userId) as SessionPlayerRow | undefined;

  if (!player) {
    return { success: false, net: 0 };
  }

  const roundedCashOut = Math.round(cashOut * 100) / 100;
  db.prepare(`
    UPDATE session_players 
    SET cash_out = ?, status = 'left', left_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(roundedCashOut, player.id);

  const net = Math.round((roundedCashOut - player.buy_in) * 100) / 100;
  return { success: true, net };
}

export function finalizeSession(
  sessionId: number,
  activeChipsMap: Record<string, number>
): { settlement: SettlementResult; session: SessionRow } {
  const session = getSessionById(sessionId);
  if (!session) throw new Error('Session not found');

  // Update remaining active players
  const updateCashOutStmt = db.prepare(`
    UPDATE session_players SET cash_out = ? WHERE session_id = ? AND user_id = ?
  `);

  for (const [userId, chips] of Object.entries(activeChipsMap)) {
    updateCashOutStmt.run(Math.round(chips * 100) / 100, sessionId, userId);
  }

  // Fetch all players in session
  const players = getSessionPlayers(sessionId);

  const playerInputs = players.map(p => ({
    userId: p.user_id,
    name: p.display_name || p.username,
    buyIn: p.buy_in,
    cashOut: p.cash_out ?? 0,
  }));

  const settlement = calculateSettlements(playerInputs);

  // Record settlements if balanced
  const insertSettlementStmt = db.prepare(`
    INSERT INTO settlements (session_id, from_user_id, to_user_id, amount)
    VALUES (?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    // Clear previous settlements for this session if any
    db.prepare('DELETE FROM settlements WHERE session_id = ?').run(sessionId);

    for (const tx of settlement.transactions) {
      insertSettlementStmt.run(sessionId, tx.fromUserId, tx.toUserId, tx.amount);
    }

    db.prepare(`
      UPDATE sessions 
      SET status = 'completed', ended_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(sessionId);
  });

  transaction();

  return { settlement, session: getSessionById(sessionId)! };
}

// Statistics Queries
export function getUserStats(userId: string): UserStats {
  const records = db.prepare(`
    SELECT sp.buy_in, sp.cash_out
    FROM session_players sp
    JOIN sessions s ON sp.session_id = s.id
    WHERE sp.user_id = ? AND s.status = 'completed' AND sp.cash_out IS NOT NULL
  `).all(userId) as { buy_in: number; cash_out: number }[];

  let gamesPlayed = records.length;
  let totalBuyIn = 0;
  let totalCashOut = 0;
  let wins = 0;
  let losses = 0;
  let biggestWin = 0;
  let biggestLoss = 0;

  for (const r of records) {
    totalBuyIn += r.buy_in;
    totalCashOut += r.cash_out;
    const net = r.cash_out - r.buy_in;
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

export function getRankedStats(
  guildId: string,
  options?: { year?: number; month?: number }
): RankedPlayerStats[] {
  let dateFilter = '';
  const params: any[] = [guildId];

  if (options?.year && options?.month) {
    // strftime format %Y-%m
    const monthStr = `${options.year}-${String(options.month).padStart(2, '0')}`;
    dateFilter = "AND strftime('%Y-%m', s.ended_at) = ?";
    params.push(monthStr);
  } else if (options?.year) {
    const yearStr = `${options.year}`;
    dateFilter = "AND strftime('%Y', s.ended_at) = ?";
    params.push(yearStr);
  }

  const rows = db.prepare(`
    SELECT 
      u.id as userId,
      u.username,
      u.display_name as displayName,
      COUNT(sp.id) as gamesPlayed,
      SUM(sp.buy_in) as totalBuyIn,
      SUM(sp.cash_out) as totalCashOut,
      SUM(sp.cash_out - sp.buy_in) as totalProfit,
      SUM(CASE WHEN (sp.cash_out - sp.buy_in) > 0 THEN 1 ELSE 0 END) as wins
    FROM session_players sp
    JOIN sessions s ON sp.session_id = s.id
    JOIN users u ON sp.user_id = u.id
    WHERE s.guild_id = ? AND s.status = 'completed' AND sp.cash_out IS NOT NULL ${dateFilter}
    GROUP BY u.id
    ORDER BY totalProfit DESC
  `).all(...params) as any[];

  return rows.map(r => ({
    userId: r.userId,
    username: r.username,
    displayName: r.displayName,
    gamesPlayed: Number(r.gamesPlayed),
    totalBuyIn: Math.round(Number(r.totalBuyIn) * 100) / 100,
    totalCashOut: Math.round(Number(r.totalCashOut) * 100) / 100,
    totalProfit: Math.round(Number(r.totalProfit) * 100) / 100,
    winRate: Number(r.gamesPlayed) > 0 ? Math.round((Number(r.wins) / Number(r.gamesPlayed)) * 100) : 0,
  }));
}

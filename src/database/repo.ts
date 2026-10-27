import { getDb } from './db';
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
export async function upsertUser(id: string, username: string, displayName?: string | null): Promise<void> {
  const db = await getDb();
  await db.run(
    `
    INSERT INTO users (id, username, display_name)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      display_name = coalesce(excluded.display_name, users.display_name)
    `,
    id,
    username,
    displayName || null
  );
}

export async function getUser(id: string): Promise<UserRow | undefined> {
  const db = await getDb();
  return db.get<UserRow>('SELECT * FROM users WHERE id = ?', id);
}

export async function setUserPromptPay(userId: string, promptPay: string): Promise<void> {
  const db = await getDb();
  await db.run('UPDATE users SET promptpay = ? WHERE id = ?', promptPay, userId);
}

// Session Operations
export async function getActiveSession(channelId: string): Promise<SessionRow | undefined> {
  const db = await getDb();
  return db.get<SessionRow>(
    `
    SELECT * FROM sessions 
    WHERE channel_id = ? AND status = 'active'
    ORDER BY id DESC LIMIT 1
    `,
    channelId
  );
}

export async function getSessionById(sessionId: number): Promise<SessionRow | undefined> {
  const db = await getDb();
  return db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', sessionId);
}

export async function createSession(
  guildId: string,
  channelId: string,
  hostId: string,
  defaultBuyin: number
): Promise<SessionRow> {
  const db = await getDb();
  const result = await db.run(
    `
    INSERT INTO sessions (guild_id, channel_id, host_id, default_buyin)
    VALUES (?, ?, ?, ?)
    `,
    guildId,
    channelId,
    hostId,
    defaultBuyin
  );
  const session = await getSessionById(result.lastID!);
  return session!;
}

export async function updateSessionMessageId(sessionId: number, messageId: string): Promise<void> {
  const db = await getDb();
  await db.run('UPDATE sessions SET message_id = ? WHERE id = ?', messageId, sessionId);
}

export async function cancelSession(sessionId: number): Promise<void> {
  const db = await getDb();
  await db.run(
    "UPDATE sessions SET status = 'cancelled', ended_at = CURRENT_TIMESTAMP WHERE id = ?",
    sessionId
  );
}

// Session Players Operations
export async function getSessionPlayers(sessionId: number): Promise<SessionPlayerRow[]> {
  const db = await getDb();
  return db.all<SessionPlayerRow[]>(
    `
    SELECT sp.*, u.username, u.display_name, u.promptpay
    FROM session_players sp
    JOIN users u ON sp.user_id = u.id
    WHERE sp.session_id = ?
    ORDER BY sp.id ASC
    `,
    sessionId
  );
}

export async function addOrRebuyPlayer(
  sessionId: number,
  userId: string,
  amount: number
): Promise<{ isRebuy: boolean; totalBuyIn: number }> {
  const db = await getDb();
  const existing = await db.get<SessionPlayerRow>(
    'SELECT * FROM session_players WHERE session_id = ? AND user_id = ?',
    sessionId,
    userId
  );

  if (existing) {
    const newBuyIn = existing.buy_in + amount;
    await db.run(
      `
      UPDATE session_players 
      SET buy_in = ?, status = 'playing', left_at = NULL
      WHERE id = ?
      `,
      newBuyIn,
      existing.id
    );
    return { isRebuy: true, totalBuyIn: newBuyIn };
  } else {
    await db.run(
      `
      INSERT INTO session_players (session_id, user_id, buy_in, status)
      VALUES (?, ?, ?, 'playing')
      `,
      sessionId,
      userId,
      amount
    );
    return { isRebuy: false, totalBuyIn: amount };
  }
}

export async function playerLeaveSession(
  sessionId: number,
  userId: string,
  cashOut: number
): Promise<{ success: boolean; net: number }> {
  const db = await getDb();
  const player = await db.get<SessionPlayerRow>(
    'SELECT * FROM session_players WHERE session_id = ? AND user_id = ?',
    sessionId,
    userId
  );

  if (!player) {
    return { success: false, net: 0 };
  }

  const roundedCashOut = Math.round(cashOut * 100) / 100;
  await db.run(
    `
    UPDATE session_players 
    SET cash_out = ?, status = 'left', left_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    roundedCashOut,
    player.id
  );

  const net = Math.round((roundedCashOut - player.buy_in) * 100) / 100;
  return { success: true, net };
}

export async function finalizeSession(
  sessionId: number,
  activeChipsMap: Record<string, number>
): Promise<{ settlement: SettlementResult; session: SessionRow }> {
  const db = await getDb();
  const session = await getSessionById(sessionId);
  if (!session) throw new Error('Session not found');

  // Update remaining active players
  for (const [userId, chips] of Object.entries(activeChipsMap)) {
    await db.run(
      'UPDATE session_players SET cash_out = ? WHERE session_id = ? AND user_id = ?',
      Math.round(chips * 100) / 100,
      sessionId,
      userId
    );
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

  // Clear previous settlements for this session if any
  await db.run('DELETE FROM settlements WHERE session_id = ?', sessionId);

  for (const tx of settlement.transactions) {
    await db.run(
      `
      INSERT INTO settlements (session_id, from_user_id, to_user_id, amount)
      VALUES (?, ?, ?, ?)
      `,
      sessionId,
      tx.fromUserId,
      tx.toUserId,
      tx.amount
    );
  }

  await db.run(
    `
    UPDATE sessions 
    SET status = 'completed', ended_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    sessionId
  );

  const updatedSession = await getSessionById(sessionId);
  return { settlement, session: updatedSession! };
}

// Statistics Queries
export async function getUserStats(userId: string): Promise<UserStats> {
  const db = await getDb();
  const records = await db.all<{ buy_in: number; cash_out: number }[]>(
    `
    SELECT sp.buy_in, sp.cash_out
    FROM session_players sp
    JOIN sessions s ON sp.session_id = s.id
    WHERE sp.user_id = ? AND s.status = 'completed' AND sp.cash_out IS NOT NULL
    `,
    userId
  );

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

export async function getRankedStats(
  guildId: string,
  options?: { year?: number; month?: number }
): Promise<RankedPlayerStats[]> {
  const db = await getDb();
  let dateFilter = '';
  const params: any[] = [guildId];

  if (options?.year && options?.month) {
    const monthStr = `${options.year}-${String(options.month).padStart(2, '0')}`;
    dateFilter = "AND strftime('%Y-%m', s.ended_at) = ?";
    params.push(monthStr);
  } else if (options?.year) {
    const yearStr = `${options.year}`;
    dateFilter = "AND strftime('%Y', s.ended_at) = ?";
    params.push(yearStr);
  }

  const rows = await db.all<any[]>(
    `
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
    `,
    ...params
  );

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

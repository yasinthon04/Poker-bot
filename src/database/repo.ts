import { getMemoryDb, persistDb, UserRecord, SessionRecord, SettlementRecord } from './db';
import { calculateSettlements, SettlementResult } from '../services/settlement';
import { isSupabaseConfigured } from './supabase';
import * as supabaseRepo from './supabase-repo';

export type UserRow = UserRecord;
export type SessionRow = SessionRecord;

export type SettlementRow = SettlementRecord & {
  from_name?: string;
  to_name?: string;
  to_promptpay?: string | null;
  to_bank_name?: string | null;
};

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
  qr_image_url: string | null;
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
  if (isSupabaseConfigured()) {
    return supabaseRepo.upsertUser(id, username, displayName);
  }
  const db = getMemoryDb();
  const existing = db.users[id];
  db.users[id] = {
    id,
    username,
    display_name: displayName || existing?.display_name || null,
    promptpay: existing?.promptpay || null,
    qr_image_url: existing?.qr_image_url || null,
    created_at: existing?.created_at || new Date().toISOString(),
  };
  persistDb();
}

export async function getUser(id: string): Promise<UserRow | undefined> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.getUser(id);
  }
  const db = getMemoryDb();
  return db.users[id];
}

export async function setUserPromptPay(userId: string, promptPay: string): Promise<void> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.setUserPromptPay(userId, promptPay);
  }
  const db = getMemoryDb();
  if (db.users[userId]) {
    db.users[userId].promptpay = promptPay;
    persistDb();
  }
}

export async function clearUserPromptPay(userId: string): Promise<void> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.clearUserPromptPay(userId);
  }
  const db = getMemoryDb();
  if (db.users[userId]) {
    db.users[userId].promptpay = null;
    persistDb();
  }
}

export async function setUserQrImage(userId: string, qrImageUrl: string): Promise<void> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.setUserQrImage(userId, qrImageUrl);
  }
  const db = getMemoryDb();
  if (db.users[userId]) {
    db.users[userId].qr_image_url = qrImageUrl;
    persistDb();
  }
}

export async function clearUserQrImage(userId: string): Promise<void> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.clearUserQrImage(userId);
  }
  const db = getMemoryDb();
  if (db.users[userId]) {
    db.users[userId].qr_image_url = null;
    persistDb();
  }
}

export async function setUserBankName(userId: string, bankName: string): Promise<void> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.setUserBankName(userId, bankName);
  }
  const db = getMemoryDb();
  if (db.users[userId]) {
    db.users[userId].bank_name = bankName;
    persistDb();
  }
}

export async function clearUserBankName(userId: string): Promise<void> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.clearUserBankName(userId);
  }
  const db = getMemoryDb();
  if (db.users[userId]) {
    db.users[userId].bank_name = null;
    persistDb();
  }
}

// Session Operations
export async function getActiveSession(channelId: string): Promise<SessionRow | undefined> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.getActiveSession(channelId);
  }
  const db = getMemoryDb();
  const active = Object.values(db.sessions)
    .filter(s => s.channel_id === channelId && s.status === 'active')
    .sort((a, b) => b.id - a.id);
  return active[0];
}

export async function getLastSession(channelId: string): Promise<SessionRow | undefined> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.getLastSession(channelId);
  }
  const db = getMemoryDb();
  const sessions = Object.values(db.sessions)
    .filter(s => s.channel_id === channelId)
    .sort((a, b) => b.id - a.id);
  return sessions[0];
}

export async function getSessionById(sessionId: number): Promise<SessionRow | undefined> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.getSessionById(sessionId);
  }
  const db = getMemoryDb();
  return db.sessions[String(sessionId)];
}

export async function createSession(
  guildId: string,
  channelId: string,
  hostId: string,
  defaultBuyin: number
): Promise<SessionRow> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.createSession(guildId, channelId, hostId, defaultBuyin);
  }
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
  if (isSupabaseConfigured()) {
    return supabaseRepo.updateSessionMessageId(sessionId, messageId);
  }
  const db = getMemoryDb();
  if (db.sessions[String(sessionId)]) {
    db.sessions[String(sessionId)].message_id = messageId;
    persistDb();
  }
}

export async function cancelSession(sessionId: number): Promise<void> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.cancelSession(sessionId);
  }
  const db = getMemoryDb();
  if (db.sessions[String(sessionId)]) {
    db.sessions[String(sessionId)].status = 'cancelled';
    db.sessions[String(sessionId)].ended_at = new Date().toISOString();
    persistDb();
  }
}

// Session Players Operations
export async function getSessionPlayers(sessionId: number): Promise<SessionPlayerRow[]> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.getSessionPlayers(sessionId);
  }
  const db = getMemoryDb();
  const players = Object.values(db.session_players).filter(p => p.session_id === sessionId);

  return players.map(p => {
    const user = db.users[p.user_id];
    return {
      ...p,
      username: user ? user.username : 'Unknown',
      display_name: user ? user.display_name : null,
      promptpay: user ? user.promptpay : null,
      qr_image_url: user ? user.qr_image_url : null,
    };
  });
}

/**
 * Join table. If player is already playing, do NOT add buy-in again.
 */
export async function joinPlayer(
  sessionId: number,
  userId: string,
  amount: number
): Promise<{ success: boolean; alreadyPlaying?: boolean; isRejoin?: boolean; totalBuyIn: number }> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.joinPlayer(sessionId, userId, amount);
  }
  const db = getMemoryDb();
  const currentlyPlaying = Object.values(db.session_players).find(
    p => p.session_id === sessionId && p.user_id === userId && p.status === 'playing'
  );

  if (currentlyPlaying) {
    return { success: false, alreadyPlaying: true, totalBuyIn: currentlyPlaying.buy_in };
  }

  // Check if player previously left this session early
  const previouslyLeft = Object.values(db.session_players).filter(
    p => p.session_id === sessionId && p.user_id === userId && p.status === 'left'
  );
  const isRejoin = previouslyLeft.length > 0;

  // Create a brand new active record so the previous early-leaver record and profit are preserved!
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

  return { success: true, isRejoin, totalBuyIn: amount };
}

/**
 * Rebuy chips for a currently playing player.
 */
export async function rebuyPlayer(
  sessionId: number,
  userId: string,
  amount: number
): Promise<{ success: boolean; notPlaying?: boolean; totalBuyIn: number }> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.rebuyPlayer(sessionId, userId, amount);
  }
  const db = getMemoryDb();
  const existing = Object.values(db.session_players).find(
    p => p.session_id === sessionId && p.user_id === userId && p.status === 'playing'
  );

  if (!existing) {
    return { success: false, notPlaying: true, totalBuyIn: 0 };
  }

  existing.buy_in += amount;
  persistDb();
  return { success: true, totalBuyIn: existing.buy_in };
}

/**
 * Correct/Set a player's buy-in (for Host fixes).
 */
export async function setPlayerBuyIn(
  sessionId: number,
  userId: string,
  amount: number
): Promise<{ success: boolean; totalBuyIn: number }> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.setPlayerBuyIn(sessionId, userId, amount);
  }
  const db = getMemoryDb();
  const existing = Object.values(db.session_players).find(
    p => p.session_id === sessionId && p.user_id === userId && p.status === 'playing'
  );

  if (!existing) {
    return { success: false, totalBuyIn: 0 };
  }

  existing.buy_in = amount;
  persistDb();
  return { success: true, totalBuyIn: existing.buy_in };
}

// Keep backward compatibility if anything still calls addOrRebuyPlayer
export async function addOrRebuyPlayer(
  sessionId: number,
  userId: string,
  amount: number
): Promise<{ isRebuy: boolean; totalBuyIn: number }> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.addOrRebuyPlayer(sessionId, userId, amount);
  }
  const res = await joinPlayer(sessionId, userId, amount);
  if (res.alreadyPlaying) {
    const rebuyRes = await rebuyPlayer(sessionId, userId, amount);
    return { isRebuy: true, totalBuyIn: rebuyRes.totalBuyIn };
  }
  return { isRebuy: res.isRejoin || false, totalBuyIn: res.totalBuyIn };
}

export async function playerLeaveSession(
  sessionId: number,
  userId: string,
  cashOut: number
): Promise<{ success: boolean; net: number }> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.playerLeaveSession(sessionId, userId, cashOut);
  }
  const db = getMemoryDb();
  const player = Object.values(db.session_players).find(
    p => p.session_id === sessionId && p.user_id === userId && p.status === 'playing'
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
  if (isSupabaseConfigured()) {
    return supabaseRepo.finalizeSession(sessionId, activeChipsMap);
  }
  const db = getMemoryDb();
  const session = db.sessions[String(sessionId)];
  if (!session) throw new Error('Session not found');

  // Update remaining active players
  for (const [userId, chips] of Object.entries(activeChipsMap)) {
    const userRecords = Object.values(db.session_players).filter(
      p => p.session_id === sessionId && p.user_id === userId
    );
    const player = userRecords.find(p => p.status === 'playing') || userRecords[userRecords.length - 1];
    if (player) {
      player.cash_out = Math.round(chips * 100) / 100;
    }
  }

  // Ensure all players in this session have a non-null cash_out (default to 0 if still null)
  for (const player of Object.values(db.session_players)) {
    if (player.session_id === sessionId && player.cash_out === null) {
      player.cash_out = 0;
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
      status: 'pending',
      slip_url: null,
      trans_ref: null,
      paid_at: null,
      reminder_count: 0,
      created_at: new Date().toISOString(),
    };
    tx.id = sId;
    tx.status = 'pending';
  }

  session.status = 'completed';
  session.ended_at = new Date().toISOString();
  persistDb();

  return { settlement, session };
}

export interface ManualPlayerEntry {
  userId: string;
  name: string;
  buyIn: number;
  cashOut: number;
}

export async function saveOrUpdateManualSession(
  guildId: string,
  channelId: string,
  hostId: string,
  defaultBuyIn: number,
  playerEntries: ManualPlayerEntry[],
  existingSessionId?: number
): Promise<{ settlement: SettlementResult; session: SessionRow }> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.saveOrUpdateManualSession(
      guildId,
      channelId,
      hostId,
      defaultBuyIn,
      playerEntries,
      existingSessionId
    );
  }
  const db = getMemoryDb();

  let session: SessionRecord;
  let sessionId: number;

  if (existingSessionId && db.sessions[String(existingSessionId)]) {
    sessionId = existingSessionId;
    session = db.sessions[String(sessionId)];
    session.default_buyin = defaultBuyIn;
    session.status = 'completed';
    session.ended_at = new Date().toISOString();

    // Remove existing players for this session for a clean overwrite
    for (const [key, p] of Object.entries(db.session_players)) {
      if (p.session_id === sessionId) {
        delete db.session_players[key];
      }
    }
  } else {
    sessionId = ++db.counters.sessionId;
    session = {
      id: sessionId,
      guild_id: guildId,
      channel_id: channelId,
      host_id: hostId,
      default_buyin: defaultBuyIn,
      status: 'completed',
      message_id: null,
      created_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
    };
    db.sessions[String(sessionId)] = session;
  }

  // Insert player records
  for (const entry of playerEntries) {
    const pId = ++db.counters.sessionPlayerId;
    db.session_players[String(pId)] = {
      id: pId,
      session_id: sessionId,
      user_id: entry.userId,
      buy_in: Math.round(entry.buyIn * 100) / 100,
      cash_out: Math.round(entry.cashOut * 100) / 100,
      status: 'playing',
      left_at: null,
      created_at: new Date().toISOString(),
    };
  }

  // Calculate settlement
  const playerInputs = playerEntries.map(p => ({
    userId: p.userId,
    name: p.name,
    buyIn: p.buyIn,
    cashOut: p.cashOut,
  }));
  const settlement = calculateSettlements(playerInputs);

  // Clear existing settlements for this session
  for (const [key, s] of Object.entries(db.settlements)) {
    if (s.session_id === sessionId) {
      delete db.settlements[key];
    }
  }

  // Insert new settlements
  for (const tx of settlement.transactions) {
    const sId = ++db.counters.settlementId;
    db.settlements[String(sId)] = {
      id: sId,
      session_id: sessionId,
      from_user_id: tx.fromUserId,
      to_user_id: tx.toUserId,
      amount: tx.amount,
      status: 'pending',
      slip_url: null,
      trans_ref: null,
      paid_at: null,
      reminder_count: 0,
      created_at: new Date().toISOString(),
    };
    tx.id = sId;
    tx.status = 'pending';
  }

  persistDb();
  return { settlement, session };
}

// Settlement Operations & KhunThong Debt Tracking
export async function getSessionSettlements(sessionId: number): Promise<SettlementRow[]> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.getSessionSettlements(sessionId);
  }
  const db = getMemoryDb();
  const items = Object.values(db.settlements).filter(s => s.session_id === sessionId);
  return items.map(s => {
    const fromUser = db.users[s.from_user_id];
    const toUser = db.users[s.to_user_id];
    return {
      ...s,
      status: s.status || 'pending',
      from_name: fromUser?.display_name || fromUser?.username || s.from_user_id,
      to_name: toUser?.display_name || toUser?.username || s.to_user_id,
      to_promptpay: toUser?.promptpay || null,
      to_bank_name: toUser?.bank_name || null,
    };
  });
}

export async function getPendingSettlementsForUser(
  userId: string,
  channelId?: string
): Promise<SettlementRow[]> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.getPendingSettlementsForUser(userId, channelId);
  }
  const db = getMemoryDb();
  const sessions = channelId
    ? Object.values(db.sessions).filter(s => s.channel_id === channelId).map(s => s.id)
    : undefined;

  const items = Object.values(db.settlements).filter(s => {
    if (s.from_user_id !== userId) return false;
    if (s.status === 'paid') return false;
    if (sessions && !sessions.includes(s.session_id)) return false;
    return true;
  });

  return items.map(s => {
    const fromUser = db.users[s.from_user_id];
    const toUser = db.users[s.to_user_id];
    return {
      ...s,
      status: 'pending',
      from_name: fromUser?.display_name || fromUser?.username || s.from_user_id,
      to_name: toUser?.display_name || toUser?.username || s.to_user_id,
      to_promptpay: toUser?.promptpay || null,
      to_bank_name: toUser?.bank_name || null,
    };
  });
}

export async function markSettlementPaid(
  settlementId: number,
  slipUrl?: string,
  transRef?: string
): Promise<boolean> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.markSettlementPaid(settlementId, slipUrl, transRef);
  }
  const db = getMemoryDb();
  const s = db.settlements[String(settlementId)];
  if (!s) return false;
  s.status = 'paid';
  s.slip_url = slipUrl || null;
  s.trans_ref = transRef || null;
  s.paid_at = new Date().toISOString();
  persistDb();
  return true;
}

export async function revertSettlementPaid(settlementId: number): Promise<boolean> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.revertSettlementPaid(settlementId);
  }
  const db = getMemoryDb();
  const s = db.settlements[String(settlementId)];
  if (!s) return false;
  s.status = 'pending';
  s.paid_at = null;
  persistDb();
  return true;
}

export async function isTransRefUsed(transRef: string): Promise<boolean> {
  if (!transRef || transRef.trim().length === 0) return false;
  if (isSupabaseConfigured()) {
    return supabaseRepo.isTransRefUsed(transRef);
  }
  const db = getMemoryDb();
  return Object.values(db.settlements).some(
    s => s.trans_ref && s.trans_ref.trim() === transRef.trim()
  );
}

export async function incrementSettlementReminder(sessionId: number): Promise<number> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.incrementSettlementReminder(sessionId);
  }
  const db = getMemoryDb();
  let maxCount = 1;
  for (const s of Object.values(db.settlements)) {
    if (s.session_id === sessionId && s.status !== 'paid') {
      s.reminder_count = (s.reminder_count || 0) + 1;
      maxCount = Math.max(maxCount, s.reminder_count);
    }
  }
  persistDb();
  return maxCount;
}

// Statistics Queries
export async function getUserStats(userId: string): Promise<UserStats> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.getUserStats(userId);
  }
  const db = getMemoryDb();
  const records = Object.values(db.session_players).filter(p => {
    if (p.user_id !== userId || p.cash_out === null) return false;
    const session = db.sessions[String(p.session_id)];
    return session && session.status === 'completed';
  });

  // Group by session so multiple stints in the same session count as 1 game
  const sessionMap: Record<number, { buyIn: number; cashOut: number }> = {};
  for (const r of records) {
    if (!sessionMap[r.session_id]) {
      sessionMap[r.session_id] = { buyIn: 0, cashOut: 0 };
    }
    sessionMap[r.session_id].buyIn += r.buy_in;
    sessionMap[r.session_id].cashOut += (r.cash_out ?? 0);
  }

  let gamesPlayed = Object.keys(sessionMap).length;
  let totalBuyIn = 0;
  let totalCashOut = 0;
  let wins = 0;
  let losses = 0;
  let biggestWin = 0;
  let biggestLoss = 0;

  for (const s of Object.values(sessionMap)) {
    totalBuyIn += s.buyIn;
    totalCashOut += s.cashOut;
    const net = Math.round((s.cashOut - s.buyIn) * 100) / 100;
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
  if (isSupabaseConfigured()) {
    return supabaseRepo.getRankedStats(guildId, options);
  }
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

  // Aggregate stats per user by session
  const userSessionMap: Record<
    string,
    Record<number, { buyIn: number; cashOut: number }>
  > = {};

  for (const player of Object.values(db.session_players)) {
    if (!validSessionIds.has(player.session_id) || player.cash_out === null) {
      continue;
    }
    const uId = player.user_id;
    if (!userSessionMap[uId]) {
      userSessionMap[uId] = {};
    }
    if (!userSessionMap[uId][player.session_id]) {
      userSessionMap[uId][player.session_id] = { buyIn: 0, cashOut: 0 };
    }
    userSessionMap[uId][player.session_id].buyIn += player.buy_in;
    userSessionMap[uId][player.session_id].cashOut += player.cash_out;
  }

  const results: RankedPlayerStats[] = Object.entries(userSessionMap).map(([userId, sessions]) => {
    const user = db.users[userId];
    const sessionList = Object.values(sessions);
    const gamesPlayed = sessionList.length;
    let totalBuyIn = 0;
    let totalCashOut = 0;
    let wins = 0;

    for (const s of sessionList) {
      totalBuyIn += s.buyIn;
      totalCashOut += s.cashOut;
      if (s.cashOut - s.buyIn > 0.01) wins++;
    }

    const totalProfit = Math.round((totalCashOut - totalBuyIn) * 100) / 100;

    return {
      userId,
      username: user ? user.username : 'Unknown',
      displayName: user ? user.display_name : null,
      gamesPlayed,
      totalBuyIn: Math.round(totalBuyIn * 100) / 100,
      totalCashOut: Math.round(totalCashOut * 100) / 100,
      totalProfit,
      winRate: gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0,
    };
  });

  return results.sort((a, b) => b.totalProfit - a.totalProfit);
}

export async function resetAllData(): Promise<void> {
  if (isSupabaseConfigured()) {
    return supabaseRepo.resetAllData();
  }
  const db = getMemoryDb();
  db.sessions = {};
  db.session_players = {};
  db.settlements = {};
  persistDb();
}

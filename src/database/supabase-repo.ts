import { getSupabase } from './supabase';
import { UserRow, SessionRow, SessionPlayerRow, UserStats, RankedPlayerStats } from './repo';
import { calculateSettlements, SettlementResult } from '../services/settlement';
import fs from 'fs';
import path from 'path';

export async function upsertUser(id: string, username: string, displayName?: string | null): Promise<void> {
  const supabase = getSupabase();
  const payload: any = {
    id,
    username,
  };
  if (displayName !== undefined) {
    payload.display_name = displayName;
  }

  const { error } = await supabase.from('users').upsert(payload, { onConflict: 'id' });
  if (error) {
    console.error('Supabase upsertUser error:', error.message);
  }
}

export async function getUser(id: string): Promise<UserRow | undefined> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
  if (error || !data) return undefined;
  return data as UserRow;
}

export async function setUserPromptPay(userId: string, promptPay: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.from('users').update({ promptpay: promptPay }).eq('id', userId);
}

export async function clearUserPromptPay(userId: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.from('users').update({ promptpay: null }).eq('id', userId);
}

export async function setUserQrImage(userId: string, qrImageUrl: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.from('users').update({ qr_image_url: qrImageUrl }).eq('id', userId);
}

export async function clearUserQrImage(userId: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.from('users').update({ qr_image_url: null }).eq('id', userId);
}

export async function getActiveSession(channelId: string): Promise<SessionRow | undefined> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('channel_id', channelId)
    .eq('status', 'active')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return undefined;
  return {
    ...data,
    id: Number(data.id),
    default_buyin: Number(data.default_buyin),
  } as SessionRow;
}

export async function getLastSession(channelId: string): Promise<SessionRow | undefined> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('channel_id', channelId)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return undefined;
  return {
    ...data,
    id: Number(data.id),
    default_buyin: Number(data.default_buyin),
  } as SessionRow;
}

export async function getSessionById(sessionId: number): Promise<SessionRow | undefined> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();

  if (error || !data) return undefined;
  return {
    ...data,
    id: Number(data.id),
    default_buyin: Number(data.default_buyin),
  } as SessionRow;
}

export async function createSession(
  guildId: string,
  channelId: string,
  hostId: string,
  defaultBuyin: number
): Promise<SessionRow> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      guild_id: guildId,
      channel_id: channelId,
      host_id: hostId,
      default_buyin: defaultBuyin,
      status: 'active',
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create session in Supabase: ${error?.message}`);
  }

  return {
    ...data,
    id: Number(data.id),
    default_buyin: Number(data.default_buyin),
  } as SessionRow;
}

export async function updateSessionMessageId(sessionId: number, messageId: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.from('sessions').update({ message_id: messageId }).eq('id', sessionId);
}

export async function cancelSession(sessionId: number): Promise<void> {
  const supabase = getSupabase();
  await supabase
    .from('sessions')
    .update({ status: 'cancelled', ended_at: new Date().toISOString() })
    .eq('id', sessionId);
}

export async function getSessionPlayers(sessionId: number): Promise<SessionPlayerRow[]> {
  const supabase = getSupabase();
  const { data: players, error } = await supabase
    .from('session_players')
    .select('*')
    .eq('session_id', sessionId)
    .order('id', { ascending: true });

  if (error || !players) return [];

  const userIds = Array.from(new Set(players.map(p => p.user_id)));
  let userMap = new Map<string, any>();

  if (userIds.length > 0) {
    const { data: users } = await supabase.from('users').select('*').in('id', userIds);
    if (users) {
      userMap = new Map(users.map(u => [u.id, u]));
    }
  }

  return players.map(p => {
    const user = userMap.get(p.user_id);
    return {
      id: Number(p.id),
      session_id: Number(p.session_id),
      user_id: p.user_id,
      buy_in: Number(p.buy_in),
      cash_out: p.cash_out !== null && p.cash_out !== undefined ? Number(p.cash_out) : null,
      status: p.status as 'playing' | 'left',
      left_at: p.left_at,
      created_at: p.created_at,
      username: user ? user.username : 'Unknown',
      display_name: user ? user.display_name : null,
      promptpay: user ? user.promptpay : null,
      qr_image_url: user ? user.qr_image_url : null,
    };
  });
}

export async function joinPlayer(
  sessionId: number,
  userId: string,
  amount: number
): Promise<{ success: boolean; alreadyPlaying?: boolean; isRejoin?: boolean; totalBuyIn: number }> {
  const supabase = getSupabase();

  // Check if currently playing
  const { data: currentlyPlaying } = await supabase
    .from('session_players')
    .select('*')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .eq('status', 'playing')
    .maybeSingle();

  if (currentlyPlaying) {
    return { success: false, alreadyPlaying: true, totalBuyIn: Number(currentlyPlaying.buy_in) };
  }

  // Check if previously left
  const { data: previouslyLeft } = await supabase
    .from('session_players')
    .select('id')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .eq('status', 'left')
    .limit(1);

  const isRejoin = (previouslyLeft?.length ?? 0) > 0;

  const { error } = await supabase.from('session_players').insert({
    session_id: sessionId,
    user_id: userId,
    buy_in: amount,
    status: 'playing',
  });

  if (error) {
    console.error('Error inserting session_player in Supabase:', error.message);
    return { success: false, totalBuyIn: 0 };
  }

  return { success: true, isRejoin, totalBuyIn: amount };
}

export async function rebuyPlayer(
  sessionId: number,
  userId: string,
  amount: number
): Promise<{ success: boolean; notPlaying?: boolean; totalBuyIn: number }> {
  const supabase = getSupabase();
  const { data: existing } = await supabase
    .from('session_players')
    .select('*')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .eq('status', 'playing')
    .maybeSingle();

  if (!existing) {
    return { success: false, notPlaying: true, totalBuyIn: 0 };
  }

  const newTotal = Number(existing.buy_in) + amount;
  await supabase
    .from('session_players')
    .update({ buy_in: newTotal })
    .eq('id', existing.id);

  return { success: true, totalBuyIn: newTotal };
}

export async function setPlayerBuyIn(
  sessionId: number,
  userId: string,
  amount: number
): Promise<{ success: boolean; totalBuyIn: number }> {
  const supabase = getSupabase();
  const { data: existing } = await supabase
    .from('session_players')
    .select('*')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .eq('status', 'playing')
    .maybeSingle();

  if (!existing) {
    return { success: false, totalBuyIn: 0 };
  }

  await supabase
    .from('session_players')
    .update({ buy_in: amount })
    .eq('id', existing.id);

  return { success: true, totalBuyIn: amount };
}

export async function addOrRebuyPlayer(
  sessionId: number,
  userId: string,
  amount: number
): Promise<{ isRebuy: boolean; totalBuyIn: number }> {
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
  const supabase = getSupabase();
  const { data: player } = await supabase
    .from('session_players')
    .select('*')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .eq('status', 'playing')
    .maybeSingle();

  if (!player) {
    return { success: false, net: 0 };
  }

  const roundedCashOut = Math.round(cashOut * 100) / 100;
  await supabase
    .from('session_players')
    .update({
      cash_out: roundedCashOut,
      status: 'left',
      left_at: new Date().toISOString(),
    })
    .eq('id', player.id);

  const net = Math.round((roundedCashOut - Number(player.buy_in)) * 100) / 100;
  return { success: true, net };
}

export async function finalizeSession(
  sessionId: number,
  activeChipsMap: Record<string, number>
): Promise<{ settlement: SettlementResult; session: SessionRow }> {
  const supabase = getSupabase();
  const session = await getSessionById(sessionId);
  if (!session) throw new Error('Session not found');

  // Update remaining active players
  for (const [userId, chips] of Object.entries(activeChipsMap)) {
    const { data: records } = await supabase
      .from('session_players')
      .select('id, status')
      .eq('session_id', sessionId)
      .eq('user_id', userId);

    if (records && records.length > 0) {
      const activeRecord = records.find(r => r.status === 'playing') || records[records.length - 1];
      await supabase
        .from('session_players')
        .update({ cash_out: Math.round(chips * 100) / 100 })
        .eq('id', activeRecord.id);
    }
  }

  // Ensure all players in this session have a non-null cash_out (default to 0 if still null)
  const { data: nullPlayers } = await supabase
    .from('session_players')
    .select('id')
    .eq('session_id', sessionId)
    .is('cash_out', null);

  if (nullPlayers && nullPlayers.length > 0) {
    for (const p of nullPlayers) {
      await supabase.from('session_players').update({ cash_out: 0 }).eq('id', p.id);
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

  // Clear previous settlements for this session (for recalculations)
  await supabase.from('settlements').delete().eq('session_id', sessionId);

  if (settlement.transactions.length > 0) {
    const records = settlement.transactions.map(tx => ({
      session_id: sessionId,
      from_user_id: tx.fromUserId,
      to_user_id: tx.toUserId,
      amount: tx.amount,
    }));
    await supabase.from('settlements').insert(records);
  }

  const now = new Date().toISOString();
  await supabase
    .from('sessions')
    .update({ status: 'completed', ended_at: now })
    .eq('id', sessionId);

  session.status = 'completed';
  session.ended_at = now;

  return { settlement, session };
}

export async function getUserStats(userId: string): Promise<UserStats> {
  const supabase = getSupabase();
  const { data: players } = await supabase
    .from('session_players')
    .select('session_id, buy_in, cash_out, sessions!inner(status)')
    .eq('user_id', userId)
    .not('cash_out', 'is', null)
    .eq('sessions.status', 'completed');

  const records = players || [];
  const sessionMap: Record<number, { buyIn: number; cashOut: number }> = {};
  for (const r of records) {
    const sId = Number(r.session_id);
    if (!sessionMap[sId]) {
      sessionMap[sId] = { buyIn: 0, cashOut: 0 };
    }
    sessionMap[sId].buyIn += Number(r.buy_in);
    sessionMap[sId].cashOut += Number(r.cash_out ?? 0);
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
  const supabase = getSupabase();
  let filterPrefix = '';
  if (options?.year && options?.month) {
    filterPrefix = `${options.year}-${String(options.month).padStart(2, '0')}`;
  } else if (options?.year) {
    filterPrefix = `${options.year}`;
  }

  // Filter completed sessions for this guild
  const { data: sessions, error } = await supabase
    .from('sessions')
    .select('id, ended_at')
    .eq('guild_id', guildId)
    .eq('status', 'completed')
    .not('ended_at', 'is', null);

  if (error || !sessions || sessions.length === 0) return [];

  const validSessionIds = new Set<number>();
  for (const session of sessions) {
    if (filterPrefix && !session.ended_at?.startsWith(filterPrefix)) {
      continue;
    }
    validSessionIds.add(Number(session.id));
  }

  if (validSessionIds.size === 0) return [];

  const { data: players } = await supabase
    .from('session_players')
    .select('session_id, user_id, buy_in, cash_out')
    .in('session_id', Array.from(validSessionIds))
    .not('cash_out', 'is', null);

  if (!players || players.length === 0) return [];

  const userSessionMap: Record<
    string,
    Record<number, { buyIn: number; cashOut: number }>
  > = {};

  for (const player of players) {
    const uId = player.user_id;
    const sId = Number(player.session_id);
    if (!userSessionMap[uId]) {
      userSessionMap[uId] = {};
    }
    if (!userSessionMap[uId][sId]) {
      userSessionMap[uId][sId] = { buyIn: 0, cashOut: 0 };
    }
    userSessionMap[uId][sId].buyIn += Number(player.buy_in);
    userSessionMap[uId][sId].cashOut += Number(player.cash_out);
  }

  const userIds = Object.keys(userSessionMap);
  let userMap = new Map<string, any>();
  if (userIds.length > 0) {
    const { data: users } = await supabase.from('users').select('*').in('id', userIds);
    if (users) {
      userMap = new Map(users.map(u => [u.id, u]));
    }
  }

  const results: RankedPlayerStats[] = Object.entries(userSessionMap).map(([userId, sessionsObj]) => {
    const user = userMap.get(userId);
    const sessionList = Object.values(sessionsObj);
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

/**
 * Migrate data from local poker-data.json to Supabase if Supabase is completely empty
 */
export async function autoMigrateLocalData(): Promise<void> {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const dbFilePath = path.join(dataDir, 'poker-data.json');
    if (!fs.existsSync(dbFilePath)) return;

    const raw = fs.readFileSync(dbFilePath, 'utf-8');
    const local = JSON.parse(raw);
    const supabase = getSupabase();

    // Check if Supabase already has sessions
    const { count } = await supabase.from('sessions').select('*', { count: 'exact', head: true });
    if (count && count > 0) {
      return; // Already has data, do not overwrite
    }

    const localUsers = Object.values(local.users || {}) as any[];
    if (localUsers.length > 0) {
      console.log(`📦 Migrating ${localUsers.length} users to Supabase...`);
      await supabase.from('users').upsert(localUsers, { onConflict: 'id' });
    }

    const localSessions = Object.values(local.sessions || {}) as any[];
    if (localSessions.length > 0) {
      console.log(`📦 Migrating ${localSessions.length} sessions to Supabase...`);
      for (const s of localSessions) {
        await supabase.from('sessions').upsert({
          id: s.id,
          guild_id: s.guild_id,
          channel_id: s.channel_id,
          host_id: s.host_id,
          default_buyin: s.default_buyin,
          status: s.status,
          message_id: s.message_id,
          created_at: s.created_at,
          ended_at: s.ended_at,
        });
      }
    }

    const localPlayers = Object.values(local.session_players || {}) as any[];
    if (localPlayers.length > 0) {
      console.log(`📦 Migrating ${localPlayers.length} player records to Supabase...`);
      for (const p of localPlayers) {
        await supabase.from('session_players').upsert({
          id: p.id,
          session_id: p.session_id,
          user_id: p.user_id,
          buy_in: p.buy_in,
          cash_out: p.cash_out,
          status: p.status,
          left_at: p.left_at,
          created_at: p.created_at,
        });
      }
    }

    const localSettlements = Object.values(local.settlements || {}) as any[];
    if (localSettlements.length > 0) {
      console.log(`📦 Migrating ${localSettlements.length} settlement records to Supabase...`);
      for (const st of localSettlements) {
        await supabase.from('settlements').upsert({
          id: st.id,
          session_id: st.session_id,
          from_user_id: st.from_user_id,
          to_user_id: st.to_user_id,
          amount: st.amount,
          created_at: st.created_at,
        });
      }
    }

    console.log('✅ Local data migration to Supabase completed successfully!');
  } catch (err) {
    console.warn('Note: Auto-migration from local file skipped or failed:', err);
  }
}

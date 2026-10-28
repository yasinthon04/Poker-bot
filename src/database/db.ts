import fs from 'fs';
import path from 'path';

export interface UserRecord {
  id: string;
  username: string;
  display_name: string | null;
  promptpay: string | null;
  qr_image_url: string | null;
  created_at: string;
}

export interface SessionRecord {
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

export interface SessionPlayerRecord {
  id: number;
  session_id: number;
  user_id: string;
  buy_in: number;
  cash_out: number | null;
  status: 'playing' | 'left';
  left_at: string | null;
  created_at: string;
}

export interface SettlementRecord {
  id: number;
  session_id: number;
  from_user_id: string;
  to_user_id: string;
  amount: number;
  created_at: string;
}

export interface DatabaseSchema {
  users: Record<string, UserRecord>;
  sessions: Record<string, SessionRecord>;
  session_players: Record<string, SessionPlayerRecord>;
  settlements: Record<string, SettlementRecord>;
  counters: {
    sessionId: number;
    sessionPlayerId: number;
    settlementId: number;
  };
}

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbFilePath = path.join(dataDir, 'poker-data.json');

const initialData: DatabaseSchema = {
  users: {},
  sessions: {},
  session_players: {},
  settlements: {},
  counters: {
    sessionId: 0,
    sessionPlayerId: 0,
    settlementId: 0,
  },
};

let memoryDb: DatabaseSchema = initialData;

// Load existing data on startup
if (fs.existsSync(dbFilePath)) {
  try {
    const raw = fs.readFileSync(dbFilePath, 'utf-8');
    memoryDb = { ...initialData, ...JSON.parse(raw) };
  } catch (err) {
    console.error('Failed to read db file, using fresh store:', err);
    memoryDb = initialData;
  }
} else {
  fs.writeFileSync(dbFilePath, JSON.stringify(initialData, null, 2), 'utf-8');
}

export function getMemoryDb(): DatabaseSchema {
  return memoryDb;
}

let saveTimeout: NodeJS.Timeout | null = null;

export function persistDb(): void {
  // Debounce save to disk
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      const tempPath = `${dbFilePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(memoryDb, null, 2), 'utf-8');
      fs.renameSync(tempPath, dbFilePath);
    } catch (err) {
      console.error('Failed to persist database to disk:', err);
    }
  }, 100);
}

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config();

// Polyfill native WebSocket for Node.js runtimes < 22 (e.g. Render Node 20)
if (typeof (globalThis as any).WebSocket === 'undefined') {
  (globalThis as any).WebSocket = WebSocket;
}

let supabaseInstance: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  if (process.env.NODE_ENV === 'test') return false;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  return Boolean(url && key && url !== 'your_supabase_url_here' && key !== 'your_supabase_key_here');
}

export function normalizeSupabaseUrl(rawUrl?: string): string {
  if (!rawUrl) return '';
  return rawUrl.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
}

export function getSupabase(): SupabaseClient {
  if (supabaseInstance) return supabaseInstance;

  const rawUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!rawUrl || !key) {
    throw new Error('Supabase is not configured. Please set SUPABASE_URL and SUPABASE_KEY in your environment.');
  }

  const cleanUrl = normalizeSupabaseUrl(rawUrl);

  supabaseInstance = createClient(cleanUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      transport: WebSocket as any,
    },
  });

  return supabaseInstance;
}

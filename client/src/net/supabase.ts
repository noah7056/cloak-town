import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Publishable key is safe to ship in the client (RLS enforces access).
// Accepts both the current `sb_publishable_…` key and the legacy anon JWT:
//   VITE_SUPABASE_URL=https://xyz.supabase.co
//   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
const url = (import.meta.env.VITE_SUPABASE_URL || "").trim();
const key = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  ""
).trim();

let client: SupabaseClient | null = null;

export function supabaseConfigured(): boolean {
  return !!url && !!key;
}

export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured()) return null;
  if (!client) {
    client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: "cloak-town-auth",
      },
    });
  }
  return client;
}

export function supabaseEnvHint(): string {
  if (url && key) return "";
  const missing = [
    !url ? "VITE_SUPABASE_URL" : "",
    !key ? "VITE_SUPABASE_PUBLISHABLE_KEY" : "",
  ].filter(Boolean);
  return `Add ${missing.join(" + ")} to client/.env.local (see .env.example).`;
}

// Room invites older than this count as expired (sender/recipient delete
// rows on accept/decline; expiry is enforced client-side when listing).
export const INVITE_TTL_MS = 150_000;

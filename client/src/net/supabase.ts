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

// Set before an explicit sign-out so the app can tell user-initiated
// logouts apart from server-killed sessions (expired/rotated token).
export const signoutIntent = { current: false };

// Room invites older than this count as expired (sender/recipient delete
// rows on accept/decline; expiry is enforced client-side when listing).
export const INVITE_TTL_MS = 150_000;

// Profile reads are column-tolerant: if the database predates newer fields
// (schema.sql not re-run), the first 42703 failure permanently downgrades
// this session to the legacy column set instead of blanking every panel.
export const PROFILE_COLS_FULL =
  "id, username, display_name, bio, avatar_url, avatar, country, languages, card_color, card_color2, card_text, avatar_crop";
const PROFILE_COLS_LEGACY = "id, username, display_name, bio, avatar_url, avatar";
let profileCols = PROFILE_COLS_FULL;

export function profileColsDowngraded(): boolean {
  return profileCols !== PROFILE_COLS_FULL;
}

type ProfResult = { data: any; error: any };

export async function profilesQuery(
  run: (cols: string) => PromiseLike<ProfResult>
): Promise<ProfResult> {
  let r = await run(profileCols);
  const sig = (r.error?.message || "") + " " + (r.error?.code || "");
  if (r.error && profileCols !== PROFILE_COLS_LEGACY && /does not exist|42703/.test(sig)) {
    profileCols = PROFILE_COLS_LEGACY;
    r = await run(PROFILE_COLS_LEGACY);
  }
  return r;
}

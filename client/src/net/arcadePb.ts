import { getSupabase } from "./supabase";

export type ArcadePb = {
  /** best snake score on any device */
  snakeBest: number;
  /** pong matches won on any device */
  pongWins: number;
};

const ZERO: ArcadePb = { snakeBest: 0, pongWins: 0 };

// Set once we learn the table is missing (schema.sql not re-run): stop
// hitting it for the rest of the session instead of erroring every game.
let tableMissing = false;

async function myId(): Promise<string | null> {
  const c = getSupabase();
  if (!c || tableMissing) return null;
  const { data: { user } } = await c.auth.getUser();
  return user?.id ?? null;
}

/** Your cross-device arcade records (zeros for guests / unconfigured). */
export async function fetchArcadePb(): Promise<ArcadePb> {
  const c = getSupabase();
  if (!c || tableMissing) return { ...ZERO };
  const uid = await myId();
  if (!uid) return { ...ZERO };
  const { data, error } = await c
    .from("arcade_pb")
    .select("game, best, wins")
    .eq("user_id", uid);
  if (error) {
    if (/does not exist|42P01|42703/.test((error.message || "") + " " + (error.code || ""))) {
      tableMissing = true;
    }
    return { ...ZERO };
  }
  const out = { ...ZERO };
  for (const r of data || []) {
    if (r.game === "snake") out.snakeBest = Math.max(0, Number(r.best) || 0);
    if (r.game === "pong") out.pongWins = Math.max(0, Number(r.wins) || 0);
  }
  return out;
}

/** Record a snake score; keeps the higher of stored vs new. Returns the best. */
export async function reportSnakeBest(score: number): Promise<number> {
  const c = getSupabase();
  if (!c || tableMissing) return Math.max(0, Math.floor(score) || 0);
  const uid = await myId();
  if (!uid) return Math.max(0, Math.floor(score) || 0);
  const clean = Math.max(0, Math.floor(score) || 0);
  try {
    const { data, error } = await c
      .from("arcade_pb")
      .select("best")
      .eq("user_id", uid)
      .eq("game", "snake")
      .maybeSingle();
    if (error) throw error;
    const prev = Math.max(0, Number((data as any)?.best) || 0);
    if (clean <= prev) return prev;
    const { error: upErr } = await c
      .from("arcade_pb")
      .upsert({ user_id: uid, game: "snake", best: clean }, { onConflict: "user_id,game" });
    if (upErr) throw upErr;
    return clean;
  } catch (e: any) {
    if (/does not exist|42P01|42703/.test((e?.message || "") + " " + (e?.code || ""))) {
      tableMissing = true;
    }
    return clean;
  }
}

/** Record a pong match win; returns the new total. */
export async function reportPongWin(): Promise<number> {
  const c = getSupabase();
  if (!c || tableMissing) return 1;
  const uid = await myId();
  if (!uid) return 1;
  try {
    const { data, error } = await c
      .from("arcade_pb")
      .select("wins")
      .eq("user_id", uid)
      .eq("game", "pong")
      .maybeSingle();
    if (error) throw error;
    const next = Math.max(0, Number((data as any)?.wins) || 0) + 1;
    const { error: upErr } = await c
      .from("arcade_pb")
      .upsert({ user_id: uid, game: "pong", wins: next }, { onConflict: "user_id,game" });
    if (upErr) throw upErr;
    return next;
  } catch (e: any) {
    if (/does not exist|42P01|42703/.test((e?.message || "") + " " + (e?.code || ""))) {
      tableMissing = true;
    }
    return 1;
  }
}

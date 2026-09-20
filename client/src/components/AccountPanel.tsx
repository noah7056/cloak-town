import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase, supabaseConfigured, supabaseEnvHint, INVITE_TTL_MS } from "../net/supabase";
import type { Avatar } from "../game/avatar";

type Profile = {
  id: string;
  username: string | null;
  display_name: string;
  bio: string;
  avatar_url?: string;
  avatar?: Avatar | null;
};

type Friendship = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted" | "blocked";
};

type FriendRow = Friendship & { other: Profile };

type RoomInvite = {
  id: string;
  from_id: string;
  room_code: string;
  server_name: string;
  created_at: string;
  from: Profile;
};

type Tab = "profile" | "friends" | "danger";
type StartTab = "profile" | "friends";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const SELECT_COLS = "id, username, display_name, bio, avatar_url, avatar";

// Cross-mount cache: the modal conditionally mounts on every open, so
// without this the header/avatar/lists would pop in after each fade-in
// (reads as a glitch). Last-loaded server data paints instantly; the
// session effect below still refreshes in the background. Keyed by uid,
// cleared on sign-out so accounts never leak into each other.
type ProfileSnapshot = {
  uid: string;
  profile: Profile | null;
  friends: FriendRow[];
  incoming: FriendRow[];
  outgoing: FriendRow[];
  invites: RoomInvite[];
  username: string;
  displayName: string;
  bio: string;
  pfpPreview: string;
};
let profileCache: ProfileSnapshot | null = null;

/* ---------- brand glyphs (inline SVG, no assets needed) ---------- */
function DiscordGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.0741.0741 0 00-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 00.031.056 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 01.078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.099.246.198.373.292a.077.077 0 01-.006.127 12.3 12.3 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.84 19.84 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.334-.956 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.334-.946 2.419-2.157 2.419z" />
    </svg>
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
    </svg>
  );
}

/* ---------- account modal ---------- */

/**
 * Account modal for the lobby (opened from the round account button).
 * Same recipe as every other menu: useAnimatedOpen in App keeps it mounted
 * for the exit animation, pp-anim-fade-* backdrop + pp-panel
 * pp-anim-center-* card, mounted at lobby root.
 * Logged out: email in/up + Discord/Google OAuth. Logged in: tabs for
 * profile (username, display name, bio, picture), friends, and danger
 * zone (log out / delete). Guests who never open it play as before —
 * the server accepts null userId.
 */
export default function AccountPanel({
  open,
  closing,
  onClose,
  onAccount,
  accountId,
  startTab,
  inviteCode,
  roomUserIds,
  serverName,
  onJoinRoom,
}: {
  open: boolean;
  closing: boolean;
  onClose: () => void;
  onAccount: (userId: string | null, displayName: string, cloudAvatar?: Avatar | null) => void;
  /** signed-in user id (App session truth) — keys the cross-mount cache */
  accountId: string | null;
  /** which tab to land on when the modal opens (bell → friends) */
  startTab: StartTab;
  /** current room code when in game — enables per-friend Invite buttons */
  inviteCode: string | null;
  /** account ids currently in that room — inviting them is pointless */
  roomUserIds: string[];
  serverName: string;
  /** join a room by code from anywhere (room invite accept) */
  onJoinRoom: (code: string) => void;
}) {
  const sb = getSupabase();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  // Fresh mount on every open (conditional mount in App), so the tab
  // initializer lands directly on the right tab — no first-paint flip —
  // and transient state always starts clean. Data arrives via the session
  // effect below, which re-runs on every mount.
  const [tab, setTab] = useState<Tab>(startTab);
  const cachedForMe = profileCache && accountId && profileCache.uid === accountId ? profileCache : null;
  const [profile, setProfile] = useState<Profile | null>(() => cachedForMe?.profile || null);
  const [friends, setFriends] = useState<FriendRow[]>(() => cachedForMe?.friends || []);
  const [incoming, setIncoming] = useState<FriendRow[]>(() => cachedForMe?.incoming || []);
  const [outgoing, setOutgoing] = useState<FriendRow[]>(() => cachedForMe?.outgoing || []);
  const [invites, setInvites] = useState<RoomInvite[]>(() => cachedForMe?.invites || []);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // profile draft (seeded from cache so fields never flash empty either)
  const [username, setUsername] = useState(() => cachedForMe?.username || "");
  const [displayName, setDisplayName] = useState(() => cachedForMe?.displayName || "");
  const [bio, setBio] = useState(() => cachedForMe?.bio || "");
  const [pfpPreview, setPfpPreview] = useState(() => cachedForMe?.pfpPreview || "");
  const fileRef = useRef<HTMLInputElement>(null);
  // nested confirm popup for the danger tab ("logout" | "delete" | null)
  const [confirm, setConfirm] = useState<null | "logout" | "delete">(null);

  const errText = (e: unknown, fallback: string) =>
    e instanceof Error
      ? e.message
      : typeof e === "object" && e !== null && "message" in e && typeof (e as Record<string, unknown>).message === "string"
        ? (e as Record<string, string>).message
        : fallback;
  const fail = (e: unknown, fallback: string) => setMsg(errText(e, fallback));

  const loadAll = useCallback(async (uid: string) => {
    const c = getSupabase();
    if (!c) return;
    setBusy(true);
    setMsg("");
    try {
      const { data: prof, error: pErr } = await c
        .from("profiles")
        .select(SELECT_COLS)
        .eq("id", uid)
        .maybeSingle();
      if (pErr) throw pErr;
      let me = prof as Profile | null;
      if (!me) {
        // Signed up before schema.sql ran, or the trigger missed: create the
        // row now so users self-heal instead of sticking on a loader.
        const { data: { user } } = await c.auth.getUser();
        const meta = (user?.user_metadata || {}) as Record<string, unknown>;
        const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
        const emailBase = (user?.email || "").split("@")[0].replace(/[^a-zA-Z0-9_]/g, "");
        const rawBase = str(meta.display_name) || str(meta.full_name) || str(meta.name) || emailBase || "cloakling";
        const cleanBase = (rawBase.replace(/[^a-zA-Z0-9_]/g, "") || "cloakling").slice(0, 15);
        const uname = `${cleanBase}_${uid.replace(/-/g, "").slice(0, 4)}`.slice(0, 20);
        const disp = (str(meta.display_name) || str(meta.full_name) || str(meta.name) || cleanBase).slice(0, 24);
        const { error: insErr } = await c
          .from("profiles")
          .upsert({ id: uid, username: uname, display_name: disp, bio: "" }, { onConflict: "id" });
        if (insErr) throw insErr;
        const { data: prof2, error: pErr2 } = await c
          .from("profiles")
          .select(SELECT_COLS)
          .eq("id", uid)
          .maybeSingle();
        if (pErr2) throw pErr2;
        me = prof2 as Profile | null;
      }
      if (me) {
        setProfile(me);
        setUsername(me.username || "");
        setDisplayName(me.display_name || "");
        setBio(me.bio || "");
        setPfpPreview(me.avatar_url || "");
        onAccount(uid, me.display_name || me.username || "", (me.avatar as Avatar | null) || null);
      }
      const { data: rows, error: fErr } = await c
        .from("friendships")
        .select("id, requester_id, addressee_id, status")
        .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`);
      if (fErr) throw fErr;
      const list = (rows || []) as Friendship[];
      const otherIds = [...new Set(list.map((r) => (r.requester_id === uid ? r.addressee_id : r.requester_id)))];
      let byId = new Map<string, Profile>();
      if (otherIds.length) {
        const { data: profs, error: qErr } = await c
          .from("profiles")
          .select(SELECT_COLS)
          .in("id", otherIds);
        if (qErr) throw qErr;
        byId = new Map(((profs || []) as Profile[]).map((p) => [p.id, p]));
      }
      const withOther = (r: Friendship): FriendRow => ({
        ...r,
        other: byId.get(r.requester_id === uid ? r.addressee_id : r.requester_id) || {
          id: "", username: "?", display_name: "?", bio: "",
        },
      });
      const f = list.filter((r) => r.status === "accepted").map(withOther);
      const i = list.filter((r) => r.status === "pending" && r.addressee_id === uid).map(withOther);
      const o = list.filter((r) => r.status === "pending" && r.requester_id === uid).map(withOther);
      setFriends(f);
      setIncoming(i);
      setOutgoing(o);
      // room invites: pending + fresh only (older rows count as expired)
      const { data: invRows, error: iErr } = await c
        .from("room_invites")
        .select("id, from_id, room_code, server_name, created_at")
        .eq("to_id", uid)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(10);
      if (iErr) throw iErr;
      const fresh = ((invRows || []) as Omit<RoomInvite, "from">[]).filter(
        (r) => Date.now() - new Date(r.created_at).getTime() < INVITE_TTL_MS
      );
      let inv: RoomInvite[] = [];
      if (fresh.length) {
        const { data: inviters, error: vErr } = await c
          .from("profiles")
          .select("id, username, display_name, bio, avatar_url")
          .in("id", [...new Set(fresh.map((r) => r.from_id))]);
        if (vErr) throw vErr;
        const vById = new Map(((inviters || []) as Profile[]).map((p) => [p.id, p]));
        inv = fresh.map((r) => ({
          ...r,
          from: vById.get(r.from_id) || { id: r.from_id, username: "?", display_name: "?", bio: "" },
        }));
      }
      setInvites(inv);
      // snapshot for instant paints on later opens (keyed by uid)
      const uname = me?.username || "";
      const dname = me?.display_name || "";
      const bb = me?.bio || "";
      const pp = me?.avatar_url || "";
      profileCache = {
        uid, profile: me, friends: f, incoming: i, outgoing: o, invites: inv,
        username: uname, displayName: dname, bio: bb, pfpPreview: pp,
      };
    } catch (e) {
      fail(e, "Couldn't load your account.");
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id || null;
      setUserId(uid);
      if (!uid) onAccount(null, "");
      else void loadAll(uid);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_ev, session) => {
      const uid = session?.user?.id || null;
      setUserId(uid);
      if (!uid) {
        profileCache = null;
        setProfile(null);
        setFriends([]);
        setIncoming([]);
        setOutgoing([]);
        setInvites([]);
        setUsername("");
        setDisplayName("");
        setBio("");
        setPfpPreview("");
        setTab("profile");
        onAccount(null, "");
      } else {
        void loadAll(uid);
      }
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (no open-effect needed: conditional mounting starts every open fresh,
  // and the session effect below refetches on each mount)

  // Same skeleton as SettingsModal: fixed-height sheet, header + tabs stay
  // put, only the tab body scrolls. Visibility is driven SOLELY by App's
  // conditional mount (accountAnim.shouldRender) — never gate on `open`
  // here: `closing` flips true in an effect after the close commit, so an
  // extra local gate would blank one frame (vanish → reappear → fade out).
  const shell = (body: React.ReactNode) => (
    <>
      <div
        className={closing ? "pp-anim-fade-out" : "pp-anim-fade-in"}
        style={st.backdrop}
        onClick={onClose}
      />
      <div className={closing ? "pp-anim-center-out" : "pp-anim-center-in"} style={st.modal}>
        <div className="pp-panel" style={st.sheet}>
          {body}
        </div>
      </div>
    </>
  );

  const sheetBody = (body: React.ReactNode) => (
    <div className="pp-scroll" style={st.body}>
      {body}
      {msg && <div style={{ fontSize: 13, fontWeight: 700, color: "#6b543f" }}>{msg}</div>}
    </div>
  );

  const header = (title: string) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <h2 style={{ margin: 0, fontSize: 21, fontWeight: 900 }}>{title}</h2>
      <button className="pp-iconbtn pp-iconbtn-off" style={{ width: 38, height: 38, fontSize: 15 }} onClick={onClose} title="Close">✕</button>
    </div>
  );

  if (!supabaseConfigured() || !sb) {
    return shell(<>{header("Account")}<div style={{ fontSize: 13, fontWeight: 700, color: "#6b543f" }}>Accounts not configured. {supabaseEnvHint()}</div></>);
  }

  const signUp = async () => {
    setMsg("");
    setBusy(true);
    try {
      const { error } = await sb.auth.signUp({
        email: email.trim(),
        password,
        // Send the confirmation link back to wherever they signed up from
        // (must be allowlisted in Supabase Auth → URL Configuration).
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setMsg("Check your inbox to confirm your email, then sign in.");
    } catch (e) {
      fail(e, "Sign-up failed.");
    } finally {
      setBusy(false);
    }
  };

  const signIn = async () => {
    setMsg("");
    setBusy(true);
    try {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
    } catch (e) {
      // Supabase deliberately returns one generic message for both cases
      // (so strangers can't probe which emails are registered) — translate
      // it into something helpful instead of parroting it.
      const m = errText(e, "Sign-in failed.");
      setMsg(
        /invalid login credentials/i.test(m)
          ? "No match for that email + password — wrong password, or no account yet (hit Sign up)."
          : m
      );
    } finally {
      setBusy(false);
    }
  };

  // Discord / Google: the browser leaves for the provider and comes back to
  // window.location.origin (allowlisted in Auth → URL Configuration). Signup
  // vs login is automatic — no password involved.
  const oauth = async (provider: "discord" | "google") => {
    setMsg("");
    try {
      const { error } = await sb.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch (e) {
      fail(e, `Couldn't start ${provider} sign-in.`);
    }
  };

  if (!userId) {
    return shell(
      <>
        {header("Account")}
        {sheetBody(
          <>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#6b543f" }}>
              Log in or sign up to keep a profile and friends — or just close this and play as a guest.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="pp-btn" style={{ flex: 1, background: "#5865F2", color: "white", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                onClick={() => oauth("discord")} title="Continue with Discord">
                <DiscordGlyph /> Discord
              </button>
              <button className="pp-btn" style={{ flex: 1, background: "#fff8e7", color: "#4a3728", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                onClick={() => oauth("google")} title="Continue with Google">
                <GoogleGlyph /> Google
              </button>
            </div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#6b543f", textAlign: "center" }}>— or with email —</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input className="pp-input" style={{ margin: 0 }} value={email} id="ct-email" name="email"
                onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" autoComplete="email" />
              <input className="pp-input" style={{ margin: 0 }} value={password} id="ct-password" name="password"
                onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password"
                autoComplete="current-password" onKeyDown={(e) => e.key === "Enter" && signIn()} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="pp-btn pp-btn-leaf" style={{ flex: 1 }} disabled={busy || !email || !password} onClick={signIn}>
                Log in
              </button>
              <button className="pp-btn pp-btn-cream" style={{ flex: 1 }} disabled={busy || !email || !password} onClick={signUp}>
                Sign up
              </button>
            </div>
          </>
        )}
      </>
    );
  }

  const label = (p: Profile) => p.username ? `@${p.username}` : p.display_name || "cloakling";
  const tabs: { id: Tab; name: string; badge?: number }[] = [
    { id: "profile", name: "Profile" },
    { id: "friends", name: `Friends (${friends.length})`, badge: incoming.length },
    { id: "danger", name: "Settings" },
  ];

  const saveProfile = async () => {
    if (!userId) return;
    const u = username.trim();
    if (u && !USERNAME_RE.test(u)) {
      setMsg("Username: 3–20 letters, numbers or _ only.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const { error } = await sb
        .from("profiles")
        .update({
          username: u || null,
          display_name: displayName.trim().slice(0, 24),
          bio: bio.trim().slice(0, 140),
        })
        .eq("id", userId);
      if (error) throw error;
      setMsg("Profile saved.");
      await loadAll(userId);
    } catch (e) {
      fail(e, "Couldn't save (username may be taken).");
    } finally {
      setBusy(false);
    }
  };

  const uploadPfp = async (file: File) => {
    if (!userId) return;
    if (!file.type.startsWith("image/")) {
      setMsg("That file isn't an image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setMsg("Keep it under 2MB.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase().slice(0, 4);
      const path = `${userId}/avatar.${ext}`;
      const { error: upErr } = await sb.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = sb.storage.from("avatars").getPublicUrl(path);
      const busted = `${data.publicUrl}?t=${Date.now()}`;
      const { error: dbErr } = await sb.from("profiles").update({ avatar_url: data.publicUrl }).eq("id", userId);
      if (dbErr) throw dbErr;
      setPfpPreview(busted);
      setMsg("Picture updated.");
    } catch (e) {
      fail(e, "Couldn't upload that picture.");
    } finally {
      setBusy(false);
    }
  };

  const doSearch = async () => {
    const q = search.trim().replace(/[%_]/g, "");
    if (q.length < 2 || !userId) return;
    setBusy(true);
    setMsg("");
    try {
      const { data, error } = await sb
        .from("profiles")
        .select(SELECT_COLS)
        .ilike("username", `%${q}%`)
        .neq("id", userId)
        .limit(8);
      if (error) throw error;
      setResults((data || []) as Profile[]);
      if (!data || data.length === 0) setMsg("No cloaklings found with that name.");
    } catch (e) {
      fail(e, "Search failed.");
    } finally {
      setBusy(false);
    }
  };

  const sendRequest = async (to: Profile) => {
    if (!userId) return;
    setBusy(true);
    setMsg("");
    try {
      const { data: existing, error: xErr } = await sb
        .from("friendships")
        .select("id")
        .or(
          `and(requester_id.eq.${userId},addressee_id.eq.${to.id}),and(requester_id.eq.${to.id},addressee_id.eq.${userId})`
        )
        .limit(1);
      if (xErr) throw xErr;
      if (existing && existing.length > 0) {
        setMsg("You already have something going with them.");
        return;
      }
      const { error } = await sb.from("friendships").insert({
        requester_id: userId,
        addressee_id: to.id,
        status: "pending",
      });
      if (error) throw error;
      setMsg(`Request sent to ${to.username || to.display_name}.`);
      await loadAll(userId);
    } catch (e) {
      fail(e, "Couldn't send the request.");
    } finally {
      setBusy(false);
    }
  };

  const accept = async (id: string) => {
    if (!userId) return;
    setBusy(true);
    try {
      const { error } = await sb
        .from("friendships")
        .update({ status: "accepted" })
        .eq("id", id)
        .eq("addressee_id", userId);
      if (error) throw error;
      await loadAll(userId);
    } catch (e) {
      fail(e, "Couldn't accept.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!userId) return;
    setBusy(true);
    try {
      const { error } = await sb.from("friendships").delete().eq("id", id);
      if (error) throw error;
      await loadAll(userId);
    } catch (e) {
      fail(e, "Couldn't remove that.");
    } finally {
      setBusy(false);
    }
  };

  // Invite a friend to your current room (only offered while in game).
  // Replaces any still-pending invite to the same person so there's
  // never a stale pile — the row expires client-side after ~2.5 min.
  const sendInvite = async (toUserId: string) => {
    if (!userId || !inviteCode) return;
    if (roomUserIds.includes(toUserId)) {
      setMsg("They're already in this room with you.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const { error: delErr } = await sb
        .from("room_invites")
        .delete()
        .eq("from_id", userId)
        .eq("to_id", toUserId)
        .eq("status", "pending");
      if (delErr) throw delErr;
      const { error } = await sb.from("room_invites").insert({
        from_id: userId,
        to_id: toUserId,
        room_code: inviteCode,
        server_name: serverName,
        status: "pending",
      });
      if (error) throw error;
      setMsg("Invite sent — they'll see it in their friends tab.");
    } catch (e) {
      fail(e, "Couldn't send the invite.");
    } finally {
      setBusy(false);
    }
  };

  const answerInvite = async (inv: RoomInvite, accept: boolean) => {
    setBusy(true);
    try {
      await sb.from("room_invites").delete().eq("id", inv.id);
      setInvites((list) => list.filter((i) => i.id !== inv.id));
      if (accept) onJoinRoom(inv.room_code);
    } finally {
      setBusy(false);
    }
  };

  const doLogout = async () => {
    await sb.auth.signOut();
    onClose();
  };

  const doDelete = async () => {
    setBusy(true);
    setMsg("");
    try {
      const { error } = await sb.rpc("delete_own_account");
      if (error) throw error;
      await sb.auth.signOut();
      onClose();
    } catch (e) {
      fail(e, "Couldn't delete the account.");
    } finally {
      setBusy(false);
    }
  };

  const row = (r: Profile, right: React.ReactNode) => (
    <div key={r.id} className="pp-card" style={{ padding: "7px 10px", display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
      {r.avatar_url
        ? <img src={r.avatar_url} alt="" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover", border: "2px solid #4a3728", flexShrink: 0 }} />
        : null}
      <span style={{ flex: 1, minWidth: 0 }}><b>{label(r)}</b>{r.bio ? ` · ${r.bio.slice(0, 40)}` : ""}</span>
      {right}
    </div>
  );

  return shell(
    <>
      {header(profile ? label(profile) : "Account")}
      <div style={{ display: "flex", gap: 8 }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            className={"pp-choice" + (tab === t.id ? " pp-choice-on" : "")}
            style={{ flex: 1 }}
            onClick={() => { setTab(t.id); setMsg(""); }}
          >
            {t.name}
            {t.badge ? (
              <span style={{ marginLeft: 6, background: "#d95f4b", color: "white", borderRadius: 10, fontSize: 11, padding: "1px 7px" }}>
                {t.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {sheetBody(
        <>
          {tab === "profile" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              {pfpPreview
                ? <img src={pfpPreview} alt="profile" style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover", border: "3px solid #4a3728", flexShrink: 0 }} />
                : <span style={{ width: 64, height: 64, borderRadius: "50%", background: "#d9c193", border: "3px solid #4a3728", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 900, color: "#6b543f", flexShrink: 0 }}>
                  {(displayName || username || "?").slice(0, 1).toUpperCase()}
                </span>}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                <input ref={fileRef} type="file" accept="image/*" id="ct-pfp" name="pfp" style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void uploadPfp(f);
                  }} />
                <button className="pp-btn pp-btn-wood" style={{ padding: "8px 12px", fontSize: 13 }} disabled={busy}
                  onClick={() => fileRef.current?.click()}>
                  Upload picture
                </button>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#6b543f" }}>Square images work best · max 2MB</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div className="pp-section-title">Username</div>
                <input className="pp-input" style={{ margin: 0 }} value={username} id="ct-username" name="username" autoComplete="username"
                  onChange={(e) => setUsername(e.target.value)} maxLength={20} placeholder="username" />
              </div>
              <div style={{ flex: 1 }}>
                <div className="pp-section-title">Display name</div>
                <input className="pp-input" style={{ margin: 0 }} value={displayName} id="ct-handle" name="handle"
                  onChange={(e) => setDisplayName(e.target.value)} maxLength={24} placeholder="Display name" />
              </div>
            </div>
            <div className="pp-section-title">Description</div>
            <textarea className="pp-textarea" style={{ margin: 0 }} value={bio} id="ct-bio" name="bio"
              onChange={(e) => setBio(e.target.value)} maxLength={140} placeholder="A line about you…" />
            <button className="pp-btn pp-btn-leaf" disabled={busy} onClick={saveProfile}>Save profile</button>
          </div>
        )}

      {tab === "friends" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="pp-input" style={{ margin: 0, flex: 1, minWidth: 0 }} value={search} id="ct-friend-search" name="friendSearch"
              onChange={(e) => setSearch(e.target.value)} maxLength={20} placeholder="Search @username…"
              onKeyDown={(e) => e.key === "Enter" && doSearch()} />
            <button className="pp-btn pp-btn-wood" style={{ flexShrink: 0 }} disabled={busy} onClick={doSearch}>⌕</button>
          </div>
          {invites.length > 0 && (
            <>
              <div className="pp-section-title">Room invites (expire after a couple minutes)</div>
              {invites.map((inv) => (
                <div key={inv.id} className="pp-card" style={{ padding: "7px 10px", display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b>{label(inv.from)}</b>
                    <span style={{ color: "#6b543f" }}> → {inv.server_name || inv.room_code} ({inv.room_code})</span>
                  </span>
                  <button className="pp-btn pp-btn-leaf" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy} onClick={() => answerInvite(inv, true)}>Join</button>
                  <button className="pp-btn pp-btn-cream" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy} onClick={() => answerInvite(inv, false)}>No</button>
                </div>
              ))}
            </>
          )}
          {results.map((r) => row(r,
            <button className="pp-btn pp-btn-leaf" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy} onClick={() => sendRequest(r)}>
              + Add
            </button>
          ))}
          {incoming.length > 0 && (
            <>
              <div className="pp-section-title">Requests for you</div>
              {incoming.map((r) => row(r.other,
                <span style={{ display: "flex", gap: 6 }}>
                  <button className="pp-btn pp-btn-leaf" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy} onClick={() => accept(r.id)}>✓</button>
                  <button className="pp-btn pp-btn-cream" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy} onClick={() => remove(r.id)}>✕</button>
                </span>
              ))}
            </>
          )}
          {outgoing.length > 0 && (
            <>
              <div className="pp-section-title">Sent (waiting)</div>
              {outgoing.map((r) => row(r.other,
                <button className="pp-btn pp-btn-cream" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy} onClick={() => remove(r.id)}>Cancel</button>
              ))}
            </>
          )}
          <div className="pp-section-title">Friends ({friends.length})</div>
          {friends.length === 0 && (
            <div style={{ fontSize: 13, fontWeight: 700, color: "#6b543f" }}>No cloakling friends yet — search a username above.</div>
          )}
          {friends.map((r) => row(r.other,
            <span style={{ display: "flex", gap: 6 }}>
              {inviteCode && r.other.id && (
                <button className="pp-btn pp-btn-leaf" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy} onClick={() => sendInvite(r.other.id)}>Invite</button>
              )}
              <button className="pp-btn pp-btn-cream" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy} onClick={() => remove(r.id)}>Remove</button>
            </span>
          ))}
        </div>
      )}

          {tab === "danger" && (
            <>
              <button className="pp-btn pp-btn-wood" style={{ minHeight: 44 }} onClick={() => setConfirm("logout")}>
                Log out
              </button>
              <button className="pp-btn pp-btn-danger" style={{ minHeight: 44 }} disabled={busy} onClick={() => setConfirm("delete")}>
                Delete account
              </button>
            </>
          )}
        </>
      )}
      {confirm && (
        <div
          style={{
            position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 5,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(43,26,18,0.55)",
          }}
          onClick={() => setConfirm(null)}
        >
          <div
            className="pp-panel"
            style={{ width: 300, maxWidth: "88%", padding: 18, display: "flex", flexDirection: "column", gap: 10 }}
            onClick={(e) => e.stopPropagation()}
          >
            <b style={{ fontSize: 17 }}>
              {confirm === "logout" ? "Log out?" : "Delete your account?"}
            </b>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#6b543f" }}>
              {confirm === "logout"
                ? "You can sign back in any time — friends and profile stay put."
                : "This removes your profile and friendships forever."}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="pp-btn pp-btn-cream" style={{ flex: 1 }} onClick={() => setConfirm(null)}>
                Cancel
              </button>
              {confirm === "logout" ? (
                <button className="pp-btn pp-btn-wood" style={{ flex: 1 }} onClick={() => { setConfirm(null); void doLogout(); }}>
                  Log out
                </button>
              ) : (
                <button className="pp-btn pp-btn-danger" style={{ flex: 1 }} disabled={busy} onClick={() => { setConfirm(null); void doDelete(); }}>
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const st: Record<string, React.CSSProperties> = {
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(43,26,18,0.62)", zIndex: 40 },
  modal: { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 560, maxWidth: "94%", zIndex: 41 },
  // Fixed sheet: header + tabs stay put, only the body scrolls.
  sheet: { height: "min(640px, 92vh)", display: "flex", flexDirection: "column", gap: 9, padding: 22 },
  body: { flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", gap: 9, paddingRight: 2 },
};

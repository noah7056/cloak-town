import { useCallback, useEffect, useState } from "react";
import { getSupabase, supabaseConfigured, supabaseEnvHint } from "../net/supabase";

type Profile = {
  id: string;
  username: string | null;
  display_name: string;
  bio: string;
};

type Friendship = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted" | "blocked";
};

type FriendRow = Friendship & { other: Profile };

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/**
 * Accounts + friends panel for the lobby. Fully optional: guests who never
 * sign in keep playing exactly as before (server accepts null userId).
 * Reports the signed-in user up via onAccount so the game join can link it.
 */
export default function AccountPanel({
  onAccount,
}: {
  onAccount: (userId: string | null, displayName: string) => void;
}) {
  const sb = getSupabase();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [incoming, setIncoming] = useState<FriendRow[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRow[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(false);
  // profile draft
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");

  const fail = (e: unknown, fallback: string) =>
    setMsg(e instanceof Error ? e.message : fallback);

  const loadAll = useCallback(async (uid: string) => {
    const c = getSupabase();
    if (!c) return;
    setBusy(true);
    setMsg("");
    try {
      const { data: prof, error: pErr } = await c
        .from("profiles")
        .select("id, username, display_name, bio")
        .eq("id", uid)
        .maybeSingle();
      if (pErr) throw pErr;
      if (prof) {
        setProfile(prof as Profile);
        setUsername((prof as Profile).username || "");
        setDisplayName((prof as Profile).display_name || "");
        setBio((prof as Profile).bio || "");
        onAccount(uid, (prof as Profile).display_name || (prof as Profile).username || "");
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
          .select("id, username, display_name, bio")
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
      setFriends(list.filter((r) => r.status === "accepted").map(withOther));
      setIncoming(list.filter((r) => r.status === "pending" && r.addressee_id === uid).map(withOther));
      setOutgoing(list.filter((r) => r.status === "pending" && r.requester_id === uid).map(withOther));
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
        setProfile(null);
        setFriends([]);
        setIncoming([]);
        setOutgoing([]);
        onAccount(null, "");
      } else {
        void loadAll(uid);
      }
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!supabaseConfigured() || !sb) {
    return (
      <div className="pp-card" style={{ padding: "10px 12px", fontSize: 13, fontWeight: 700, color: "#6b543f" }}>
        Accounts not configured. {supabaseEnvHint()}
      </div>
    );
  }

  const signUp = async () => {
    setMsg("");
    setBusy(true);
    try {
      const { error } = await sb.auth.signUp({ email: email.trim(), password });
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
      fail(e, "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await sb.auth.signOut();
  };

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

  const doSearch = async () => {
    const q = search.trim().replace(/[%_]/g, "");
    if (q.length < 2 || !userId) return;
    setBusy(true);
    setMsg("");
    try {
      const { data, error } = await sb
        .from("profiles")
        .select("id, username, display_name, bio")
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
      // don't double-request in either direction
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

  if (!userId) {
    return (
      <div className="pp-card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        <b style={{ fontSize: 14 }}>Accounts (optional — guests play fine)</b>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="pp-input" style={{ margin: 0, flex: 1, minWidth: 0 }} value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" autoComplete="email" />
          <input className="pp-input" style={{ margin: 0, flex: 1, minWidth: 0 }} value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password"
            autoComplete="current-password" onKeyDown={(e) => e.key === "Enter" && signIn()} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="pp-btn pp-btn-leaf" style={{ flex: 1 }} disabled={busy || !email || !password} onClick={signIn}>
            Sign in
          </button>
          <button className="pp-btn pp-btn-cream" style={{ flex: 1 }} disabled={busy || !email || !password} onClick={signUp}>
            Sign up
          </button>
        </div>
        {msg && <div style={{ fontSize: 13, fontWeight: 700, color: "#6b543f" }}>{msg}</div>}
      </div>
    );
  }

  const label = (p: Profile) => p.username ? `@${p.username}` : p.display_name || "cloakling";

  return (
    <div className="pp-card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <b style={{ fontSize: 14, flex: 1 }}>
          {profile ? label(profile) : "…"}
          {incoming.length > 0 && (
            <span style={{ marginLeft: 8, background: "#d95f4b", color: "white", borderRadius: 10, fontSize: 12, padding: "1px 8px" }}>
              {incoming.length} request{incoming.length === 1 ? "" : "s"}
            </span>
          )}
        </b>
        <button className="pp-btn pp-btn-cream" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Friends"}
        </button>
        <button className="pp-btn pp-btn-cream" style={{ padding: "6px 12px", fontSize: 13 }} onClick={signOut}>
          Out
        </button>
      </div>

      {open && (
        <>
          <div className="pp-section-title">Your profile</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="pp-input" style={{ margin: 0, flex: 1, minWidth: 0 }} value={username}
              onChange={(e) => setUsername(e.target.value)} maxLength={20} placeholder="username" />
            <input className="pp-input" style={{ margin: 0, flex: 1, minWidth: 0 }} value={displayName}
              onChange={(e) => setDisplayName(e.target.value)} maxLength={24} placeholder="Display name" />
          </div>
          <input className="pp-input" style={{ margin: 0 }} value={bio}
            onChange={(e) => setBio(e.target.value)} maxLength={140} placeholder="A line about you…" />
          <button className="pp-btn pp-btn-leaf" disabled={busy} onClick={saveProfile}>Save profile</button>

          <div className="pp-section-title">Add friends</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="pp-input" style={{ margin: 0, flex: 1, minWidth: 0 }} value={search}
              onChange={(e) => setSearch(e.target.value)} maxLength={20} placeholder="Search @username…"
              onKeyDown={(e) => e.key === "Enter" && doSearch()} />
            <button className="pp-btn pp-btn-wood" style={{ flexShrink: 0 }} disabled={busy} onClick={doSearch}>⌕</button>
          </div>
          {results.map((r) => (
            <div key={r.id} className="pp-card" style={{ padding: "7px 10px", display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
              <span style={{ flex: 1 }}><b>{label(r)}</b>{r.bio ? ` · ${r.bio.slice(0, 40)}` : ""}</span>
              <button className="pp-btn pp-btn-leaf" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy} onClick={() => sendRequest(r)}>
                + Add
              </button>
            </div>
          ))}

          {incoming.length > 0 && (
            <>
              <div className="pp-section-title">Requests for you</div>
              {incoming.map((r) => (
                <div key={r.id} className="pp-card" style={{ padding: "7px 10px", display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                  <span style={{ flex: 1 }}><b>{label(r.other)}</b></span>
                  <button className="pp-btn pp-btn-leaf" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy} onClick={() => accept(r.id)}>✓</button>
                  <button className="pp-btn pp-btn-cream" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy} onClick={() => remove(r.id)}>✕</button>
                </div>
              ))}
            </>
          )}

          {outgoing.length > 0 && (
            <>
              <div className="pp-section-title">Sent (waiting)</div>
              {outgoing.map((r) => (
                <div key={r.id} className="pp-card" style={{ padding: "7px 10px", display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                  <span style={{ flex: 1 }}><b>{label(r.other)}</b></span>
                  <button className="pp-btn pp-btn-cream" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy} onClick={() => remove(r.id)}>Cancel</button>
                </div>
              ))}
            </>
          )}

          <div className="pp-section-title">Friends ({friends.length})</div>
          {friends.length === 0 && (
            <div style={{ fontSize: 13, fontWeight: 700, color: "#6b543f" }}>No friends yet — search a username above.</div>
          )}
          {friends.map((r) => (
            <div key={r.id} className="pp-card" style={{ padding: "7px 10px", display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
              <span style={{ flex: 1 }}><b>{label(r.other)}</b>{r.other.bio ? ` · ${r.other.bio.slice(0, 40)}` : ""}</span>
              <button className="pp-btn pp-btn-cream" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy} onClick={() => remove(r.id)}>Remove</button>
            </div>
          ))}
        </>
      )}
      {msg && <div style={{ fontSize: 13, fontWeight: 700, color: "#6b543f" }}>{msg}</div>}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase, supabaseConfigured, supabaseEnvHint, INVITE_TTL_MS, profilesQuery, profileColsDowngraded } from "../net/supabase";
import { COUNTRIES, LANGUAGES, CARD_COLORS, TEXT_COLORS, DEFAULT_CROP, sanitizeCrop, cropImgStyle, type Crop } from "../net/profileMeta";
import ProfileCard from "./ProfileCard";
import { listGallery, listPinned, setPinned, deleteGalleryItem, downloadUrl, type GalleryItem } from "../net/gallery";
import { drawTraveler } from "../game/engine";
import type { Avatar } from "../game/avatar";
import type { Player } from "../net/socket";

type Profile = {
  id: string;
  username: string | null;
  display_name: string;
  bio: string;
  avatar_url?: string;
  avatar?: Avatar | null;
  country?: string;
  languages?: string[];
  card_color?: string;
  card_color2?: string;
  card_text?: string;
  avatar_crop?: Crop | null;
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

type Tab = "profile" | "gallery" | "friends" | "danger";
type StartTab = "profile" | "friends";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

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
  country: string;
  langA: string;
  langB: string;
  cardColor: string;
  cardColor2: string;
  cardText: string;
  crop: Crop;
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
 * Swatch row: default/none button + preset circles + rainbow custom picker
 * (same rainbow-circle treatment as the cloakling studio).
 */
function ColorRow({
  colors,
  value,
  onPick,
  noneLabel,
  rainbowId,
  rainbowName,
  fallback,
}: {
  colors: string[];
  value: string;
  onPick: (v: string) => void;
  noneLabel: string;
  rainbowId: string;
  rainbowName: string;
  fallback: string;
}) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <button
        className={"pp-choice" + (!value ? " pp-choice-on" : "")}
        style={{ minWidth: 64 }}
        onClick={() => onPick("")}
      >
        {noneLabel}
      </button>
      {colors.map((c) => (
        <button
          key={c}
          onClick={() => onPick(c)}
          title={c}
          aria-label={`Color ${c}`}
          style={{
            width: 30, height: 30, borderRadius: "50%", cursor: "pointer",
            background: c, padding: 0,
            border: value.toLowerCase() === c.toLowerCase() ? "3px solid #58a05c" : "3px solid #4a3728",
            boxShadow: "0 2px 0 #4a3728",
          }}
        />
      ))}
      <label
        title="Custom color"
        style={{
          width: 30, height: 30, borderRadius: "50%", cursor: "pointer",
          border: "3px dashed #4a3728", boxShadow: "0 2px 0 #4a3728",
          background: `conic-gradient(#ef4444,#facc15,#22c55e,#3b82f6,#a855f7,#ef4444)`,
          position: "relative", overflow: "hidden", display: "inline-block",
        }}
      >
        <input
          type="color" id={rainbowId} name={rainbowName} value={value || fallback}
          onChange={(e) => onPick(e.target.value)}
          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}
        />
      </label>
    </div>
  );
}
function CozySelect({
  id,
  name,
  value,
  placeholder,
  options,
  onPick,
  disabled,
}: {
  id: string;
  name: string;
  value: string;
  placeholder: string;
  options: string[];
  onPick: (v: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="pp-select-wrap" style={{ flex: 1, minWidth: 0 }}>
      <button
        type="button"
        id={id}
        name={name}
        className="pp-select"
        style={{
          display: "flex", alignItems: "center", gap: 6, textAlign: "left",
          overflow: "hidden", whiteSpace: "nowrap",
        }}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", color: value ? undefined : "#b39b72" }}>
          {value || placeholder}
        </span>
      </button>
      {open && (
        <>
          <span
            style={{ position: "fixed", inset: 0, zIndex: 15 }}
            onClick={() => setOpen(false)}
          />
          <span
            className="pp-card pp-scroll"
            style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 16,
              maxHeight: 180, overflowY: "auto", padding: 6,
              display: "flex", flexDirection: "column", gap: 2,
            }}
          >
            {[{ v: "", l: placeholder }, ...options.map((o) => ({ v: o, l: o }))].map((o) => (
              <button
                key={o.v + o.l}
                type="button"
                onClick={() => { onPick(o.v); setOpen(false); }}
                style={{
                  background: o.v === value ? "#f2c14e" : "none",
                  border: "none", borderRadius: 8, padding: "7px 10px", cursor: "pointer",
                  font: "inherit", fontSize: 14, fontWeight: 800, color: "#4a3728", textAlign: "left",
                }}
              >
                {o.l}
              </button>
            ))}
          </span>
        </>
      )}
    </span>
  );
}

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
  onFriendsList,
  avatar,
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
  /** accepted friends' account ids (App paints their nametags gold) */
  onFriendsList: (ids: string[]) => void;
  /** which tab to land on when the modal opens (bell → friends) */
  startTab: StartTab;
  /** current room code when in game — enables per-friend Invite buttons */
  inviteCode: string | null;
  /** account ids currently in that room — inviting them is pointless */
  roomUserIds: string[];
  serverName: string;
  /** join a room by code from anywhere (room invite accept) */
  onJoinRoom: (code: string) => void;
  /** your live cloakling look — offered as a profile picture source */
  avatar: Avatar;
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
  // gallery wall (own photos, newest first) + viewer index + friend pins
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [friendPinned, setFriendPinned] = useState<GalleryItem[]>([]);
  // friend whose profile is open (tap their name in the list)
  const [selectedFriend, setSelectedFriend] = useState<FriendRow | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // profile draft (seeded from cache so fields never flash empty either)
  const [username, setUsername] = useState(() => cachedForMe?.username || "");
  const [displayName, setDisplayName] = useState(() => cachedForMe?.displayName || "");
  const [bio, setBio] = useState(() => cachedForMe?.bio || "");
  const [pfpPreview, setPfpPreview] = useState(() => cachedForMe?.pfpPreview || "");
  const [country, setCountry] = useState(() => cachedForMe?.country || "");
  const [langA, setLangA] = useState(() => cachedForMe?.langA || "");
  const [langB, setLangB] = useState(() => cachedForMe?.langB || "");
  const [cardColor, setCardColor] = useState(() => cachedForMe?.cardColor || "");
  const [cardColor2, setCardColor2] = useState(() => cachedForMe?.cardColor2 || "");
  const [cardText, setCardText] = useState(() => cachedForMe?.cardText || "");
  const [crop, setCrop] = useState<Crop>(() => cachedForMe?.crop || { ...DEFAULT_CROP });
  const [cropEdit, setCropEdit] = useState(false);
  const [picMenu, setPicMenu] = useState(false);
  const [galleryPicker, setGalleryPicker] = useState(false);
  // gallery choice waiting for Save (avatar_url only persists on save)
  const [pendingAvatarUrl, setPendingAvatarUrl] = useState<string | null>(null);
  // snapshot to restore on X (tick keeps the live draft)
  const cropBefore = useRef<Crop>({ ...DEFAULT_CROP });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const openCropPopup = () => {
    cropBefore.current = { ...crop };
    setCropEdit(true);
  };
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
      const { data: prof, error: pErr } = await profilesQuery((cols) =>
        c.from("profiles").select(cols).eq("id", uid).maybeSingle()
      );
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
        const { data: prof2, error: pErr2 } = await profilesQuery((cols) =>
          c.from("profiles").select(cols).eq("id", uid).maybeSingle()
        );
        if (pErr2) throw pErr2;
        me = prof2 as Profile | null;
      }
      if (me) {
        setProfile(me);
        setUsername(me.username || "");
        setDisplayName(me.display_name || "");
        setBio(me.bio || "");
        setPfpPreview(me.avatar_url || "");
        setPendingAvatarUrl(null);
        setCountry(me.country || "");
        const langs = (me.languages || []).filter(Boolean).slice(0, 2);
        setLangA(langs[0] || "");
        setLangB(langs[1] || "");
        setCardColor(me.card_color || "");
        setCardColor2(me.card_color2 || "");
        setCardText(me.card_text || "");
        setCrop(sanitizeCrop(me.avatar_crop));
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
        const { data: profs, error: qErr } = await profilesQuery((cols) =>
          c.from("profiles").select(cols).in("id", otherIds)
        );
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
      onFriendsList(f.map((r) => r.other.id).filter(Boolean));
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
        const { data: inviters, error: vErr } = await profilesQuery((cols) =>
          c.from("profiles").select(cols).in("id", [...new Set(fresh.map((r) => r.from_id))])
        );
        if (vErr) throw vErr;
        const vById = new Map(((inviters || []) as Profile[]).map((p) => [p.id, p]));
        inv = fresh.map((r) => ({
          ...r,
          from: vById.get(r.from_id) || { id: r.from_id, username: "?", display_name: "?", bio: "" },
        }));
      }
      setInvites(inv);
      // gallery wall is bonus content — never fail the whole load for it
      try {
        setGallery(await listGallery(uid));
      } catch { /* offline or table missing — tab shows empty */ }
      // snapshot for instant paints on later opens (keyed by uid)
      const uname = me?.username || "";
      const dname = me?.display_name || "";
      const bb = me?.bio || "";
      const pp = me?.avatar_url || "";
      const clangs = (me?.languages || []).filter(Boolean).slice(0, 2);
      const ccrop = sanitizeCrop(me?.avatar_crop);
      profileCache = {
        uid, profile: me, friends: f, incoming: i, outgoing: o, invites: inv,
        username: uname, displayName: dname, bio: bb, pfpPreview: pp,
        country: me?.country || "", langA: clangs[0] || "", langB: clangs[1] || "",
        cardColor: me?.card_color || "", cardColor2: me?.card_color2 || "",
        cardText: me?.card_text || "", crop: ccrop,
      };
      if (profileColsDowngraded()) {
        setMsg("Heads up: your database is missing the newest profile fields — re-run supabase/schema.sql, then refresh, to unlock everything.");
      }
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
        setGallery([]);
        setViewerIdx(null);
        setConfirmDeleteId(null);
        setFriendPinned([]);
        setSelectedFriend(null);
        onFriendsList([]);
        setUsername("");
        setDisplayName("");
        setBio("");
        setPfpPreview("");
        setCountry("");
        setLangA("");
        setLangB("");
        setCardColor("");
        setCardColor2("");
        setCardText("");
        setCrop({ ...DEFAULT_CROP });
        setCropEdit(false);
        setTab("profile");
        onAccount(null, "");
      } else {
        void loadAll(uid);
      }
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // gallery viewer keyboard: arrows browse, ESC closes
  useEffect(() => {
    if (viewerIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewerIdx(null);
      else if (e.key === "ArrowLeft") { setConfirmDeleteId(null); setViewerIdx((i) => (i === null ? null : (i + gallery.length - 1) % gallery.length)); }
      else if (e.key === "ArrowRight") { setConfirmDeleteId(null); setViewerIdx((i) => (i === null ? null : (i + 1) % gallery.length)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewerIdx, gallery.length]);

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
    { id: "gallery", name: "Gallery" },
    { id: "friends", name: "Friends", badge: incoming.length },
    { id: "danger", name: "Settings" },
  ];

  const saveProfile = async () => {
    if (!userId) return;
    const u = username.trim();
    if (u && !USERNAME_RE.test(u)) {
      setMsg("Username: 3–20 letters, numbers or _ only.");
      return;
    }
    const langs = [langA, langB].filter(Boolean);
    if (new Set(langs).size !== langs.length) {
      setMsg("Pick two different languages (or leave one empty).");
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
          bio: bio.trim().slice(0, 280),
          country: country.slice(0, 60),
          languages: langs,
          card_color: cardColor,
          card_color2: cardColor2,
          card_text: cardText,
          avatar_crop: sanitizeCrop(crop),
          ...(pendingAvatarUrl ? { avatar_url: pendingAvatarUrl } : {}),
        })
        .eq("id", userId);
      if (error) throw error;
      setPendingAvatarUrl(null);
      setMsg("Profile saved.");
      await loadAll(userId);
    } catch (e) {
      fail(e, "Couldn't save (username may be taken).");
    } finally {
      setBusy(false);
    }
  };

  // Render your live cloakling to a PNG and use it as profile picture.
  const useCloaklingPicture = async () => {
    if (!userId) return;
    setPicMenu(false);
    setBusy(true);
    setMsg("");
    try {
      const S = 256;
      const cv = document.createElement("canvas");
      cv.width = S;
      cv.height = S;
      const ctx = cv.getContext("2d");
      if (!ctx) throw new Error("canvas unavailable");
      ctx.clearRect(0, 0, S, S);
      const pl: Player = {
        id: "pfp", name: "", color: avatar.color, avatar,
        x: 0, y: 0, dir: "down", moving: false, z: 0, crouch: false,
      };
      ctx.save();
      ctx.translate(S / 2, S * 0.62);
      ctx.scale(2.2, 2.2);
      drawTraveler(ctx, pl, 0, 0, 1000, false, { step: 0, z: 0, crouch: false });
      ctx.restore();
      const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, "image/png"));
      if (!blob) throw new Error("render failed");
      await uploadPfp(new File([blob], "cloakling.png", { type: "image/png" }));
    } catch (e) {
      fail(e, "Couldn't use your cloakling.");
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
      // unique path per upload: reusing one path reuses its public URL, and
      // the old bytes stick around in browser/CDN caches (the "revert" bug)
      const path = `${userId}/avatar-${Date.now().toString(36)}.${ext}`;
      const { error: upErr } = await sb.storage.from("avatars").upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = sb.storage.from("avatars").getPublicUrl(path);
      const prevUrl = profile?.avatar_url || "";
      const { error: dbErr } = await sb.from("profiles").update({ avatar_url: data.publicUrl }).eq("id", userId);
      if (dbErr) throw dbErr;
      setPendingAvatarUrl(null);
      setPfpPreview(`${data.publicUrl}?t=${Date.now()}`);
      setCrop({ ...DEFAULT_CROP });
      cropBefore.current = { ...DEFAULT_CROP };
      setCropEdit(true);
      setMsg("Picture updated — tweak the focus, then Save profile.");
      // best-effort cleanup of the previous file so the bucket doesn't fill
      // (gallery-sourced pictures live on — only avatars-bucket files go)
      const marker = "/avatars/";
      const mi = prevUrl.indexOf(marker);
      if (mi >= 0) {
        const prevPath = prevUrl.slice(mi + marker.length).split("?")[0];
        if (prevPath && prevPath !== path) {
          sb.storage.from("avatars").remove([prevPath]).catch(() => {});
        }
      }
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
      const { data, error } = await profilesQuery((cols) =>
        sb
          .from("profiles")
          .select(cols)
          .ilike("username", `%${q}%`)
          .neq("id", userId)
          .limit(8)
      );
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
      if (selectedFriend?.id === id) setSelectedFriend(null);
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

  const refreshGallery = async () => {
    if (!userId) return;
    try {
      setGallery(await listGallery(userId));
    } catch (e) {
      fail(e, "Couldn't load the gallery.");
    }
  };

  const togglePin = async (item: GalleryItem) => {
    if (!userId) return;
    if (!item.pinned && gallery.filter((g) => g.pinned).length >= 3) {
      setMsg("Max 3 pinned — unpin one first.");
      return;
    }
    setBusy(true);
    try {
      await setPinned(item.id, !item.pinned);
      await refreshGallery();
    } catch (e) {
      fail(e, "Couldn't change the pin.");
    } finally {
      setBusy(false);
    }
  };

  // Pick a gallery photo as the new picture: staged locally (preview +
  // focus editing), persisted by Save profile — nothing writes yet.
  const useGalleryPhoto = (item: GalleryItem) => {
    setPendingAvatarUrl(item.url);
    setPfpPreview(`${item.url}?t=${Date.now()}`);
    setCrop({ ...DEFAULT_CROP });
    cropBefore.current = { ...DEFAULT_CROP };
    setGalleryPicker(false);
    setCropEdit(true);
    setMsg("Tweak the focus, then Save profile.");
  };

  const doDeletePhoto = async (item: GalleryItem) => {    setBusy(true);
    try {
      await deleteGalleryItem(item.id, item.path);
      setConfirmDeleteId(null);
      if (viewerIdx !== null) {
        const next = gallery.filter((g) => g.id !== item.id);
        setGallery(next);
        setViewerIdx(next.length ? Math.min(viewerIdx, next.length - 1) : null);
      } else {
        await refreshGallery();
      }
    } catch (e) {
      fail(e, "Couldn't delete that photo.");
    } finally {
      setBusy(false);
    }
  };

  const openFriend = async (r: FriendRow) => {
    setSelectedFriend(r);
    setFriendPinned([]);
    try {
      setFriendPinned(await listPinned(r.other.id));
    } catch { /* pins are bonus */ }
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
                <ProfileCard
                  p={{
                    display_name: displayName, username: username || null, bio,
                    avatar_url: pfpPreview || undefined, avatar_crop: crop,
                    country, languages: [langA, langB].filter(Boolean),
                    card_color: cardColor, card_color2: cardColor2, card_text: cardText,
                  }}
                  avatarSize={56}
                  pinned={gallery.filter((g) => g.pinned).map((g) => ({ url: g.url }))}
                />
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              {pfpPreview
                ? (
                  <span style={{
                    width: 64, height: 64, borderRadius: "50%", overflow: "hidden",
                    border: "3px solid #4a3728", flexShrink: 0, display: "inline-block",
                  }}>
                    <img src={pfpPreview} alt="profile" style={cropImgStyle(crop)} />
                  </span>
                )
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
                <div style={{ display: "flex", gap: 6 }}>
                  {pfpPreview && (
                    <button className="pp-btn pp-btn-cream" style={{ flex: 1, padding: "8px 12px", fontSize: 13 }} disabled={busy}
                      onClick={openCropPopup}>
                      Edit picture
                    </button>
                  )}
                  <span style={{ position: "relative", flex: 1, display: "flex" }}>
                    <button className="pp-btn pp-btn-wood" style={{ flex: 1, padding: "8px 12px", fontSize: 13 }} disabled={busy}
                      onClick={() => setPicMenu((o) => !o)}>
                      Change picture {picMenu ? "▴" : "▾"}
                    </button>
                    {picMenu && (
                      <>
                        <span
                          style={{ position: "fixed", inset: 0, zIndex: 15 }}
                          onClick={() => setPicMenu(false)}
                        />
                        <span
                          className="pp-card pp-scroll"
                          style={{
                            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 16,
                            maxHeight: 180, overflowY: "auto", padding: 6,
                            display: "flex", flexDirection: "column", gap: 2,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => { setPicMenu(false); fileRef.current?.click(); }}
                            style={{
                              background: "none", border: "none", borderRadius: 8, padding: "8px 10px",
                              cursor: "pointer", font: "inherit", fontSize: 14, fontWeight: 800,
                              color: "#4a3728", textAlign: "left",
                            }}
                          >
                            Upload a picture
                          </button>
                          <button
                            type="button"
                            onClick={() => void useCloaklingPicture()}
                            style={{
                              background: "none", border: "none", borderRadius: 8, padding: "8px 10px",
                              cursor: "pointer", font: "inherit", fontSize: 14, fontWeight: 800,
                              color: "#4a3728", textAlign: "left",
                            }}
                          >
                            Use my cloakling
                          </button>
                          <button
                            type="button"
                            onClick={() => { setPicMenu(false); setGalleryPicker(true); }}
                            style={{
                              background: "none", border: "none", borderRadius: 8, padding: "8px 10px",
                              cursor: "pointer", font: "inherit", fontSize: 14, fontWeight: 800,
                              color: "#4a3728", textAlign: "left",
                            }}
                          >
                            Choose from gallery
                          </button>
                        </span>
                      </>
                    )}
                  </span>
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#6b543f" }}>Square images work best · max 2MB</div>
              </div>
            </div>
            {galleryPicker && (
            <div
              style={{
                position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 5,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(43,26,18,0.55)",
              }}
              onClick={() => setGalleryPicker(false)}
            >
              <div
                className="pp-panel"
                style={{ width: 340, maxWidth: "92%", maxHeight: "86%", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <b style={{ fontSize: 17, flex: 1 }}>Choose a picture</b>
                  <button className="pp-iconbtn pp-iconbtn-off" style={{ width: 34, height: 34, fontSize: 14 }}
                    onClick={() => setGalleryPicker(false)} title="Close">✕</button>
                </div>
                {gallery.length === 0 ? (
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#6b543f" }}>
                    Gallery is empty — snap one with the camera first.
                  </div>
                ) : (
                  <div className="pp-scroll" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, overflowY: "auto", padding: 2 }}>
                    {gallery.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => useGalleryPhoto(g)}
                        title="Use this picture"
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
                      >
                        <img
                          src={g.url} alt=""
                          style={{
                            width: "100%", aspectRatio: "1", objectFit: "cover", display: "block",
                            borderRadius: 10, border: "3px solid #4a3728", boxSizing: "border-box",
                          }}
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {cropEdit && pfpPreview && (
              <div
                style={{
                  position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 5,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "rgba(43,26,18,0.55)",
                }}
                onClick={() => { setCrop(cropBefore.current); setCropEdit(false); }}
              >
                <div
                  className="pp-panel"
                  style={{ width: 300, maxWidth: "90%", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <b style={{ fontSize: 17, flex: 1 }}>Edit picture</b>
                    <button className="pp-iconbtn pp-iconbtn-off" style={{ width: 34, height: 34, fontSize: 14 }}
                      onClick={() => { setCrop(cropBefore.current); setCropEdit(false); }} title="Cancel">✕</button>
                    <button className="pp-iconbtn pp-iconbtn-on" style={{ width: 34, height: 34, fontSize: 16 }}
                      onClick={() => setCropEdit(false)} title="Confirm">✓</button>
                  </div>
                  <div
                    onPointerDown={(e) => {
                      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                      dragRef.current = { x: e.clientX, y: e.clientY };
                    }}
                    onPointerMove={(e) => {
                      const d = dragRef.current;
                      if (!d) return;
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      if (rect.width < 1 || rect.height < 1) return;
                      const dx = ((e.clientX - d.x) / rect.width) * 100;
                      const dy = ((e.clientY - d.y) / rect.height) * 100;
                      d.x = e.clientX;
                      d.y = e.clientY;
                      setCrop((c) => ({
                        ...c,
                        x: Math.min(100, Math.max(0, c.x - dx)),
                        y: Math.min(100, Math.max(0, c.y - dy)),
                      }));
                    }}
                    onPointerUp={() => { dragRef.current = null; }}
                    onPointerCancel={() => { dragRef.current = null; }}
                    style={{
                      width: "100%", height: 200, borderRadius: 12, overflow: "hidden",
                      border: "3px solid #4a3728", cursor: "grab", touchAction: "none",
                      background: "#d9c193",
                    }}
                  >
                    <img src={pfpPreview} alt="" draggable={false} style={{ ...cropImgStyle(crop), pointerEvents: "none" }} />
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, fontWeight: 800 }}>
                    <button className="pp-btn pp-btn-wood" style={{ padding: "6px 12px", flexShrink: 0 }} onClick={() => setCrop((c) => ({ ...c, zoom: Math.max(1, +(c.zoom - 0.1).toFixed(2)) }))} title="Zoom out">−</button>
                    <input type="range" className="pp-range" style={{ flex: 1 }} min={1} max={2.5} step={0.1}
                      id="ct-crop-zoom" name="cropZoom" value={crop.zoom}
                      onChange={(e) => setCrop((c) => ({ ...c, zoom: Number(e.target.value) }))} />
                    <button className="pp-btn pp-btn-wood" style={{ padding: "6px 12px", flexShrink: 0 }} onClick={() => setCrop((c) => ({ ...c, zoom: Math.min(2.5, +(c.zoom + 0.1).toFixed(2)) }))} title="Zoom in">+</button>
                    <b style={{ minWidth: 40, textAlign: "right" }}>{crop.zoom.toFixed(1)}×</b>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#6b543f", flex: 1 }}>Drag to move · slider to zoom</div>
                    <button className="pp-btn pp-btn-cream" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setCrop({ ...DEFAULT_CROP })}>
                      Reset
                    </button>
                  </div>
                </div>
              </div>
            )}
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
            <div className="pp-section-title">Country</div>
            <div style={{ display: "flex" }}>
              <CozySelect id="ct-country" name="country" value={country} placeholder="No country"
                options={COUNTRIES} onPick={setCountry} disabled={busy} />
            </div>
            <div className="pp-section-title">Languages (max two)</div>
            <div style={{ display: "flex", gap: 8 }}>
              <CozySelect id="ct-lang-a" name="langA" value={langA} placeholder="—"
                options={LANGUAGES.filter((l) => l !== langB)} onPick={setLangA} disabled={busy} />
              <CozySelect id="ct-lang-b" name="langB" value={langB} placeholder="—"
                options={LANGUAGES.filter((l) => l !== langA)} onPick={setLangB} disabled={busy} />
            </div>
            <div className="pp-section-title">Card color</div>
            <ColorRow colors={CARD_COLORS} value={cardColor} onPick={setCardColor}
              noneLabel="Default" rainbowId="ct-card-color" rainbowName="cardColor" fallback="#e3c98f" />
            <div className="pp-section-title">Card fade (second color, optional)</div>
            <ColorRow colors={CARD_COLORS} value={cardColor2} onPick={setCardColor2}
              noneLabel="None" rainbowId="ct-card-color2" rainbowName="cardColor2" fallback="#a9c6c1" />
            <div className="pp-section-title">Card text color</div>
            <ColorRow colors={TEXT_COLORS} value={cardText} onPick={setCardText}
              noneLabel="Default" rainbowId="ct-card-text" rainbowName="cardText" fallback="#4a3728" />
            <div className="pp-section-title">Description</div>
            <div style={{ position: "relative" }}>
              <textarea className="pp-textarea" style={{ margin: 0 }} value={bio} id="ct-bio" name="bio"
                onChange={(e) => setBio(e.target.value)} maxLength={280} placeholder="A few lines about you… (Enter for a new line)" />
              <span style={{
                position: "absolute", right: 12, bottom: 8, fontSize: 11, fontWeight: 800,
                color: "#6b543f", opacity: 0.6, pointerEvents: "none",
              }}>
                {bio.length}/280
              </span>
            </div>
            <button className="pp-btn pp-btn-leaf" disabled={busy} onClick={saveProfile}>Save profile</button>
          </div>
        )}

      {tab === "gallery" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="pp-section-title">Saved from your camera ({gallery.length})</div>
          {gallery.length === 0 ? (
            <div style={{ fontSize: 13, fontWeight: 700, color: "#6b543f" }}>
              No photos yet — snap one with the camera and hit “Save to profile”.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
              {gallery.map((g, i) => (
                <button
                  key={g.id}
                  onClick={() => { setConfirmDeleteId(null); setViewerIdx(i); }}
                  title={g.pinned ? "Pinned — view" : "View"}
                  style={{ position: "relative", background: "none", border: "none", padding: 0, cursor: "zoom-in" }}
                >
                  <img
                    src={g.url} alt=""
                    style={{
                      width: "100%", aspectRatio: "1", objectFit: "cover", display: "block",
                      borderRadius: 10, border: "3px solid #4a3728", boxSizing: "border-box",
                    }}
                  />
                  {g.pinned && (
                    <span
                      title="Pinned"
                      style={{
                        position: "absolute", top: 5, right: 5, width: 12, height: 12,
                        borderRadius: "50%", background: "#f2c14e", border: "2px solid #4a3728",
                      }}
                    />
                  )}
                </button>
              ))}
            </div>
          )}
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
              {friends.map((r) => (
                <div key={r.id} className="pp-card" style={{ padding: "7px 10px", display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                  {r.other.avatar_url
                    ? (
                      <span style={{
                        width: 26, height: 26, borderRadius: "50%", overflow: "hidden",
                        border: "2px solid #4a3728", flexShrink: 0, display: "inline-block",
                      }}>
                        <img src={r.other.avatar_url} alt="" style={cropImgStyle(r.other.avatar_crop)} />
                      </span>
                    )
                    : null}
              <button
                onClick={() => void openFriend(r)}
                title="View profile"
                style={{ flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", fontWeight: 900, color: "#4a3728", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {label(r.other)}
              </button>
              <span style={{ display: "flex", gap: 6 }}>
                {inviteCode && r.other.id && (
                  <button className="pp-btn pp-btn-leaf" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy} onClick={() => sendInvite(r.other.id)}>Invite</button>
                )}
                <button className="pp-btn pp-btn-cream" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy} onClick={() => remove(r.id)}>Remove</button>
              </span>
            </div>
          ))}
          {selectedFriend && (
            <div
              style={{
                position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 5,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(43,26,18,0.55)",
              }}
              onClick={() => setSelectedFriend(null)}
            >
              <div style={{ position: "relative", width: 320, maxWidth: "90%" }} onClick={(e) => e.stopPropagation()}>
                <ProfileCard
                  p={{
                    display_name: selectedFriend.other.display_name,
                    username: selectedFriend.other.username,
                    bio: selectedFriend.other.bio,
                    avatar_url: selectedFriend.other.avatar_url,
                    avatar_crop: selectedFriend.other.avatar_crop,
                    country: selectedFriend.other.country,
                    languages: selectedFriend.other.languages,
                    card_color: selectedFriend.other.card_color,
                    card_color2: selectedFriend.other.card_color2,
                    card_text: selectedFriend.other.card_text,
                  }}
                  avatarSize={56}
                  pinned={friendPinned.map((g) => ({ url: g.url }))}
                />
                <button
                  className="pp-iconbtn pp-iconbtn-off"
                  style={{ position: "absolute", top: -12, right: -12, width: 32, height: 32, fontSize: 13 }}
                  onClick={() => setSelectedFriend(null)}
                  title="Close"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
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
      {viewerIdx !== null && gallery[viewerIdx] && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 70,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: 16,
            background: "rgba(30,18,12,0.8)",
          }}
          onClick={() => setViewerIdx(null)}
        >
          <button
            className="pp-iconbtn pp-iconbtn-off" style={{ width: 40, height: 40, fontSize: 18, flexShrink: 0 }}
            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); setViewerIdx((i) => (i === null ? null : (i + gallery.length - 1) % gallery.length)); }}
            title="Previous"
          >
            ‹
          </button>
          <div
            className="pp-panel"
            style={{ maxWidth: "min(560px, 86vw)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={gallery[viewerIdx].url} alt=""
              style={{ width: "100%", maxHeight: "58vh", objectFit: "contain", borderRadius: 8, background: "#2b1f16" }}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#6b543f" }}>
                {viewerIdx + 1} / {gallery.length}
              </span>
              <span style={{ flex: 1 }} />
              <button
                className={"pp-btn " + (gallery[viewerIdx].pinned ? "pp-btn-wood" : "pp-btn-cream")}
                style={{ padding: "6px 14px", fontSize: 13 }} disabled={busy}
                onClick={() => void togglePin(gallery[viewerIdx])}
                title={gallery[viewerIdx].pinned ? "Unpin from your card" : "Pin to your card (max 3)"}
              >
                {gallery[viewerIdx].pinned ? "Pinned" : "Pin"}
              </button>
              <button
                className="pp-btn pp-btn-cream" style={{ padding: "6px 14px", fontSize: 13 }}
                onClick={() => void downloadUrl(gallery[viewerIdx].url, `cloak-town-photo-${viewerIdx + 1}.jpg`)}
              >
                Download
              </button>
              {confirmDeleteId === gallery[viewerIdx].id ? (
                <button
                  className="pp-btn pp-btn-danger" style={{ padding: "6px 14px", fontSize: 13 }} disabled={busy}
                  onClick={() => void doDeletePhoto(gallery[viewerIdx])}
                >
                  Confirm
                </button>
              ) : (
                <button
                  className="pp-btn pp-btn-cream" style={{ padding: "6px 14px", fontSize: 13 }}
                  onClick={() => setConfirmDeleteId(gallery[viewerIdx].id)}
                >
                  Delete
                </button>
              )}
              <button
                className="pp-btn pp-btn-cream" style={{ padding: "6px 14px", fontSize: 13 }}
                onClick={() => setViewerIdx(null)}
              >
                Close
              </button>
            </div>
          </div>
          <button
            className="pp-iconbtn pp-iconbtn-off" style={{ width: 40, height: 40, fontSize: 18, flexShrink: 0 }}
            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); setViewerIdx((i) => (i === null ? null : (i + 1) % gallery.length)); }}
            title="Next"
          >
            ›
          </button>
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

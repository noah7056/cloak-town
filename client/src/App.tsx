import { useEffect, useRef, useState } from "react";
import { getSocket, serverUrlLabel, type RoomState, type TvState, type ServerInfo, type JoinError, type PhotoFull } from "./net/socket";
import { startEngine } from "./game/engine";
import { MAPS, seatsFor, TV_SPOT, TV_RADIUS, PLAZA_FIELD, CAFE_DOOR_OUTSIDE, CAFE_DOOR_RADIUS, CAFE_DOOR_INSIDE, CAFE_EXIT_RADIUS, CAFE_BOARD_SPOT, CAFE_BOARD_RADIUS } from "./game/maps";
import { EMOTES, EMOTES_PER_PAGE } from "./game/emotes";
import { loadAvatar, saveAvatar, sanitizeAvatar, DEFAULT_AVATAR, type Avatar } from "./game/avatar";
import CustomizeMenu from "./components/CustomizeMenu";
import AccountPanel from "./components/AccountPanel";
import ProfileCard from "./components/ProfileCard";
import { getSupabase, INVITE_TTL_MS, profilesQuery } from "./net/supabase";
import { listPinned } from "./net/gallery";
import LobbyScene from "./components/LobbyScene";
import SettingsModal from "./components/SettingsModal";
import TvModal from "./components/TvModal";
import CameraModal, { type CamShot } from "./components/CameraModal";
import Blackboard from "./components/Blackboard";
import { useTvAudio } from "./game/tvAudio";
import TicTacToe from "./components/TicTacToe";
import RpsBoard from "./components/RpsBoard";
import DotsBoard from "./components/DotsBoard";
import ConnectFour from "./components/ConnectFour";
import { GAME_LIST, gameLabel, oppName, type GameKind, type MatchState } from "./game/match";
import { loadBinds, prettyKey, type Binds } from "./game/binds";
import { useVoice, type VoiceMode } from "./voice/useVoice";
import { useAnimatedOpen } from "./components/useAnimatedOpen";

type ChatMsg = { id: string; name: string; text: string; at: number };

function loadSetting(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

/* ---------- tiny custom glyphs (pure CSS, no emoji) ---------- */
function PauseGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="6" y="5" width="4.5" height="14" rx="2.2" fill="#fff8e7" stroke="#4a3728" strokeWidth="1.8" />
      <rect x="13.5" y="5" width="4.5" height="14" rx="2.2" fill="#fff8e7" stroke="#4a3728" strokeWidth="1.8" />
    </svg>
  );
}

function MicGlyph({ off }: { off: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="9" y="3" width="6" height="10" rx="3" stroke="#4a3728" strokeWidth="1.8" />
      <path d="M6 11v1a6 6 0 0 0 12 0v-1" stroke="#4a3728" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 18v3" stroke="#4a3728" strokeWidth="1.8" strokeLinecap="round" />
      {off && <path d="M4 4l16 16" stroke="#d95f4b" strokeWidth="2.4" strokeLinecap="round" />}
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg width="15" height="18" viewBox="0 0 15 18" fill="none">
      <path d="M9.5 2.5 4 9l5.5 6.5" stroke="#faf3df" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChatGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3.2c-5.2 0-8.8 3.4-8.8 7.6 0 2.3 1.1 4.3 2.9 5.6-.15 1.2-.8 2.7-2 3.6 2.4-.1 4.2-1 5.3-1.9.8.2 1.7.3 2.6.3 5.2 0 8.8-3.4 8.8-7.6S17.2 3.2 12 3.2Z"
        fill="#faf3df" stroke="#4a3728" strokeWidth="1.8" strokeLinejoin="round"
      />
      <circle cx="8.6" cy="10.8" r="1.4" fill="#8a5a33" />
      <circle cx="12" cy="10.8" r="1.4" fill="#8a5a33" />
      <circle cx="15.4" cy="10.8" r="1.4" fill="#8a5a33" />
    </svg>
  );
}

function CoinDot({ size = 16 }: { size?: number }) {
  return (
    <span style={{ width: size, height: size, borderRadius: "50%", background: "#f2c14e", border: "2.5px solid #4a3728", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <span style={{ width: size * 0.35, height: size * 0.35, borderRadius: "50%", background: "#c9952f" }} />
    </span>
  );
}

function PersonGlyph({ color = "#8a5a33" }: { color?: string }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 1.5, flexShrink: 0 }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: color }} />
      <span style={{ width: 16, height: 8, borderRadius: "6px 6px 3px 3px", background: color }} />
    </span>
  );
}

function CloakMark({ size = 78 }: { size?: number }) {
  // Minimal cloakling head: a round little hood with a shadowed face.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      style={{ flexShrink: 0, filter: "drop-shadow(0 4px 0 #4a3728)" }}
      role="img"
      aria-label="Cloak Town logo"
    >
      {/* hood */}
      <path
        d="M32 13 Q48 23 48 41 Q48 52 32 52 Q16 52 16 41 Q16 23 32 13 Z"
        fill="#d95f4b"
        stroke="#4a3728"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      {/* face */}
      <ellipse cx="32" cy="38" rx="10" ry="10" fill="#2b1f16" />
      {/* eyes */}
      <circle cx="28" cy="37.5" r="2.1" fill="#faf3df" />
      <circle cx="36" cy="37.5" r="2.1" fill="#faf3df" />
      <circle cx="28" cy="37.9" r="1" fill="#2b1f16" />
      <circle cx="36" cy="37.9" r="1" fill="#2b1f16" />
    </svg>
  );
}

/* ---------- emote picker glyphs (inline SVG, theme-matched) ---------- */
function EmoteSvg({ id }: { id: string }) {
  const ink = "#4a3728";
  switch (id) {
    case "heart":
      return (<svg width="26" height="26" viewBox="-13 -13 26 26"><path d="M0 9 C-12 -1 -7 -11 0 -4 C7 -11 12 -1 0 9 Z" fill="#d95f4b" stroke={ink} strokeWidth="2" strokeLinejoin="round" /></svg>);
    case "laugh":
      return (<svg width="26" height="26" viewBox="-13 -13 26 26"><circle cx="0" cy="0" r="10" fill="#f2c14e" stroke={ink} strokeWidth="2" /><path d="M-6.5 -2.5 Q-4.5 -5 -2.5 -2.5 M2.5 -2.5 Q4.5 -5 6.5 -2.5" stroke={ink} strokeWidth="1.8" fill="none" strokeLinecap="round" /><path d="M-5 2.5 Q0 8.5 5 2.5 Q0 5 -5 2.5 Z" fill="#7a2f26" /></svg>);
    case "wow":
      return (<svg width="26" height="26" viewBox="-13 -13 26 26"><rect x="-2.8" y="-10" width="5.6" height="11" rx="2.8" fill="#d95f4b" stroke={ink} strokeWidth="2" /><circle cx="0" cy="7" r="2.8" fill="#d95f4b" stroke={ink} strokeWidth="2" /></svg>);
    case "huh":
      return (<svg width="26" height="26" viewBox="-13 -13 26 26"><text x="0" y="8" textAnchor="middle" fontSize="20" fontWeight="900" fontFamily="Nunito, sans-serif" fill="#4e8d7c" stroke={ink} strokeWidth="0.7">?</text></svg>);
    case "dance":
      return (<svg width="26" height="26" viewBox="-13 -13 26 26"><ellipse cx="-3.5" cy="7" rx="3.8" ry="2.9" fill="#4e8d7c" stroke={ink} strokeWidth="2" /><path d="M0 6.5 V-8 Q7 -7 6 0" stroke={ink} strokeWidth="2.2" fill="none" strokeLinecap="round" /></svg>);
    case "sleep":
      return (<svg width="26" height="26" viewBox="-13 -13 26 26"><text x="0" y="8" textAnchor="middle" fontSize="19" fontWeight="900" fontFamily="Nunito, sans-serif" fill="#7c9cc4">Z</text></svg>);
    case "angry":
      return (<svg width="26" height="26" viewBox="-13 -13 26 26"><path d="M-8 -8 C-4 -8 -4 -4 -4 -1 M8 -8 C4 -8 4 -4 4 -1 M-8 8 C-4 8 -4 4 -4 1 M8 8 C4 8 4 4 4 1" stroke="#d95f4b" strokeWidth="2.6" fill="none" strokeLinecap="round" /></svg>);
    case "march":
      return (<svg width="26" height="26" viewBox="-13 -13 26 26"><rect x="-8" y="-10" width="7" height="9" rx="2.5" fill="#7a4a26" stroke={ink} strokeWidth="2" /><rect x="1" y="1" width="7" height="9" rx="2.5" fill="#7a4a26" stroke={ink} strokeWidth="2" /><path d="M-11 -3 H-9 M-11 1 H-8.5" stroke="#4e8d7c" strokeWidth="1.8" strokeLinecap="round" /></svg>);
    case "cry":
      return (<svg width="26" height="26" viewBox="-13 -13 26 26"><path d="M0 -10 C5 -2 6 4 0 8 C-6 4 -5 -2 0 -10 Z" fill="#7c9cc4" stroke={ink} strokeWidth="2" strokeLinejoin="round" /></svg>);
    case "idea":
      return (<svg width="26" height="26" viewBox="-13 -13 26 26"><circle cx="0" cy="-2" r="6" fill="#f2c14e" stroke={ink} strokeWidth="2" /><rect x="-3" y="4" width="6" height="4" rx="1.5" fill="#8a5a33" stroke={ink} strokeWidth="1.6" /></svg>);
    case "sweat":
      return (<svg width="26" height="26" viewBox="-13 -13 26 26"><path d="M-2 -10 C3 -2 4 4 -2 8 C-7 4 -7 -2 -2 -10 Z" fill="#bcd8e8" stroke={ink} strokeWidth="2" strokeLinejoin="round" /></svg>);
    case "dizzy":
      return (<svg width="26" height="26" viewBox="-13 -13 26 26"><path d="M0 0 m0 -1 a1 1 0 0 1 1 1 a2.5 2.5 0 0 1 -2.5 2.5 a4.5 4.5 0 0 1 -4.5 -4.5 a7 7 0 0 1 7 -7 a9 9 0 0 1 9 9" stroke="#8a6fbf" strokeWidth="2.2" fill="none" strokeLinecap="round" /></svg>);
    case "no":
      return (<svg width="26" height="26" viewBox="-13 -13 26 26"><path d="M-7 -7 L7 7 M7 -7 L-7 7" stroke="#d95f4b" strokeWidth="3.4" strokeLinecap="round" /></svg>);
    case "yes":
      return (<svg width="26" height="26" viewBox="-13 -13 26 26"><path d="M-7 0 L-2 6 L8 -7" stroke="#4c9a52" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>);
    case "sit":
      return (<svg width="26" height="26" viewBox="-13 -13 26 26"><rect x="-9" y="1" width="14" height="5" rx="2" fill="#8a5a33" stroke={ink} strokeWidth="2" /><circle cx="-2" cy="-6" r="4.4" fill="#f7ead0" stroke={ink} strokeWidth="2" /><path d="M-2 -2 V1 H4" stroke={ink} strokeWidth="2.2" fill="none" strokeLinecap="round" /></svg>);
    case "star":
    default:
      return (<svg width="26" height="26" viewBox="-13 -13 26 26"><polygon points="0,-10 2.9,-3.1 9.5,-3.1 4.7,1.9 6.6,8.1 0,4 -6.6,8.1 -4.7,1.9 -9.5,-3.1 -2.9,-3.1" fill="#f2c14e" stroke={ink} strokeWidth="2" strokeLinejoin="round" /></svg>);
  }
}

function EmoteButtonGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.5" fill="#fff8e7" stroke="#4a3728" strokeWidth="1.8" />
      <circle cx="9" cy="10" r="1.4" fill="#4a3728" />
      <circle cx="15" cy="10" r="1.4" fill="#4a3728" />
      <path d="M8.5 14.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8" stroke="#4a3728" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function BellGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3.5c-3.6 0-6 2.6-6 6.2v3.9l-1.8 2.9c-.3.5 0 1.1.6 1.1h14.4c.6 0 .9-.6.6-1.1L18 13.6V9.7c0-3.6-2.4-6.2-6-6.2Z"
        fill="#fff8e7" stroke="#4a3728" strokeWidth="1.6" strokeLinejoin="round"
      />
      <circle cx="12" cy="19.4" r="2" fill="#fff8e7" stroke="#4a3728" strokeWidth="1.6" />
    </svg>
  );
}

function CameraGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect x="2.5" y="7" width="19" height="13" rx="3" fill="#fff8e7" stroke="#4a3728" strokeWidth="1.8" />
      <circle cx="12" cy="13.5" r="4.4" fill="#4e8d7c" stroke="#4a3728" strokeWidth="1.8" />
      <circle cx="12" cy="13.5" r="1.8" fill="#fff8e7" />
      <rect x="8" y="4" width="8" height="4" rx="1.5" fill="#fff8e7" stroke="#4a3728" strokeWidth="1.8" />
      <circle cx="18.4" cy="10.6" r="1.1" fill="#d95f4b" />
    </svg>
  );
}

export default function App() {
  const [screen, setScreen] = useState<"lobby" | "customize" | "game">("lobby");
  const [name, setName] = useState(() => {
    try {
      const saved = localStorage.getItem("pp-name");
      if (saved && saved.trim()) return saved.slice(0, 16);
    } catch { /* private mode */ }
    return "Cloakling" + Math.floor(Math.random() * 999);
  });
  const [avatar, setAvatar] = useState(loadAvatar);
  const color = avatar.color;
  // Supabase account link (null for guests — guest play keeps working).
  // Filled by AccountPanel; sent on every join/create so the server can
  // attach presence to persistent user ids (friend status, join-friend).
  const [accountId, setAccountId] = useState<string | null>(null);
  const accountIdRef = useRef<string | null>(null);
  accountIdRef.current = accountId;
  // Lobby account modal (round button next to settings) + button label.
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountLabel, setAccountLabel] = useState("");  const [accountTab, setAccountTab] = useState<"profile" | "friends">("profile");
  // Cloud avatar guard: apply the account's cloakling look once per version
  // so opening the profile can't clobber unsaved local edits.
  const cloudAvatarRef = useRef<string>("");
  // Notification bell: unread arrivals since you last looked (friend
  // requests + room invites — extensible to other account events later).
  const [notifUnread, setNotifUnread] = useState(0);
  // Accepted friends' account ids (reported by the profile panel) — the
  // engine paints their nametags gold.
  const [friendIds, setFriendIds] = useState<string[]>([]);
  const friendIdsRef = useRef<string[]>([]);
  friendIdsRef.current = friendIds;
  const seenNotifRef = useRef<{ friends: Set<string>; invites: Set<string> }>({
    friends: new Set(), invites: new Set(),
  });
  const [mapId, setMapId] = useState("plaza");
  const [joinCode, setJoinCode] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [joinError, setJoinError] = useState("");
  // Password popup for code-joined private servers (opens only when needed).
  const [pwPrompt, setPwPrompt] = useState<{ code: string } | null>(null);
  // Create-a-server lives in its own modal so the lobby stays tidy.
  const [createOpen, setCreateOpen] = useState(false);
  // Customize is an animated overlay on top of the home screen.
  const [customizeOpen, setCustomizeOpen] = useState(false);
  // Bumped to ask the overlay for a close (backdrop click → back-arrow flow).
  const [customizeCloseSignal, setCustomizeCloseSignal] = useState(0);
  // Server browser (public servers only).
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [serverSearch, setServerSearch] = useState("");
  const [serversLoading, setServersLoading] = useState(true);
  // Create-a-server form.
  const [serverName, setServerName] = useState("");
  const [serverDesc, setServerDesc] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [serverPassword, setServerPassword] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [myId, setMyId] = useState("");
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [connected, setConnected] = useState(false);
  const [connError, setConnError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef(false);
  pickerRef.current = pickerOpen;
  // Two rows, one visible at a time — 1-8 always fires the visible row.
  const [pickerPage, setPickerPage] = useState(0);
  const pickerPageRef = useRef(0);
  pickerPageRef.current = pickerPage;
  const pickerPageCount = Math.ceil(EMOTES.length / EMOTES_PER_PAGE);
  // Cozy TV (arcade loft watch parties).
  const [tvOpen, setTvOpen] = useState(false);
  const tvOpenRef = useRef(false);
  tvOpenRef.current = tvOpen;
  // Café blackboard: shared chalk doodles on the back-wall slate.
  const [boardOpen, setBoardOpen] = useState(false);
  const boardOpenRef = useRef(false);
  boardOpenRef.current = boardOpen;
  // Polaroid camera: frozen frame under test + viewer for shared prints.
  const [camOpen, setCamOpen] = useState(false);
  const [camShot, setCamShot] = useState<CamShot | null>(null);
  const [viewPhotoId, setViewPhotoId] = useState<string | null>(null);
  const camOpenRef = useRef(false);
  camOpenRef.current = camOpen;
  // Fresh read of the viewer for the engine + key handlers (outlive renders).
  const viewPhotoRef = useRef<string | null>(null);
  viewPhotoRef.current = viewPhotoId;
  // Polaroid jpeg cache: id -> dataURL (fed by photo-new / photo-sync, read
  // by the engine + the viewer popup; metadata rides room-state instead).
  const photoImgs = useRef(new Map<string, string>());
  // Avatar cache: player id -> avatar blob. The 20Hz room-state strips
  // avatars for size; they arrive one-shot via avatars-sync / player-avatar
  // (and inline from older servers). Merged back in onState below.
  const avatarCache = useRef(new Map<string, Avatar>());
  const engRef = useRef<{ snapshot: () => Omit<CamShot, "n"> | null; destroy: () => void } | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [playersOpen, setPlayersOpen] = useState(true);
  const [unread, setUnread] = useState(0);
  // Minigames: who we're offering / answering / playing with.
  const [interactId, setInteractId] = useState<string | null>(null);
  // In-game profile viewer: whose profile is shown in the popup.
  const [viewProfileId, setViewProfileId] = useState<string | null>(null);
  const [viewProfile, setViewProfile] = useState<{
    display_name: string;
    username: string | null;
    bio: string;
    avatar_url?: string;
    avatar_crop?: { zoom: number; x: number; y: number } | null;
    country?: string;
    languages?: string[];
    card_color?: string;
    card_color2?: string;
    card_text?: string;
  } | null>(null);
  const [requestingTo, setRequestingTo] = useState<string | null>(null);
  // Relationship to the viewed player: none | pending (I asked) |
  // incoming (they asked — offer Accept) | friends (Back only).
  const [viewRelation, setViewRelation] = useState<"none" | "pending" | "incoming" | "friends" | null>(null);
  const [viewRelId, setViewRelId] = useState<string | null>(null);
  const [viewPinned, setViewPinned] = useState<{ url: string }[]>([]);
  // true when the card is a guest fallback (name only, no account)
  const [viewNoAccount, setViewNoAccount] = useState(false);
  // tip popup + play-together dropdown inside the interact panel
  const [tipOpen, setTipOpen] = useState(false);
  const [tipAmount, setTipAmount] = useState(1);
  const [tipMsg, setTipMsg] = useState("");
  const [playOpen, setPlayOpen] = useState(false);
  // Leaving the interact panel always drops the profile view too —
  // otherwise reopening it lands on their profile instead of the actions.
  useEffect(() => {
    if (!interactId) {
      setViewProfileId(null);
      setViewProfile(null);
      setViewRelation(null);
      setViewRelId(null);
      setViewPinned([]);
      setViewNoAccount(false);
      setTipOpen(false);
      setTipMsg("");
      setPlayOpen(false);
    }
  }, [interactId]);
  // Opening the panel loads their card at once — no separate View step.
  // Guests (no account) get a name-only fallback card instead.
  useEffect(() => {
    if (!interactId) return;
    setViewNoAccount(false);
    setTipOpen(false);
    setTipAmount(1);
    setTipMsg("");
    setPlayOpen(false);
    const p = stateRef.current?.players.find((pl) => pl.id === interactId);
    if (!p?.userId) {
      setViewProfile({ display_name: p?.name || "Someone", username: null, bio: "", avatar_url: undefined });
      setViewProfileId(interactId);
      setViewRelation("none");
      setViewRelId(null);
      setViewPinned([]);
      setViewNoAccount(true);
      return;
    }
    void fetchProfileBySocketId(interactId).then((ok) => {
      if (!ok) {
        const q = stateRef.current?.players.find((pl) => pl.id === interactId);
        setViewProfile({ display_name: q?.name || "Someone", username: null, bio: "", avatar_url: undefined });
        setViewProfileId(interactId);
        setViewRelation("none");
        setViewRelId(null);
        setViewPinned([]);
        setViewNoAccount(true);
      } else if (p.userId) {
        listPinned(p.userId).then(
          (pins) => setViewPinned(pins.map((g) => ({ url: g.url }))),
          () => setViewPinned([])
        );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactId]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (text: string, ms = 3000) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  };
  // Account link shared by the lobby + in-game profile mounts: report the
  // signed-in user (id for presence, name for the button) and adopt the
  // cloud cloakling look so you match everywhere you log in.
  const handleAccount = (id: string | null, displayName: string, cloudAvatar?: import("./game/avatar").Avatar | null) => {
    setAccountId(id);
    setAccountLabel(displayName);
    if (!id) {
      cloudAvatarRef.current = "";
      return;
    }
    // first sign-in adopts your profile name unless you typed one
    if (displayName) {
      setName((cur) => (cur.startsWith("Cloakling") ? displayName.slice(0, 16) : cur));
    }
    const blob = cloudAvatar && typeof cloudAvatar === "object" && (cloudAvatar as Avatar).color
      ? (cloudAvatar as Avatar) : null;
    const key = blob ? JSON.stringify(blob) : "";
    if (key && key !== cloudAvatarRef.current) {
      cloudAvatarRef.current = key;
      try {
        setAvatar(sanitizeAvatar(blob));
      } catch { /* malformed cloud blob — keep the local look */ }
    }
  };
  const [matchInvite, setMatchInvite] = useState<{ from: string; fromName: string; kind: GameKind } | null>(null);
  const [matchWaiting, setMatchWaiting] = useState<{ id: string; kind: GameKind } | null>(null);
  const [match, setMatch] = useState<MatchState | null>(null);
  // Rematch handshake on a finished board: queued = we asked, offer = they asked.
  const [rematchQueued, setRematchQueued] = useState(false);
  const [rematchOffer, setRematchOffer] = useState<{ gameId: string; fromName: string } | null>(null);
  const interactRef = useRef<string | null>(null);
  interactRef.current = interactId;
  const matchRef = useRef<MatchState | null>(null);
  matchRef.current = match;
  const inviteRef = useRef<{ from: string; fromName: string; kind: GameKind } | null>(null);
  inviteRef.current = matchInvite;
  const matchInviteRef = useRef<{ from: string; fromName: string; kind: GameKind } | null>(null);
  matchInviteRef.current = matchInvite;
  const waitingRef = useRef<{ id: string; kind: GameKind } | null>(null);
  waitingRef.current = matchWaiting;
  // Football pitch panel (Sunny Plaza): queue up for a match / follow it live.
  const [footballOpen, setFootballOpen] = useState(false);
  const footballOpenRef = useRef(false);
  footballOpenRef.current = footballOpen;
  // Café door fade: black overlay that covers the plaza↔café teleport.
  const [cafeFade, setCafeFade] = useState(false);
  const cafeFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Coins: single per-server value, authoritative on the server
  // (room.balances keyed by persistent pid). Leaving + rejoining the same
  // server keeps your coins; they vanish with the room when it's deleted.
  // Every earn is always exactly 1 coin for now (found / game win / tip).
  const [pid] = useState(() => {
    try {
      const saved = localStorage.getItem("pp-pid");
      if (saved && /^[A-Za-z0-9-]{8,40}$/.test(saved)) return saved;
      const fresh = (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : `pid-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
      localStorage.setItem("pp-pid", fresh);
      return fresh;
    } catch { return `pid-${Math.floor(Math.random() * 1e9).toString(36)}`; }
  });
  // Per-tab id (sessionStorage): two tabs in one browser are two footballers
  // sharing one coin purse. Sent on every join so the server can tell tabs
  // apart; balances stay pid-keyed.
  const [tabId] = useState(() => {
    try {
      const saved = sessionStorage.getItem("pp-tab");
      if (saved && /^[A-Za-z0-9-]{8,40}$/.test(saved)) return saved;
      const fresh = (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : `tab-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
      sessionStorage.setItem("pp-tab", fresh);
      return fresh;
    } catch { return `tab-${Math.floor(Math.random() * 1e9).toString(36)}`; }
  });
  const [coinFlash, setCoinFlash] = useState(0);
  const myCoins: number = pid ? (room?.balances?.[pid] ?? 0) : 0;
  // Voice settings (persisted).
  const [micDeviceId, setMicDeviceId] = useState(() => loadSetting("pp-mic", ""));
  const [echoCancellation, setEchoCancellation] = useState(() => loadSetting("pp-ec", "on") !== "off");
  const [voiceMode, setVoiceMode] = useState<VoiceMode>(() => (loadSetting("pp-vmode", "toggle") === "ptt" ? "ptt" : "toggle"));
  // Central keybind map (persisted as one blob; migrates the legacy voice key).
  const [binds, setBinds] = useState<Binds>(loadBinds);
  const bindsRef = useRef(binds);
  bindsRef.current = binds;
  // Display + debug settings (persisted).
  const [dust, setDust] = useState(() => loadSetting("pp-dust", "on") !== "off");
  // Interface scale: browser-zoom feel for the whole app, per machine.
  const [uiScale, setUiScale] = useState(() => {
    const v = parseFloat(loadSetting("pp-uiscale", "1"));
    return Number.isFinite(v) && v >= 0.5 && v <= 1.5 ? v : 1;
  });
  // Foreground cloakling on the home screen (persisted).
  const [showBuddy, setShowBuddy] = useState(() => loadSetting("pp-buddy", "on") !== "off");
  const [debugMode, setDebugMode] = useState(() => loadSetting("pp-debug", "off") === "on");
  const [showColliders, setShowColliders] = useState(() => loadSetting("pp-coll", "off") === "on");
  const stateRef = useRef<RoomState | null>(null);
  const chatOpenRef = useRef(true);
  chatOpenRef.current = chatOpen;
  // Fresh reads for the engine's shortcut guard (its callbacks outlive renders).
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menuOpen;
  const settingsOpenRef = useRef(false);
  settingsOpenRef.current = settingsOpen;
  const accountOpenRef = useRef(false);
  accountOpenRef.current = accountOpen;
  // General rule: any open menu freezes your character. Covers pause/info,
  // emote picker, TV, camera, photo viewer, interact panel and every
  // minigame overlay (invite in/out + board).
  const frozenRef = useRef(false);
  frozenRef.current =
    menuOpen || settingsOpen || pickerOpen || tvOpen || camOpen ||
    viewPhotoId !== null || interactId !== null || footballOpen ||
    match !== null || matchInvite !== null || matchWaiting !== null ||
    cafeFade || boardOpen;
  const myIdRef = useRef("");
  myIdRef.current = myId;
  // Rejoin bookkeeping: a socket reconnect gets a fresh server-side identity,
  // so the room (and voice mesh) must be re-entered explicitly.
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const meRef = useRef({ name, color, mapId, avatar, pid, tab: tabId, userId: null as string | null });
  meRef.current = { name, color, mapId, avatar, pid, tab: tabId, userId: accountIdRef.current };
  const lastJoinRef = useRef<{ code: string; password: string } | null>(null);
  // Password used for the in-flight join/create, so reconnects can replay it
  // once the server tells us the real code in "joined".
  const pendingPasswordRef = useRef("");
  // Fresh read of the code field for the join-error handler (its callbacks
  // outlive renders).
  const joinCodeRef = useRef("");
  joinCodeRef.current = joinCode;
  // True while the server knows us as room members. Stale room state alone
  // must NOT count: after a socket drop the server forgot us even though the
  // UI still shows the room.
  const joinedRef = useRef(false);
  // Connection telemetry for the debug overlay.
  const netHzRef = useRef(0);
  const reconnectsRef = useRef(0);
  const everConnected = useRef(false);
  // Fresh reads for engine callbacks (they outlive renders).
  const dustRef = useRef(true);
  dustRef.current = dust;
  const debugRef = useRef(false);
  debugRef.current = debugMode;
  const collRef = useRef(false);
  collRef.current = showColliders;
  const voiceDiagRef = useRef<string[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  stateRef.current = room;
  const socket = getSocket();

  useEffect(() => {
    try {
      if (name.trim()) localStorage.setItem("pp-name", name);
      localStorage.setItem("pp-mic", micDeviceId);
      localStorage.setItem("pp-vmode", voiceMode);
      localStorage.setItem("pp-ec", echoCancellation ? "on" : "off");
      localStorage.setItem("pp-keys", JSON.stringify(binds));
      localStorage.setItem("pp-dust", dust ? "on" : "off");
      localStorage.setItem("pp-debug", debugMode ? "on" : "off");
      localStorage.setItem("pp-coll", showColliders ? "on" : "off");
      localStorage.setItem("pp-uiscale", String(uiScale));
      localStorage.setItem("pp-buddy", showBuddy ? "on" : "off");
      saveAvatar(avatar);
    } catch { /* private mode */ }
  }, [name, micDeviceId, voiceMode, echoCancellation, binds, dust, debugMode, showColliders, avatar, uiScale, showBuddy]);

  // Whole-app interface scale: the base size from settings multiplied by a
  // fluid factor from the window width — like browser zoom that follows
  // the screen (huge on 4K, normal on small laptops, never cramped).
  useEffect(() => {
    const apply = () => {
      const fit = Math.min(1.5, Math.max(0.7, window.innerWidth / 1920));
      const z = Math.round(uiScale * fit * 100) / 100;
      document.documentElement.style.zoom = String(z);
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [uiScale]);

  // Settings ✓ commits drafts for binds/display/voice at once. If voice
  // inputs changed mid-game, re-apply the mic so they take effect now.
  const commitSettings = (s: {
    binds: Binds; dust: boolean; debugMode: boolean; showColliders: boolean;
    uiScale: number; showBuddy: boolean;
    micDeviceId: string; voiceMode: VoiceMode; echoCancellation: boolean;
  }) => {
    setBinds(s.binds);
    setDust(s.dust);
    setDebugMode(s.debugMode);
    setShowColliders(s.showColliders);
    setUiScale(s.uiScale);
    setShowBuddy(s.showBuddy);
    setMicDeviceId(s.micDeviceId);
    setVoiceMode(s.voiceMode);
    setEchoCancellation(s.echoCancellation);
  };
  const firstVoiceSettings = useRef(true);
  useEffect(() => {
    if (firstVoiceSettings.current) {
      firstVoiceSettings.current = false;
      return;
    }
    if (screenRef.current === "game") void voice.cycleMic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micDeviceId, echoCancellation, voiceMode]);

  useEffect(() => {
    let statesThisSec = 0;
    const hz = setInterval(() => {
      netHzRef.current = statesThisSec;
      statesThisSec = 0;
    }, 1000);
    const onState = (s: RoomState) => {
      statesThisSec++;
      // Merge one-shot avatars back in: cache any inline avatar (old
      // servers still send them), then fill gaps from the cache (new
      // servers strip them from the 20Hz loop).
      if (s && Array.isArray(s.players)) {
        for (const p of s.players) {
          if (p.avatar) avatarCache.current.set(p.id, p.avatar);
        }
        s = {
          ...s,
          players: s.players.map((p) =>
            p.avatar ? p : avatarCache.current.has(p.id)
              ? { ...p, avatar: avatarCache.current.get(p.id) }
              : p
          ),
        };
      }
      setRoom(s);
    };
    const onAvatarsSync = (list: { id: string; avatar: Avatar }[]) => {
      if (!Array.isArray(list)) return;
      for (const e of list) {
        if (e && typeof e.id === "string" && e.avatar) avatarCache.current.set(e.id, e.avatar);
      }
    };
    const onPlayerAvatar = (e: { id: string; avatar: Avatar }) => {
      if (e && typeof e.id === "string" && e.avatar) avatarCache.current.set(e.id, e.avatar);
    };
    const onPeerLeftAvatar = ({ id }: { id: string }) => {
      if (typeof id === "string") avatarCache.current.delete(id);
    };
    const onJoined = ({ code, id, mapId, name: srvName }: any) => {
      avatarCache.current.clear();
      setMyId(id);
      joinedRef.current = true;
      setJoinError("");
      setPwPrompt(null);
      setJoinPassword("");
      setCreateOpen(false);
      if (typeof code === "string") {
        lastJoinRef.current = { code, password: pendingPasswordRef.current };
        pendingPasswordRef.current = "";
      }
      if (mapId) setMapId(mapId);
      setScreen("game");
      setChat((c) => [...c, { id: "system", name: "★", text: `Joined ${srvName || "room"} (${code})`, at: Date.now() }]);
    };
    const onJoinError = (e: JoinError) => {
      setJoinError(typeof e?.msg === "string" ? e.msg : "Couldn't join that server.");
      // Private server with a password: pop the password prompt instead of
      // leaving the user guessing next to the code field.
      if (e?.needPassword) {
        const code = typeof e?.code === "string" && e.code
          ? e.code
          : joinCodeRef.current.trim().toUpperCase();
        if (code) setPwPrompt({ code });
      }
    };
    const onChat = (m: ChatMsg) => {
      setChat((c) => [...c.slice(-49), m]);
      if (!chatOpenRef.current) setUnread((n) => n + 1);
    };
    // Instant TV updates (room-state would carry them ~66ms later anyway).
    const onTv = (t: TvState) => setRoom((r) => (r ? { ...r, tv: t } : r));
    // Polaroid bytes (kept out of the 15Hz room-state on purpose).
    const onPhotoNew = (p: PhotoFull) => {
      if (p && typeof p.id === "string" && typeof p.img === "string") {
        photoImgs.current.set(p.id, p.img);
      }
    };
    const onPhotoSync = (list: PhotoFull[]) => {
      photoImgs.current.clear();
      if (Array.isArray(list)) {
        for (const p of list) {
          if (p && typeof p.id === "string" && typeof p.img === "string") {
            photoImgs.current.set(p.id, p.img);
          }
        }
      }
    };
    const onConnect = () => {
      if (everConnected.current) reconnectsRef.current++;
      everConnected.current = true;
      setConnected(true);
      setConnError("");
      // Fresh identity after a drop (or a server restart): re-enter the room
      // we were in so state + voice keep working instead of going stale.
      if (screenRef.current === "game" && joinedRef.current && lastJoinRef.current) {
        const m = meRef.current;
        const j = lastJoinRef.current;
        socket.emit("join", { code: j.code, password: j.password, name: m.name, color: m.color, avatar: m.avatar, pid: m.pid, tab: m.tab, userId: m.userId });
      }
    };
    const sys = (text: string) =>
      setChat((c) => [...c.slice(-49), { id: "system", name: "★", text, at: Date.now() }]);
    const onDisc = () => setConnected(false);
    const onConnErr = () => setConnError("Cannot reach game server. In split-dev mode make sure `npm run dev` is running in /server (:3001).");
    const onLeft = () => {
      joinedRef.current = false;
      avatarCache.current.clear();
      setRoom(null);
      setMyId("");
      setInteractId(null);
      setFootballOpen(false);
      setMatchInvite(null);
      setMatchWaiting(null);
      setMatch(null);
      setRematchQueued(false);
      setRematchOffer(null);
      setTvOpen(false);
      setCamOpen(false);
      setCamShot(null);
      setViewPhotoId(null);
      setCafeFade(false);
      if (cafeFadeTimer.current) {
        clearTimeout(cafeFadeTimer.current);
        cafeFadeTimer.current = null;
      }
      setScreen("lobby");
    };
    // tic-tac-toe lobby events
    const playerName = (id: string) =>
      stateRef.current?.players.find((p) => p.id === id)?.name || "Someone";
    const onMatchInvite = (m: any) => {
      if (typeof m?.from === "string" && GAME_LIST.some((g) => g.id === m.kind)) {
        setMatchInvite({ from: m.from, fromName: m.fromName || "Someone", kind: m.kind });
      }
    };
    const onMatchWithdrawn = () => setMatchInvite(null);
    const onMatchStart = (g: MatchState) => {
      setMatch(g);
      setMatchWaiting(null);
      setMatchInvite(null);
      setInteractId(null);
      setRematchQueued(false);
      setRematchOffer(null);
      sys(`Started ${gameLabel(g.kind)}: ${g.xName} (X) vs ${g.oName} (O)`);
    };
    const onMatchState = (g: MatchState) => setMatch(g);
    const onMatchEnd = () => {
      setMatch((t) => {
        if (t) {
          const opp = t.x === myIdRef.current ? t.oName : t.xName;
          sys(`${opp} left the ${gameLabel(t.kind)} board — no result.`);
        }
        return null;
      });
    };
    const onMatchDeclined = () => {
      const n = matchWaitingName();
      setMatchWaiting(null);
      sys(`${n} declined your ${gameLabel(matchInviteRef.current?.kind || "ttt")} invite.`);
    };
    const onMatchExpired = () => {
      const n = matchWaitingName();
      setMatchWaiting(null);
      sys(`Game invite to ${n} expired.`);
    };
    const onMatchError = (m: any) => {
      setMatchWaiting(null);
      setMatchInvite(null);
      sys(typeof m?.msg === "string" ? m.msg : "Couldn't start that game.");
    };
    // rematch handshake events (only meaningful on the finished board)
    const onMatchRematchOffer = (m: any) => {
      if (matchRef.current && typeof m?.gameId === "string" && matchRef.current.gameId === m.gameId) {
        setRematchOffer({ gameId: m.gameId, fromName: m.fromName || "Someone" });
      }
    };
    const onMatchRematchWithdrawn = () => setRematchOffer(null);
    const onMatchRematchDeclined = () => {
      setRematchQueued(false);
      const t = matchRef.current;
      const opp = t ? (t.x === myIdRef.current ? t.oName : t.xName) : "They";
      sys(`${opp} didn't want a rematch.`);
    };
    const onMatchRematchExpired = () => {
      setRematchQueued(false);
      sys("Rematch expired — they're gone.");
    };
    const onMatchRematchConverted = (m: any) => {
      // opponent had already left the board: this became a plain invite
      setRematchQueued(false);
      setMatch(null);
      setRematchOffer(null);
      if (typeof m?.other === "string" && typeof m?.kind === "string" && GAME_LIST.some((g) => g.id === m.kind)) {
        setMatchWaiting({ id: m.other, kind: m.kind });
      }
    };
    const matchWaitingName = () =>
      (waitingRef.current && playerName(waitingRef.current.id)) || "Someone";
    // Coin feedback lives in-world (floating +1 popup via player.coinPop)
    // + HUD pulse — deliberately no chat messages for earns/tips.
    const onCoinsChanged = (m: any) => {
      const delta = Number(m?.delta);
      if (Number.isFinite(delta) && delta !== 0) {
        setCoinFlash((n) => n + 1);
      }
    };
    const onTipError = (m: any) => {
      sys(typeof m?.msg === "string" ? m.msg : "Couldn't send that tip.");
    };
    const onFbError = (m: any) => {
      sys(typeof m?.msg === "string" ? m.msg : "Couldn't do that football thing.");
    };
    const onTipReceived = () => {
      setCoinFlash((n) => n + 1);
    };
    socket.on("room-state", onState);
    socket.on("avatars-sync", onAvatarsSync);
    socket.on("player-avatar", onPlayerAvatar);
    socket.on("peer-left", onPeerLeftAvatar);
    socket.on("joined", onJoined);
    socket.on("join-error", onJoinError);
    socket.on("chat-msg", onChat);
    socket.on("tv-state", onTv);
    socket.on("photo-new", onPhotoNew);
    socket.on("photo-sync", onPhotoSync);
    socket.on("left", onLeft);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisc);
    socket.on("connect_error", onConnErr);
    socket.on("game-invite", onMatchInvite);
    socket.on("game-withdrawn", onMatchWithdrawn);
    socket.on("game-start", onMatchStart);
    socket.on("game-state", onMatchState);
    socket.on("game-end", onMatchEnd);
    socket.on("game-declined", onMatchDeclined);
    socket.on("game-expired", onMatchExpired);
    socket.on("game-error", onMatchError);
    socket.on("game-rematch-offer", onMatchRematchOffer);
    socket.on("game-rematch-withdrawn", onMatchRematchWithdrawn);
    socket.on("game-rematch-declined", onMatchRematchDeclined);
    socket.on("game-rematch-expired", onMatchRematchExpired);
    socket.on("game-rematch-converted", onMatchRematchConverted);
    socket.on("coins-changed", onCoinsChanged);
    socket.on("tip-error", onTipError);
    socket.on("tip-received", onTipReceived);
    socket.on("fb-error", onFbError);
    setConnected(socket.connected);
    return () => {
      clearInterval(hz);
      socket.off("room-state", onState);
      socket.off("avatars-sync", onAvatarsSync);
      socket.off("player-avatar", onPlayerAvatar);
      socket.off("peer-left", onPeerLeftAvatar);
      socket.off("joined", onJoined);
      socket.off("join-error", onJoinError);
      socket.off("chat-msg", onChat);
      socket.off("tv-state", onTv);
      socket.off("photo-new", onPhotoNew);
      socket.off("photo-sync", onPhotoSync);
      socket.off("left", onLeft);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisc);
      socket.off("connect_error", onConnErr);
      socket.off("game-invite", onMatchInvite);
      socket.off("game-withdrawn", onMatchWithdrawn);
      socket.off("game-start", onMatchStart);
      socket.off("game-state", onMatchState);
      socket.off("game-end", onMatchEnd);
      socket.off("game-declined", onMatchDeclined);
      socket.off("game-expired", onMatchExpired);
      socket.off("game-error", onMatchError);
      socket.off("game-rematch-offer", onMatchRematchOffer);
      socket.off("game-rematch-withdrawn", onMatchRematchWithdrawn);
      socket.off("game-rematch-declined", onMatchRematchDeclined);
      socket.off("game-rematch-expired", onMatchRematchExpired);
      socket.off("game-rematch-converted", onMatchRematchConverted);
      socket.off("coins-changed", onCoinsChanged);
      socket.off("tip-error", onTipError);
      socket.off("tip-received", onTipReceived);
       socket.off("fb-error", onFbError);
       if (toastTimer.current) clearTimeout(toastTimer.current);
     };
   }, []);

  // Server browser: live list of public servers while in the lobby.
  // Server pushes "servers-changed" pings; we re-request the (optionally
  // name-filtered) list, plus a slow poll as a backstop.
  useEffect(() => {
    if (screen !== "lobby") return;
    const onList = (list: ServerInfo[]) => {
      setServers(Array.isArray(list) ? list : []);
      setServersLoading(false);
    };
    const refresh = () => socket.emit("list-servers", { search: serverSearch });
    const onChanged = () => refresh();
    socket.on("servers-list", onList);
    socket.on("servers-changed", onChanged);
    setServersLoading(true);
    refresh();
    const poll = setInterval(refresh, 5000);
    return () => {
      clearInterval(poll);
      socket.off("servers-list", onList);
      socket.off("servers-changed", onChanged);
    };
  }, [screen, serverSearch]);

  // Session truth lives here — not in the profile modal — so the lobby
  // knows you're logged in from the first paint without mounting anything
  // hidden. The modal still reports profile edits/saves via onAccount.
  useEffect(() => {
    const c = getSupabase();
    if (!c) return;
    let cancelled = false;
    const applySession = (uid: string | null) => {
      setAccountId(uid);
      if (!uid) {
        setAccountLabel("");
        cloudAvatarRef.current = "";
      } else {
        void fetchAccountProfile(uid);
      }
    };
    c.auth.getSession().then(({ data }) => {
      if (!cancelled) applySession(data.session?.user?.id || null);
    });
    const { data: sub } = c.auth.onAuthStateChange((_ev, session) => {
      if (!cancelled) applySession(session?.user?.id || null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Session truth lives here — not in the profile modal — so the lobby
  // knows you're logged in from the first paint without mounting anything
  // hidden. The modal still reports profile edits/saves via onAccount.
  useEffect(() => {
    const c = getSupabase();
    if (!c) return;
    let cancelled = false;
    const applySession = (uid: string | null) => {
      setAccountId(uid);
      if (!uid) {
        setAccountLabel("");
        cloudAvatarRef.current = "";
      } else {
        void fetchAccountProfile(uid);
      }
    };
    c.auth.getSession().then(({ data }) => {
      if (!cancelled) applySession(data.session?.user?.id || null);
    });
    const { data: sub } = c.auth.onAuthStateChange((_ev, session) => {
      if (!cancelled) applySession(session?.user?.id || null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAccountProfile = async (uid: string) => {
    const c = getSupabase();
    if (!c) return;
    try {
      const { data, error } = await c.from("profiles").select("display_name, username, bio, avatar_url, avatar").eq("id", uid).maybeSingle();
      if (error) throw error;
      if (data) {
        setAccountLabel(data.display_name || data.username || "");
        const blob = data.avatar && typeof data.avatar === "object" && (data.avatar as any).color
          ? (data.avatar as Avatar) : null;
        if (blob) {
          // cloud wins — sanitized so older/stale blobs can't corrupt the look
          const key = JSON.stringify(blob);
          if (key !== cloudAvatarRef.current) {
            cloudAvatarRef.current = key;
            try {
              setAvatar(sanitizeAvatar(blob));
            } catch { /* keep the local look */ }
          }
        } else {
          // nothing stored yet: a customized local look backfills upward so
          // cloaklings made before/without login aren't stranded per-device
          try {
            if (JSON.stringify(avatar) !== JSON.stringify(DEFAULT_AVATAR)) {
              cloudAvatarRef.current = JSON.stringify(avatar);
              const { error: upErr } = await c.from("profiles").update({ avatar }).eq("id", uid);
              if (upErr) throw upErr;
            }
          } catch { /* stays local-only until the next customize save */ }
        }
      }
    } catch { /* fallback to lobby defaults */ }
  };

  // Account notifications: friend requests + room invites can't ride the
  // game server (rooms are ephemeral — the recipient may be in the lobby
  // or a different room), so poll Supabase lightly. First poll seeds the
  // seen sets silently; later arrivals toast + bump the bell badge.
  useEffect(() => {
    if (!accountId) {
      seenNotifRef.current.friends.clear();
      seenNotifRef.current.invites.clear();
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const c = getSupabase();
      if (!c || cancelled) return;
      try {
        const [{ data: fr }, { data: inv }] = await Promise.all([
          c.from("friendships").select("id, requester_id").eq("addressee_id", accountId).eq("status", "pending"),
          c.from("room_invites").select("id, from_id, room_code, server_name, created_at").eq("to_id", accountId).eq("status", "pending").order("created_at", { ascending: false }).limit(10),
        ]);
        if (cancelled) return;
        const freshInv = ((inv || []) as { id: string; from_id: string; room_code: string; server_name: string; created_at: string }[])
          .filter((r) => Date.now() - new Date(r.created_at).getTime() < INVITE_TTL_MS);
        const newFr = ((fr || []) as { id: string; requester_id: string }[]).filter((r) => !seenNotifRef.current.friends.has(r.id));
        const newInv = freshInv.filter((r) => !seenNotifRef.current.invites.has(r.id));
        (fr || []).forEach((r: { id: string }) => seenNotifRef.current.friends.add(r.id));
        freshInv.forEach((r) => seenNotifRef.current.invites.add(r.id));
        if (!newFr.length && !newInv.length) return;
        // names for the toasts, one lookup — wrapped so a failed lookup
        // can NEVER drop the notification (falls back to generic names)
        const whoIds = [...new Set([...newFr.map((r) => r.requester_id), ...newInv.map((r) => r.from_id)])];
        let names = new Map<string, string>();
        if (whoIds.length) {
          try {
            const { data: profs, error: nErr } = await c.from("profiles").select("id, username, display_name").in("id", whoIds);
            if (nErr) throw nErr;
            names = new Map(((profs || []) as { id: string; username: string | null; display_name: string }[])
              .map((p) => [p.id, p.username ? `@${p.username}` : p.display_name || "Someone"]));
          } catch { /* keep generic fallbacks below */ }
        }
        if (cancelled) return;
        for (const r of newFr) {
          showToast(`Friend request from ${names.get(r.requester_id) || "someone"} — check the bell.`, 6000);
          setNotifUnread((n) => n + 1);
        }
        for (const r of newInv) {
          showToast(`${names.get(r.from_id) || "Someone"} invited you: ${r.server_name || r.room_code} (${r.room_code}).`, 6000);
          setNotifUnread((n) => n + 1);
        }
      } catch { /* notifications are best-effort — the tabs always re-fetch */ }
    };
    // seed silently, then poll
    void (async () => {
      const c = getSupabase();
      if (!c) return;
      try {
        const [{ data: fr }, { data: inv }] = await Promise.all([
          c.from("friendships").select("id").eq("addressee_id", accountId).eq("status", "pending"),
          c.from("room_invites").select("id, created_at").eq("to_id", accountId).eq("status", "pending"),
        ]);
        if (cancelled) return;
        ((fr || []) as { id: string }[]).forEach((r) => seenNotifRef.current.friends.add(r.id));
        ((inv || []) as { id: string; created_at: string }[])
          .filter((r) => Date.now() - new Date(r.created_at).getTime() < INVITE_TTL_MS)
          .forEach((r) => seenNotifRef.current.invites.add(r.id));
      } catch { /* ignore */ }
    })();
    const t = setInterval(poll, 8000);
    // re-check immediately when the tab regains focus — arrivals while
    // hidden shouldn't wait for the next tick
    const onFocus = () => void poll();
    const onVis = () => {
      if (document.visibilityState === "visible") void poll();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // game engine
  useEffect(() => {
    if (screen !== "game" || !canvasRef.current) return;
    const eng = startEngine(canvasRef.current, {
      getState: () => stateRef.current,
      getMyId: () => myId,
      friendIds: () => friendIdsRef.current,
      sendMove: (x, y, dir, moving, z, crouch, sprint) => socket.emit("move", { x, y, dir, moving, z, crouch, sprint }),
      isMenuOpen: () => menuOpenRef.current || settingsOpenRef.current,
      isFrozen: () => frozenRef.current,
      isTvOpen: () => tvOpenRef.current,
      dustEnabled: () => dustRef.current,
      isDebug: () => debugRef.current,
      showColliders: () => collRef.current,
      debugLines: () => voiceDiagRef.current,
      binds: () => bindsRef.current,
      isViewerOpen: () => viewPhotoRef.current !== null,
      isCamOpen: () => camOpenRef.current,
      isBoardOpen: () => boardOpenRef.current,
    });
    engRef.current = eng;
    return () => {
      engRef.current = null;
      eng.destroy();
    };
  }, [screen, myId]);

  const voice = useVoice(myId, screen === "game", room?.code || null, name, () => stateRef.current, {
    micDeviceId, voiceMode, voiceKey: binds.voice, echoCancellation,
  });

  // TV spillover: hear the arcade set from nearby even with the panel closed.
  useTvAudio(room?.tv ?? null, tvOpen, () => {
    const r = stateRef.current;
    const me = r?.players.find((p) => p.id === myIdRef.current);
    return me && r ? { x: me.x, y: me.y, mapId: r.mapId } : null;
  });

  // Compact diagnostics for the on-screen debug overlay + Debug data block.
  voiceDiagRef.current = [
    `srv ${serverUrlLabel()} ${connected ? "on" : "off"} net ${netHzRef.current}Hz re ${reconnectsRef.current}`,
    `me ${name} (${myId.slice(0, 5) || "-"}) coins ${myCoins} chat ${chat.length}/${unread}`,
    `set dust:${dust ? "on" : "off"} mic:${micDeviceId ? "…" + micDeviceId.slice(-4) : "default"} ${voiceMode}/${prettyKey(binds.voice)}`,
    `voice out:${voice.diag.ctx} mic:${voice.diag.out} link:${voice.peersLinked}`,
    ...voice.diag.peers.map((p) =>
      `${p.id} ${p.conn}${p.track ? "+au" : "-au"} v${p.gain}${p.dist == null ? "" : ` ${p.dist}px`} m[${p.rstate}] e[${p.inLvl}] ↑${p.upBs} ↓${p.downBs}`
    ),
  ];

  // ESC closes the top layer first (picker → viewer → camera → TV →
  // board → interact → football → profile → settings), otherwise toggles
  // options. Fullscreen ESC belongs to the browser —
  // the panel stays so you don't lose your seat on the couch.
  useEffect(() => {
    if (screen !== "game") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") {
        if (document.fullscreenElement) return;
        if (pickerRef.current) { setPickerOpen(false); return; }
        if (viewPhotoRef.current) { setViewPhotoId(null); return; }
        if (camOpenRef.current) { setCamOpen(false); return; }
        if (tvOpenRef.current) { setTvOpen(false); return; }
        if (boardOpenRef.current) { setBoardOpen(false); return; }
        if (interactRef.current) { setInteractId(null); return; }
        if (footballOpenRef.current) { setFootballOpen(false); return; }
        if (accountOpenRef.current) { setAccountOpen(false); return; }
        if (settingsOpenRef.current) { setSettingsOpen(false); return; }
        setMenuOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen]);

  // Interact (E): one contextual key — throw if carrying, stand if sitting,
  // TV panel, pick up the ball, sit on furniture, football panel on the
  // pitch, or challenge a player.
  const interactActionRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (screen !== "game") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() !== bindsRef.current.interact) return;
      if (menuOpenRef.current || settingsOpenRef.current || pickerRef.current || tvOpenRef.current || camOpenRef.current || viewPhotoRef.current || boardOpenRef.current) return;
      if (matchRef.current || inviteRef.current || waitingRef.current || interactRef.current || footballOpenRef.current) return;
      interactActionRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen]);

  // Emotes: emote key toggles the picker, 1-8 fires the VISIBLE row
  // (two pages — Tab / arrows flip while open, same 1-8 binds). Firing the
  // active one again takes it off; marching a while cancels loops too.
  const selectEmote = (id: string) => {
    socket.emit("emote", { id });
    setPickerOpen(false);
  };
  useEffect(() => {
    if (screen !== "game") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.repeat) return;
      // page flip first (Tab never reaches here as "tab" only — guard raw too)
      if (pickerRef.current && (e.key === "Tab" || e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.preventDefault();
        setPickerPage((p) => e.key === "ArrowLeft"
          ? (p + Math.ceil(EMOTES.length / EMOTES_PER_PAGE) - 1) % Math.ceil(EMOTES.length / EMOTES_PER_PAGE)
          : (p + 1) % Math.ceil(EMOTES.length / EMOTES_PER_PAGE));
        return;
      }
      const k = e.key.toLowerCase();
      if (k === bindsRef.current.emotes) {
        setPickerOpen((o) => !o);
        return;
      }
      if (pickerRef.current && k >= "1" && k <= String(EMOTES_PER_PAGE)) {
        const idx = pickerPageRef.current * EMOTES_PER_PAGE + (Number(k) - 1);
        const hit = EMOTES[idx];
        if (hit) selectEmote(hit.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen]);

  // Camera: camera key opens the darkroom (ignored typing / while busy).
  useEffect(() => {
    if (screen !== "game") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() !== bindsRef.current.camera) return;
      if (menuOpenRef.current || settingsOpenRef.current || pickerRef.current || tvOpenRef.current || viewPhotoRef.current) return;
      if (matchRef.current || inviteRef.current || waitingRef.current || interactRef.current) return;
      if (camOpenRef.current) { setCamOpen(false); return; }
      openCamera();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen]);

  // Debug keybinds: Shift+P overlay, Shift+O collider boxes (ignored typing).
  useEffect(() => {
    if (screen !== "game") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.repeat || !e.shiftKey || e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === "p") {
        e.preventDefault();
        setDebugMode((v) => !v);
      } else if (k === "o") {
        e.preventDefault();
        setShowColliders((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen]);

  const openMenu = () => {
    setMenuOpen(true);
    void voice.loadDevices();
  };

  const doCreate = () => {
    const fallbackName = `${name.trim() || "Cloakling"}'s server`.slice(0, 24);
    pendingPasswordRef.current = isPrivate ? serverPassword : "";
    socket.emit("create-server", {
      server: {
        name: serverName.trim() || fallbackName,
        desc: serverDesc.trim(),
        mapId,
        isPrivate,
        password: isPrivate ? serverPassword : "",
        maxPlayers,
      },
      name, color, avatar, pid, tab: tabId, userId: accountId,
    });
    // lastJoinRef resolves to the real code on "joined" — but store intent so
    // a reconnect mid-create still tries something sane. The joined handler
    // below overwrites this with the actual code+password.
    lastJoinRef.current = null;
  };
  // Single join path: code in, socket emit out. First try goes without a
  // password — if the server has one it answers needPassword and the popup
  // opens for a second try. Used by lobby joins AND room-invite accepts.
  const joinWithCode = (rawCode: string, password = "") => {
    const code = rawCode.trim().toUpperCase();
    if (!code) return;
    setJoinError("");
    setPwPrompt(password ? { code } : null);
    pendingPasswordRef.current = password;
    lastJoinRef.current = { code, password };
    socket.emit("join", { code, password, name, color, avatar, pid, tab: tabId, userId: accountId });
  };
  const doJoinCode = () => joinWithCode(joinCode);
  const doJoinPassword = () => {
    if (!pwPrompt) return;
    joinWithCode(pwPrompt.code, joinPassword);
  };
  const doJoinListed = (srv: ServerInfo) => joinWithCode(srv.code);
  // Accept a room invite from anywhere: drop the current room first when
  // in game (leave is optimistic/sync, socket preserves emit order), then
  // join. Private rooms fall back to the password popup as usual.
  const acceptInvite = (rawCode: string) => {
    const code = rawCode.trim().toUpperCase();
    if (!code) return;
    setAccountOpen(false);
    if (screenRef.current === "game") leaveRoom();
    joinWithCode(code);
  };
  const sendChat = () => {
    if (!draft.trim()) return;
    socket.emit("chat", { text: draft.trim() });
    setDraft("");
  };
  // Friendly tip: any amount you can cover, never to yourself.
  // Sent from the interactions menu (E near someone).
  const sendTip = (to: string, amount = 1) => {
    const give = Math.floor(Number(amount));
    if (!to || to === myId || !Number.isFinite(give) || give < 1) return;
    socket.emit("tip-send", { to, amount: give });
    setInteractId(null);
  };
  // Tip popup confirm: 0 closes with nothing sent, over-balance keeps the
  // popup open with a message, anything else goes through.
  const sendTipAmount = () => {
    if (!interactId) return;
    if (tipAmount <= 0) {
      setTipOpen(false);
      return;
    }
    if (tipAmount > myCoins) {
      setTipMsg(`You only have ${myCoins} coin${myCoins === 1 ? "" : "s"}.`);
      return;
    }
    sendTip(interactId, tipAmount);
    setTipOpen(false);
  };

  // Look up a player's public profile by their socket id (which we
  // know from room-state players). Returns false if they have no
  // Supabase account — the caller shows the fallback message.
  const fetchProfileBySocketId = async (socketId: string): Promise<boolean> => {
    const room = stateRef.current;
    if (!room) return false;
    const p = room.players.find((pl) => pl.id === socketId);
    const uid = p?.userId;
    if (!uid) return false;
    const c = getSupabase();
    if (!c) return false;
    try {
      const { data, error } = await profilesQuery((cols) =>
        c.from("profiles").select(cols).eq("id", uid).maybeSingle()
      );
      if (error) throw error;
      if (data) {
        // relationship drives the buttons — resolve it BEFORE painting so
        // profile + buttons land in one commit (no "…" flash, no label swap)
        let relation: "none" | "pending" | "incoming" | "friends" = "none";
        let relId: string | null = null;
        try {
          const { data: { user } } = await c.auth.getUser();
          if (user) {
            const { data: rel, error: rErr } = await c
              .from("friendships")
              .select("id, requester_id, status")
              .or(`and(requester_id.eq.${user.id},addressee_id.eq.${uid}),and(requester_id.eq.${uid},addressee_id.eq.${user.id})`)
              .limit(1);
            if (rErr) throw rErr;
            const r = (rel || [])[0] as { id: string; requester_id: string; status: string } | undefined;
            if (r) {
              relId = r.id;
              relation =
                r.status === "accepted" ? "friends"
                : r.requester_id === user.id ? "pending"
                : "incoming";
            }
          }
        } catch {
          // stay "none" — guests and lookup failures just get Add friend
        }
        setViewProfile(data as { display_name: string; username: string | null; bio: string; avatar_url?: string });
        setViewProfileId(socketId);
        setViewNoAccount(false);
        setViewRelId(relId);
        setViewRelation(relation);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  // Send a friend request to someone seen in-game.
  const sendFriendRequestTo = async (socketId: string) => {
    const room = stateRef.current;
    if (!room) return;
    const p = room.players.find((pl) => pl.id === socketId);
    const to = p?.userId;
    if (!to) return;
    setRequestingTo(socketId);
    try {
      const c = getSupabase();
      if (!c) return;
      const { data: { user } } = await c.auth.getUser();
      if (!user) {
        showToast("Log in from the lobby to add friends.");
        return;
      }
      const existing = await c
        .from("friendships")
        .select("id")
        .or(
          `and(requester_id.eq.${user.id},addressee_id.eq.${to}),and(requester_id.eq.${to},addressee_id.eq.${user.id})`
        )
        .limit(1);
      if ((existing as any).data?.length) {
        showToast("You already have something going with them.");
        return;
      }
      const { error } = await c.from("friendships").insert({
        requester_id: user.id,
        addressee_id: to,
        status: "pending",
      });
      if (error) throw error;
      setViewRelation("pending");
      setViewProfileId(null);
      setViewProfile(null);
      showToast("Friend request sent.");
    } catch {
      showToast("Couldn't send the request.");
    } finally {
      setRequestingTo(null);
    }
  };
  // Accept an incoming request straight from their in-game profile.
  const acceptViewRelation = async () => {
    const c = getSupabase();
    if (!c || !viewRelId) return;
    try {
      const { error } = await c.from("friendships").update({ status: "accepted" }).eq("id", viewRelId);
      if (error) throw error;
      setViewRelation("friends");
      showToast("Friend added.");
    } catch {
      showToast("Couldn't accept that.");
    }
  };
  const camShotN = useRef(0);
  // Polaroid camera: freeze the current frame (you're always centered) and
  // open the darkroom. Retake grabs a fresh frame from the live game.
  const openCamera = () => {
    const snap = engRef.current?.snapshot() || null;
    if (!snap) return;
    camShotN.current++;
    setCamShot({ ...snap, n: camShotN.current });
    setCamOpen(true);
  };
  const saveInGamePhoto = (jpeg: string, caption: string) => {
    const me = room?.players.find((p) => p.id === myId);
    socket.emit("photo-take", { x: me?.x, y: me?.y, img: jpeg, caption });
    setCamOpen(false);
  };
  const leaveRoom = () => {
    socket.emit("leave");
    // Optimistic: don't wait for the round-trip to show the menu.
    joinedRef.current = false;
    lastJoinRef.current = null;
    pendingPasswordRef.current = "";
    setJoinError("");
    setPwPrompt(null);
    setCreateOpen(false);
    setCamOpen(false);
    setCamShot(null);
    setViewPhotoId(null);
    photoImgs.current.clear();
    avatarCache.current.clear();
    setRoom(null);
    setMyId("");
    setChat([]);
    setUnread(0);
    setMenuOpen(false);
    setSettingsOpen(false);
    setPickerOpen(false);
    setTvOpen(false);
    setInteractId(null);
    setFootballOpen(false);
    setMatchInvite(null);
    setMatchWaiting(null);
    setMatch(null);
    setRematchQueued(false);
    setRematchOffer(null);
    setScreen("lobby");
  };
  const toggleChat = () => {
    setChatOpen((o) => {
      if (!o) setUnread(0);
      return !o;
    });
  };

  // Nearest other player (for the E interact prompt). Uses the server's
  // last-known positions — plenty accurate at 15Hz for a 95px radius.
  const nearRef = useRef("");
  let nearId = "";
  let nearSeatId: string | null = null;
  let nearBall = false;
  let nearTv = false;
  let nearPhotoId: string | null = null;
  let nearShellId: string | null = null;
  let nearBoard = false;
  const meNow = screen === "game" ? room?.players.find((p) => p.id === myId) : undefined;
  const mySitting = !!meNow?.sitting;
  // Walk-in café: plaza rooms track which side of the door you're on.
  const myArea = (meNow as any)?.area || null;
  const inCafe = myArea === "cafe";
  const effMapId = inCafe ? "cafe" : (room?.mapId || "plaza");
  let nearCafeDoor = false;
  let nearCafeExit = false;
  const sittingOnCouch =
    mySitting && !!meNow?.seatId && meNow.seatId.indexOf("arcade-couch") === 0;
  const carrying = !!room?.ball && (room.ball.holder === myId) && myId !== "";
  const carryingPhoto = !!room?.photos?.some((ph) => ph.holder === myId && myId !== "");
  const carryingShell = !!room?.shells?.some((s) => s.holder === myId && myId !== "");
  // Football: queue + live match ride room-state. On the Sunny Plaza pitch
  // E opens the match panel (the pitch owns E — step off to challenge).
  const fbQueue = room?.footballQueue || [];
  const fb = room?.football ?? null;
  const onPitch = !!meNow && !inCafe && (room?.mapId === "plaza") &&
    meNow.x > PLAZA_FIELD.x - 40 && meNow.x < PLAZA_FIELD.x + PLAZA_FIELD.w + 40 &&
    meNow.y > PLAZA_FIELD.y - 40 && meNow.y < PLAZA_FIELD.y + PLAZA_FIELD.h + 40;
  const fbInQueue = !!tabId && fbQueue.some((e) => e.tab === tabId);
  const fbMyTeam: "A" | "B" | null = !fb || !tabId
    ? null
    : fb.teamA.some((e) => e.tab === tabId) ? "A"
    : fb.teamB.some((e) => e.tab === tabId) ? "B"
    : null;
  const fbCanStart = fbInQueue && !fb && fbQueue.length >= 2 && fbQueue.length <= 8 && fbQueue.length % 2 === 0;
  // Kickoff drops you right into the game: if this panel is open on the
  // queue when a match starts with you in it, close it (reopen later with
  // E). Spectators keep watching the live view.
  const prevFbOnRef = useRef(false);
  useEffect(() => {
    const on = !!fb;
    const was = prevFbOnRef.current;
    prevFbOnRef.current = on;
    if (!was && on && fbMyTeam) setFootballOpen(false);
  }, [fb, fbMyTeam]);
  if (screen === "game") {
    const me = meNow;
    if (me) {
      let best = 95;
      for (const p of room?.players || []) {
        if (p.id === myId) continue;
        if (((p as any).area || null) !== myArea) continue; // other side of the café door
        const d = Math.hypot(p.x - me.x, p.y - me.y);
        if (d < best) { best = d; nearId = p.id; }
      }
      // café doors (E to step through — the room fades to black first)
      if (!mySitting && !carrying && (room?.mapId || "") === "plaza") {
        if (!inCafe && Math.hypot(CAFE_DOOR_OUTSIDE.x - me.x, CAFE_DOOR_OUTSIDE.y - me.y) < CAFE_DOOR_RADIUS) nearCafeDoor = true;
        if (inCafe && Math.hypot(CAFE_DOOR_INSIDE.x - me.x, CAFE_DOOR_INSIDE.y - me.y) < CAFE_EXIT_RADIUS) nearCafeExit = true;
      }
      // free seat within sitting reach (occupied seats are skipped)
      if (!mySitting && !carrying) {
        const occupied = new Set(
          (room?.players || []).filter((p) => p.sitting && p.seatId).map((p) => p.seatId as string)
        );
        let bestSeat = 85;
        for (const s of seatsFor(effMapId)) {
          if (occupied.has(s.id)) continue;
          const d = Math.hypot(s.x - me.x, s.y - me.y);
          if (d < bestSeat) { bestSeat = d; nearSeatId = s.id; }
        }
      }
      // loose ball within pickup reach (the ball lives outside the café)
      if (!mySitting && !carrying && !inCafe && room?.ball && !room.ball.holder) {
        if (Math.hypot(room.ball.x - me.x, room.ball.y - me.y) < 60) nearBall = true;
      }
      // loose shell within pickup reach (beach only, hands free)
      if (!mySitting && !carrying && !carryingPhoto && !carryingShell && (room?.mapId || "") === "beach") {
        let bestShell = 60;
        for (const s of room?.shells || []) {
          if (s.holder) continue;
          const d = Math.hypot(s.x - me.x, s.y - me.y);
          if (d < bestShell) { bestShell = d; nearShellId = s.id; }
        }
      }
      // loose polaroid within look/pickup reach (not while holding the ball)
      if (!mySitting && !carrying && !carryingPhoto) {
        let bestPhoto = 60;
        for (const ph of room?.photos || []) {
          if (ph.holder) continue;
          if (((ph as any).area || null) !== myArea) continue;
          const d = Math.hypot(ph.x - me.x, ph.y - me.y);
          if (d < bestPhoto) { bestPhoto = d; nearPhotoId = ph.id; }
        }
      }
      // wall TV within touching reach (arcade loft only — tiny radius, the
      // couch front stays sit-able)
      if (!mySitting && !carrying && (room?.mapId || "") === "arcade") {
        if (Math.hypot(TV_SPOT.x - me.x, TV_SPOT.y - me.y) < TV_RADIUS) nearTv = true;
      }
      // café blackboard within chalk reach (wall-mounted, so the radius is
      // generous — you stand below it and draw)
      if (!mySitting && !carrying && !carryingPhoto && !carryingShell && inCafe) {
        if (Math.hypot(CAFE_BOARD_SPOT.x - me.x, CAFE_BOARD_SPOT.y - me.y) < CAFE_BOARD_RADIUS) nearBoard = true;
      }
    }
  }
  nearRef.current = nearId;
  // Standing by a pitch stand while a match is live: E becomes "spectate"
  // (same sit mechanics, but the camera jumps to midfield + match UI).
  const nearStandSeat = !!nearSeatId && !inCafe && (room?.mapId === "plaza") &&
    nearSeatId.indexOf("plaza-stand-") === 0;
  const spectateHint = nearStandSeat && !!fb;
  const nearName = room?.players.find((p) => p.id === nearId)?.name || "";
  const interactName = room?.players.find((p) => p.id === interactId)?.name || "Someone";
  const waitingName = matchWaiting ? (room?.players.find((p) => p.id === matchWaiting.id)?.name || "Someone") : "Someone";

  // Slide in/out: keep each menu mounted ~220ms after close so the
  // exit animation can play, then unmount. `closing` swaps in/out classes.
  const menuAnim = useAnimatedOpen(menuOpen);
  const settingsAnim = useAnimatedOpen(settingsOpen);
  const createAnim = useAnimatedOpen(createOpen);
  const accountAnim = useAnimatedOpen(accountOpen);
  const customizeAnim = useAnimatedOpen(customizeOpen);
  const pwAnim = useAnimatedOpen(pwPrompt !== null);
  const chatAnim = useAnimatedOpen(chatOpen);
  const pickerAnim = useAnimatedOpen(pickerOpen);
  const interactAnim = useAnimatedOpen(interactId !== null && match === null);
  const footballAnim = useAnimatedOpen(footballOpen);
  const waitingAnim = useAnimatedOpen(matchWaiting !== null && match === null);
  const inviteAnim = useAnimatedOpen(matchInvite !== null && match === null);
  const matchAnim = useAnimatedOpen(match !== null);
  const tvAnim = useAnimatedOpen(tvOpen);
  const camAnim = useAnimatedOpen(camOpen && camShot !== null);
  const photoAnim = useAnimatedOpen(viewPhotoId !== null);
  const boardAnim = useAnimatedOpen(boardOpen);

  // The E key does the most relevant thing where you're standing. Priority:
  // throw what you're carrying → set down a polaroid → stand up → grab the
  // ball → café door → sit (spectate on the pitch stands during a match) →
  // football panel on the pitch → TV → look at a photo → challenge.
  // (Sitting beats the TV so the couch front stays sit-able; the TV's tiny
  // radius means it only fires when you're right up against the console.)
  // The café door fades through black: cover the screen, teleport mid-fade,
  // uncover inside. Double-taps while fading are ignored.
  const cafeStep = (kind: "enter" | "exit") => {
    if (cafeFadeTimer.current) return;
    setCafeFade(true);
    cafeFadeTimer.current = setTimeout(() => {
      socket.emit(kind === "enter" ? "cafe-enter" : "cafe-exit");
      cafeFadeTimer.current = setTimeout(() => {
        setCafeFade(false);
        cafeFadeTimer.current = null;
      }, 380);
    }, 330);
  };
  interactActionRef.current = () => {
    const me = room?.players.find((p) => p.id === myIdRef.current);
    const st = stateRef.current;
    if (!me || !st) return;
    if (cafeFadeTimer.current) return;
    if (st.ball?.holder === me.id) {
      const dirs: Record<string, [number, number]> = {
        up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
      };
      const [dx, dy] = dirs[me.dir] || [0, 1];
      socket.emit("ball-throw", { dx, dy });
      return;
    }
    if ((st.photos || []).some((ph) => ph.holder === me.id)) {
      socket.emit("photo-drop", { x: me.x, y: me.y + 10 });
      return;
    }
    if ((st.shells || []).some((s) => s.holder === me.id)) {
      socket.emit("shell-drop", { x: me.x, y: me.y + 10 });
      return;
    }
    if (me.sitting) {
      // couch seats get the TV without standing (push a direction to get up);
      // every other seat stands up with E as before
      if (me.seatId && me.seatId.indexOf("arcade-couch") === 0) setTvOpen(true);
      else socket.emit("stand");
      return;
    }
    if (st.ball && !st.ball.holder && !carryingPhoto && ((me as any).area || null) !== "cafe" &&
      Math.hypot(st.ball.x - me.x, st.ball.y - me.y) < 60) {
      socket.emit("ball-pickup");
      return;
    }
    // loose shell: grab it to carry it around (E sets it back down)
    if (st.mapId === "beach" && !me.sitting) {
      let bestShell: string | null = null;
      let bestShellD = 60;
      for (const s of st.shells || []) {
        if (s.holder) continue;
        const d = Math.hypot(s.x - me.x, s.y - me.y);
        if (d < bestShellD) { bestShellD = d; bestShell = s.id; }
      }
      if (bestShell) {
        socket.emit("shell-pickup", { id: bestShell });
        return;
      }
    }
    // café blackboard: chalk doodles, shared with the room
    if (st.mapId === "plaza" && ((me as any).area || null) === "cafe" && !me.sitting &&
      Math.hypot(CAFE_BOARD_SPOT.x - me.x, CAFE_BOARD_SPOT.y - me.y) < CAFE_BOARD_RADIUS) {
      setBoardOpen(true);
      return;
    }
    // café door beats the furniture (no seats crowd the mats anyway)
    const meAreaNow = (me as any).area || null;
    if (st.mapId === "plaza" && !meAreaNow &&
      Math.hypot(CAFE_DOOR_OUTSIDE.x - me.x, CAFE_DOOR_OUTSIDE.y - me.y) < CAFE_DOOR_RADIUS) {
      cafeStep("enter");
      return;
    }
    if (st.mapId === "plaza" && meAreaNow === "cafe" &&
      Math.hypot(CAFE_DOOR_INSIDE.x - me.x, CAFE_DOOR_INSIDE.y - me.y) < CAFE_EXIT_RADIUS) {
      cafeStep("exit");
      return;
    }
    const mapId = meAreaNow === "cafe" ? "cafe" : (st.mapId || "plaza");
    const occupied = new Set(
      (st.players || []).filter((p) => p.sitting && p.seatId).map((p) => p.seatId as string)
    );
    let bestSeat: string | null = null;
    let bestD = 85;
    for (const s of seatsFor(mapId)) {
      if (occupied.has(s.id)) continue;
      const d = Math.hypot(s.x - me.x, s.y - me.y);
      if (d < bestD) { bestD = d; bestSeat = s.id; }
    }
    if (bestSeat) {
      socket.emit("sit", { seatId: bestSeat });
      return;
    }
    if (st.mapId === "arcade" && Math.hypot(TV_SPOT.x - me.x, TV_SPOT.y - me.y) < TV_RADIUS) {
      setTvOpen(true);
      return;
    }
    // loose polaroid: open it to look (pick-up lives inside the viewer)
    let bestPhoto: string | null = null;
    let bestPhotoD = 60;
    for (const ph of st.photos || []) {
      if (ph.holder) continue;
      if (((ph as any).area || null) !== meAreaNow) continue;
      const d = Math.hypot(ph.x - me.x, ph.y - me.y);
      if (d < bestPhotoD) { bestPhotoD = d; bestPhoto = ph.id; }
    }
    if (bestPhoto) {
      setViewPhotoId(bestPhoto);
      return;
    }
    // football pitch: E opens the match panel (queue / live score). The
    // pitch owns E here so board-game invites don't hijack match night —
    // step off the grass to challenge someone instead.
    if (st.mapId === "plaza" && !meAreaNow &&
      me.x > PLAZA_FIELD.x - 40 && me.x < PLAZA_FIELD.x + PLAZA_FIELD.w + 40 &&
      me.y > PLAZA_FIELD.y - 40 && me.y < PLAZA_FIELD.y + PLAZA_FIELD.h + 40) {
      setFootballOpen(true);
      return;
    }
    const id = nearRef.current;
    if (id) setInteractId(id);
  };

  // tic-tac-toe actions
  const sendMatchInvite = (id: string, kind: GameKind = "ttt") => {
    socket.emit("game-invite", { to: id, kind });
    setMatchWaiting({ id, kind });
    setInteractId(null);
  };
  const cancelMatchInvite = () => {
    socket.emit("game-cancel");
    setMatchWaiting(null);
  };
  const respondMatch = (accept: boolean) => {
    socket.emit("game-respond", { accept });
    if (!accept) setMatchInvite(null);
    // on accept the board arrives via game-start
  };
  const matchMove = (move: any) => {
    if (!match) return;
    if (match.kind === "ttt") {
      const idx = Number(move);
      if (Number.isInteger(idx)) socket.emit("game-move", { gameId: match.gameId, idx });
    } else if (match.kind === "rps") {
      socket.emit("game-move", { gameId: match.gameId, choice: move });
    } else if (match.kind === "dots") {
      socket.emit("game-move", { gameId: match.gameId, type: move?.type, r: move?.r, c: move?.c });
    } else if (match.kind === "c4") {
      socket.emit("game-move", { gameId: match.gameId, col: move });
    }
  };
  const quitMatch = () => {
    if (!match) return;
    if (match.status === "play") {
      socket.emit("game-quit", { gameId: match.gameId });
    } else {
      // finished board: arrow just goes back (cancels any queued rematch)
      if (rematchQueued) socket.emit("game-rematch-cancel", { gameId: match.gameId });
      socket.emit("game-dismiss", { gameId: match.gameId });
    }
    setMatch(null);
    setRematchQueued(false);
    setRematchOffer(null);
  };
  const queueRematch = () => {
    if (!match || match.status === "play") return;
    socket.emit("game-rematch", { gameId: match.gameId });
    setRematchQueued(true);
  };
  const cancelRematch = () => {
    if (match) socket.emit("game-rematch-cancel", { gameId: match.gameId });
    setRematchQueued(false);
  };

  if (screen === "lobby") {
    return (
      <div style={{ ...s.page, position: "relative", overflow: "hidden", background: "#a0ac94", justifyContent: "flex-start" }}>
        <LobbyScene avatar={avatar} showBuddy={showBuddy} />
        <div className="pp-scroll pp-lobby-controls">
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
            <img src={`${import.meta.env.BASE_URL}lobby/logo.png`} className="pp-lobby-logo" alt="Cloak Town" draggable={false} />
            <div style={{ flex: 1 }} />
            <button
              className="pp-iconbtn pp-iconbtn-off"
              style={{ width: 44, height: 44, fontSize: accountId ? 20 : 21, fontWeight: 900, position: "relative" }}
              onClick={() => { setAccountTab("profile"); setAccountOpen(true); }}
              title={accountId ? `Account (${accountLabel || "signed in"})` : "Account — log in or sign up"}
            >
              {accountId ? (accountLabel || "?").slice(0, 1).toUpperCase() : <PersonGlyph color="#fff8e7" />}
              {notifUnread > 0 && (
                <span style={{
                  position: "absolute", top: -4, right: -4, background: "#d95f4b",
                  border: "2px solid #4a3728", color: "white", borderRadius: 12,
                  fontSize: 11, fontWeight: 900, padding: "1px 6px", minWidth: 10, textAlign: "center",
                }}>
                  {notifUnread > 9 ? "9+" : notifUnread}
                </span>
              )}
            </button>
            <button className="pp-iconbtn pp-iconbtn-off" style={{ width: 44, height: 44, fontSize: 21, fontWeight: 900 }} onClick={() => setSettingsOpen(true)} title="Settings">⚙</button>
          </div>
          {!accountId && (
            <>
              <div className="pp-section-title">Your name</div>
              <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
                <input id="ct-name" name="lobbyName" className="pp-input" style={{ margin: 0, flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} maxLength={16} placeholder="Cloakling" />
                <button
                  className="pp-btn pp-btn-wood"
                  style={{ whiteSpace: "nowrap" }}
                  onClick={() => setCustomizeOpen(true)}
                  title="Open the cloakling studio"
                >
                  Customize cloakling
                </button>
              </div>
            </>
          )}
          {accountId && (
            <button
              className="pp-btn pp-btn-wood"
              style={{ width: "100%" }}
              onClick={() => setCustomizeOpen(true)}
              title="Open the cloakling studio"
            >
              Customize cloakling
            </button>
          )}

          <button className="pp-btn pp-btn-leaf" style={{ marginTop: 14, width: "100%" }} onClick={() => setCreateOpen(true)}>
            + Create server
          </button>

          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="pp-section-title">Find a server</div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input
                  id="ct-server-search" name="serverSearch"
                  className="pp-input" style={{ margin: 0, flex: 1, minWidth: 0 }}
                  value={serverSearch} onChange={(e) => setServerSearch(e.target.value)}
                  maxLength={24} placeholder="Search…"
                />
                <button
                  className="pp-btn pp-btn-wood" style={{ padding: "10px 14px", flexShrink: 0 }}
                  onClick={() => socket.emit("list-servers", { search: serverSearch })}
                  title="Refresh the server list"
                >
                  ↻
                </button>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="pp-section-title">Join with a code</div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input
                  id="ct-join-code" name="joinCode"
                  className="pp-input" style={{ margin: 0, flex: 1, minWidth: 0 }} placeholder="ABC-123"
                  value={joinCode} onChange={(e) => setJoinCode(e.target.value)} maxLength={7}
                  onKeyDown={(e) => e.key === "Enter" && doJoinCode()}
                />
                <button className="pp-btn pp-btn-cream" style={{ flexShrink: 0 }} onClick={doJoinCode}>Join</button>
              </div>
            </div>
          </div>
          {/* Capped + scrollable so a busy night never takes over the page */}
          <div className="pp-scroll" style={{ marginTop: 10, maxHeight: 264, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 2 }}>
            {serversLoading && (
              <div className="pp-card" style={{ padding: "14px", fontWeight: 800, color: "#6b543f", textAlign: "center" }}>
                Looking for open servers…
              </div>
            )}
            {!serversLoading && servers.length === 0 && (
              <div className="pp-card" style={{ padding: "14px", fontWeight: 800, color: "#6b543f", textAlign: "center" }}>
                {serverSearch
                  ? `No public servers named “${serverSearch}” — why not host one?`
                  : "No public servers open right now — hit + Create server to host one!"}
              </div>
            )}
            {servers.map((srv) => {
              const full = srv.playerCount >= srv.maxPlayers;
              const world = MAPS[srv.mapId]?.name || srv.mapId;
              return (
                <div key={srv.code} className="pp-card" style={{ padding: "10px 12px", display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontSize: 15, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{srv.name}</b>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#6b543f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {world}{srv.desc ? ` · ${srv.desc}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: full ? "#a83e2f" : "#3e7d46", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                      <PersonGlyph />{srv.playerCount}/{srv.maxPlayers}
                    </span>
                    <button
                      className={"pp-btn " + (full ? "pp-btn-cream" : "pp-btn-leaf")}
                      style={{ padding: "8px 16px", fontSize: 14 }}
                      disabled={full}
                      onClick={() => doJoinListed(srv)}
                      title={full ? "Server is full" : `Join ${srv.name} (${srv.code})`}
                    >
                      {full ? "Full" : "Join"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {joinError && !pwPrompt && <p className="pp-lobby-note" style={{ color: "#a83e2f" }}>{joinError}</p>}
          <p style={{ margin: "12px 0 4px" }}>
            <span className="pp-lobby-note" style={{ color: connected ? "#3e7d46" : "#b3814d" }}>
              {connected ? `● server connected · ${servers.length} public ${servers.length === 1 ? "server" : "servers"} open` : "○ connecting to server…"}
            </span>
          </p>
          {connError && <p className="pp-lobby-note" style={{ color: "#a83e2f" }}>{connError}</p>}
        </div>
        {accountAnim.shouldRender && (
        <AccountPanel
          open={accountOpen}
          closing={accountAnim.closing}
          onClose={() => setAccountOpen(false)}
          onAccount={handleAccount}
          accountId={accountId}
          onFriendsList={setFriendIds}
          avatar={avatar}
          startTab={accountTab}
          inviteCode={null}
          roomUserIds={[]}
          serverName=""
          onJoinRoom={acceptInvite}
        />
        )}
        {createAnim.shouldRender && (
          <>
            <div className={createAnim.closing ? "pp-anim-fade-out" : "pp-anim-fade-in"} style={{ ...s.backdrop, zIndex: 30, background: "rgba(30,18,12,0.72)" }} onClick={() => setCreateOpen(false)} />
            <div className={"pp-panel pp-scroll " + (createAnim.closing ? "pp-anim-center-out" : "pp-anim-center-in")} style={{ ...s.modal, zIndex: 31, width: 440, overflowY: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h2 style={{ margin: 0, fontSize: 21, fontWeight: 900 }}>Create a server</h2>
                <button className="pp-iconbtn pp-iconbtn-off" style={{ width: 38, height: 38, fontSize: 15 }} onClick={() => setCreateOpen(false)} title="Close">✕</button>
              </div>
              <span className="pp-label">Server name</span>
              <input
                id="ct-server-name" name="serverName"
                className="pp-input" style={{ margin: 0 }}
                value={serverName} onChange={(e) => setServerName(e.target.value)}
                maxLength={24} placeholder={`${name.trim() || "Cloakling"}'s server`}
              />
              <span className="pp-label">Description <small style={{ fontWeight: 700 }}>(shown in the pause menu in game)</small></span>
              <input
                id="ct-server-desc" name="serverDesc"
                className="pp-input" style={{ margin: 0 }}
                value={serverDesc} onChange={(e) => setServerDesc(e.target.value)}
                maxLength={120} placeholder="Chill hangout, new friends welcome!"
              />
              <span className="pp-label">World</span>
              <div style={{ display: "flex", gap: 8 }}>
                {Object.values(MAPS).filter((m) => m.id !== "cafe").map((m) => (
                  <button key={m.id} onClick={() => setMapId(m.id)} className="pp-card"
                    style={{ flex: 1, padding: 10, cursor: "pointer", fontSize: 13, fontFamily: "inherit", color: "#4a3728", border: mapId === m.id ? "3px solid #58a05c" : "2px solid #d9c193", textAlign: "left" }}>
                    <b style={{ fontSize: 14 }}>{m.name}</b><br /><small style={{ color: "#6b543f", fontWeight: 700 }}>{m.desc}</small>
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button className={"pp-choice" + (!isPrivate ? " pp-choice-on" : "")} onClick={() => setIsPrivate(false)} title="Listed publicly — anyone can find and join">
                  Public
                </button>
                <button className={"pp-choice" + (isPrivate ? " pp-choice-on" : "")} onClick={() => setIsPrivate(true)} title="Hidden from the list — join with the code only">
                  Private
                </button>
              </div>
              {!isPrivate && (
                <p style={{ fontSize: 12, fontWeight: 700, color: "#6b543f", margin: "6px 0 0" }}>
                  Public servers appear in the list — no password, click to join.
                </p>
              )}
              {isPrivate && (
                <>
                  <span className="pp-label">Password <small style={{ fontWeight: 700 }}>(optional — extra check on join)</small></span>
                  <input
                    id="ct-server-password" name="serverPassword"
                    className="pp-input" style={{ margin: 0 }}
                    type="password" value={serverPassword} onChange={(e) => setServerPassword(e.target.value)}
                    maxLength={32} placeholder="Leave empty for code-only" autoComplete="new-password"
                  />
                  <p style={{ fontSize: 12, fontWeight: 700, color: "#6b543f", margin: "6px 0 0" }}>
                    Private servers never appear in the list — share the code{serverPassword ? " + password" : ""} with friends.
                  </p>
                </>
              )}
              <span className="pp-label">Player cap</span>
              <div style={{ display: "flex", gap: 8 }}>
                {[4, 6, 8, 12, 16].map((n) => (
                  <button key={n} className={"pp-choice" + (maxPlayers === n ? " pp-choice-on" : "")} onClick={() => setMaxPlayers(n)}>
                    {n}
                  </button>
                ))}
              </div>
              <button className="pp-btn pp-btn-leaf" style={{ marginTop: 12 }} onClick={doCreate}>
                + Create & join server
              </button>
            </div>
          </>
        )}
        {pwAnim.shouldRender && pwPrompt && (
          <>
            <div className={pwAnim.closing ? "pp-anim-fade-out" : "pp-anim-fade-in"} style={{ ...s.backdrop, zIndex: 30, background: "rgba(30,18,12,0.72)" }} onClick={() => { setPwPrompt(null); setJoinPassword(""); }} />
            <div className={"pp-panel " + (pwAnim.closing ? "pp-anim-center-out" : "pp-anim-center-in")} style={{ ...s.miniModal, zIndex: 31, width: 320 }}>
              <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textAlign: "center" }}>🔒 {pwPrompt.code}</h2>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#6b543f", textAlign: "center" }}>
                This server needs a password to enter — type it below.
              </p>
              <input
                id="ct-join-password" name="joinPassword"
                className="pp-input" style={{ margin: 0 }} type="password" autoFocus
                value={joinPassword} onChange={(e) => setJoinPassword(e.target.value)}
                maxLength={32} placeholder="Server password" autoComplete="current-password"
                onKeyDown={(e) => e.key === "Enter" && doJoinPassword()}
              />
              {joinError && <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "#a83e2f", textAlign: "center" }}>{joinError}</p>}
              <button className="pp-btn pp-btn-leaf" onClick={doJoinPassword}>Join server</button>
              <button className="pp-btn pp-btn-cream" onClick={() => { setPwPrompt(null); setJoinPassword(""); setJoinError(""); }}>Cancel</button>
            </div>
          </>
        )}
        {settingsAnim.shouldRender && (
          <SettingsModal
            onClose={() => setSettingsOpen(false)}
            closing={settingsAnim.closing}
            binds={binds}
            dust={dust}
            debugMode={debugMode}
            showColliders={showColliders}
            uiScale={uiScale}
            showBuddy={showBuddy}
            micDeviceId={micDeviceId}
            voiceMode={voiceMode}
            echoCancellation={echoCancellation}
            voice={voice}
            commitSettings={commitSettings}
          />
        )}
        {customizeAnim.shouldRender && (
          <>
            <div className={customizeAnim.closing ? "pp-anim-fade-out" : "pp-anim-fade-in"} style={{ ...s.backdrop, zIndex: 40, background: "rgba(30,18,12,0.72)" }} onClick={() => setCustomizeCloseSignal((n) => n + 1)} />
            <div className={"pp-scroll " + (customizeAnim.closing ? "pp-anim-center-out" : "pp-anim-center-in")} style={s.customizeModal}>
              <CustomizeMenu
                overlay
                closeSignal={customizeCloseSignal}
                initial={avatar}
                name={(accountId && accountLabel ? accountLabel : name) || "You"}
                onSave={(a) => {
                  setAvatar(a);
                  setCustomizeOpen(false);
                  // logged in: push the look to the account so every device
                  // you log into matches (local cache stays the fallback)
                  if (accountIdRef.current) {
                    cloudAvatarRef.current = JSON.stringify(a);
                    const c = getSupabase();
                    if (c) {
                      const uid = accountIdRef.current;
                      c.from("profiles").update({ avatar: a }).eq("id", uid).then(({ error }) => {
                        if (error) showToast(`Couldn't save your look: ${error.message}`);
                      });
                    }
                  }
                }}
                onCancel={() => setCustomizeOpen(false)}
              />
            </div>
          </>
        )}
      </div>
    );
  }

  const players = room?.players || [];
  const worldName = inCafe ? "Café Interior" : (MAPS[room?.mapId || mapId]?.name || "Cloak Town");
  return (
    <div style={s.root}>
      {/* game stage: always full-size so collapsing the panel never reflows the canvas */}
      <div style={s.stage}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
        {/* café door fade: black cover over the WORLD only (canvas paints
            below everything) — chat, buttons and hints stay visible */}
        <div
          style={{
            position: "absolute", inset: 0, background: "#000", zIndex: 1,
            pointerEvents: "none", opacity: cafeFade ? 1 : 0,
            transition: "opacity 300ms ease",
          }}
        />
        <div style={s.topbar}>
          <button className="pp-iconbtn" onClick={openMenu} title="Options (ESC)"><PauseGlyph /></button>
          {accountId && (
            <button
              className="pp-iconbtn"
              style={{ position: "relative" }}
              onClick={() => { setNotifUnread(0); setAccountTab("friends"); setAccountOpen(true); }}
              title="Notifications — friend requests & room invites"
            >
              <BellGlyph />
              {notifUnread > 0 && (
                <span style={{
                  position: "absolute", top: -6, right: -6, background: "#d95f4b",
                  border: "2px solid #4a3728", color: "white", borderRadius: 12,
                  fontSize: 11, fontWeight: 900, padding: "1px 6px", minWidth: 10, textAlign: "center",
                }}>
                  {notifUnread > 9 ? "9+" : notifUnread}
                </span>
              )}
            </button>
          )}
          <button
            className={"pp-iconbtn " + (voice.muted ? "pp-iconbtn-off" : "pp-iconbtn-on")}
            onClick={() => voice.toggleMute()}
            title={voice.muted ? `Mic off — click or press ${prettyKey(binds.voice)} to talk` : `Mic on (${voiceMode === "ptt" ? "push-to-talk" : "toggle"}) — click to mute`}
          >
            <MicGlyph off={voice.muted} />
          </button>
          <button className="pp-iconbtn" onClick={() => setPickerOpen((o) => !o)} title="Emotes (T)"><EmoteButtonGlyph /></button>
          <button
            className="pp-iconbtn"
            onClick={() => (camOpenRef.current ? setCamOpen(false) : openCamera())}
            title={`Camera (${prettyKey(binds.camera)}) — snap a polaroid`}
          >
            <CameraGlyph />
          </button>
        </div>

        {/* edge tab: glued to the panel edge — same distance (320px),
            duration and easing as the panel slide so they move as one */}
        <button
          style={{ ...s.tab, right: chatOpen ? 320 : 0, transition: chatOpen ? "right 240ms ease-out" : "right 180ms ease-in" }}
          onClick={toggleChat}
          title={chatOpen ? "Hide side panel" : "Show side panel"}
        >
          {chatOpen ? <ChevronGlyph /> : <ChatGlyph />}
          {!chatOpen && unread > 0 && <span style={s.tabBadge}>{unread > 9 ? "9+" : unread}</span>}
        </button>

        {/* emote picker: T toggles, 1-8 fires the visible row, Tab flips pages */}
        {pickerAnim.shouldRender && (
          <div className={"pp-panel " + (pickerAnim.closing ? "pp-anim-bar-out" : "pp-anim-bar-in")} style={s.emoteBar}>
            <button className="pp-btn pp-btn-cream" style={s.emotePageBtn} onClick={() => setPickerPage((p) => (p + pickerPageCount - 1) % pickerPageCount)} title="Previous emotes (←)">‹</button>
            {EMOTES.slice(pickerPage * EMOTES_PER_PAGE, pickerPage * EMOTES_PER_PAGE + EMOTES_PER_PAGE).map((e, i) => (
              <button key={e.id} className="pp-btn pp-btn-cream" style={s.emoteBtn} onClick={() => selectEmote(e.id)} title={`${e.label} (${i + 1})`}>
                <EmoteSvg id={e.id} />
                <span style={s.emoteKey}>{i + 1}</span>
              </button>
            ))}
            <button className="pp-btn pp-btn-cream" style={s.emotePageBtn} onClick={() => setPickerPage((p) => (p + 1) % pickerPageCount)} title="More emotes (Tab)">›</button>
            <span style={s.emotePageHint} title="Tab flips pages">{pickerPage + 1}/{pickerPageCount}</span>
          </div>
        )}

        {/* proximity interact hint — same priority as the E key itself */}
        {!menuOpen && !interactId && !match && !matchInvite && !matchWaiting && carrying && (
          <div style={s.interactHint}>
            Press <b>{prettyKey(binds.interact)}</b> to throw the ball — it flies where you're facing
          </div>
        )}
        {!menuOpen && !interactId && !match && !matchInvite && !matchWaiting && !carrying && carryingPhoto && (
          <div style={s.interactHint}>
            Press <b>{prettyKey(binds.interact)}</b> to set the polaroid down
          </div>
        )}
        {!menuOpen && !interactId && !match && !matchInvite && !matchWaiting && !carrying && !carryingPhoto && carryingShell && (
          <div style={s.interactHint}>
            Press <b>{prettyKey(binds.interact)}</b> to set the shell down
          </div>
        )}
        {!menuOpen && !interactId && !match && !matchInvite && !matchWaiting && !carrying && !carryingPhoto && !carryingShell && !mySitting && inCafe && nearBoard && (
          <div style={s.interactHint}>
            Press <b>{prettyKey(binds.interact)}</b> to draw on the blackboard
          </div>
        )}
        {!menuOpen && !interactId && !match && !matchInvite && !matchWaiting && !carrying && !carryingShell && sittingOnCouch && (
          <div style={s.interactHint}>
            Press <b>{prettyKey(binds.interact)}</b> for the TV · push a direction to get up
          </div>
        )}
        {!menuOpen && !interactId && !match && !matchInvite && !matchWaiting && !carrying && !carryingShell && mySitting && !sittingOnCouch && (
          <div style={s.interactHint}>
            Press <b>{prettyKey(binds.interact)}</b> or move to stand up
          </div>
        )}
        {!menuOpen && !interactId && !match && !matchInvite && !matchWaiting && !carrying && !carryingShell && !mySitting && nearBall && (
          <div style={s.interactHint}>
            Press <b>{prettyKey(binds.interact)}</b> to pick up the ball
          </div>
        )}
        {!menuOpen && !interactId && !match && !matchInvite && !matchWaiting && !carrying && !carryingShell && !mySitting && !nearBall && nearShellId && (
          <div style={s.interactHint}>
            Press <b>{prettyKey(binds.interact)}</b> to pick up the shell
          </div>
        )}
        {!menuOpen && !interactId && !match && !matchInvite && !matchWaiting && !carrying && !carryingShell && !mySitting && !nearBall && !nearShellId && nearCafeDoor && (
          <div style={s.interactHint}>
            Press <b>{prettyKey(binds.interact)}</b> to enter the café
          </div>
        )}
        {!menuOpen && !interactId && !match && !matchInvite && !matchWaiting && !carrying && !carryingShell && !mySitting && !nearBall && !nearShellId && nearCafeExit && (
          <div style={s.interactHint}>
            Press <b>{prettyKey(binds.interact)}</b> to step outside
          </div>
        )}
        {!menuOpen && !interactId && !match && !matchInvite && !matchWaiting && !footballOpen && !carrying && !carryingShell && !mySitting && !nearBall && !nearShellId && !nearCafeDoor && !nearCafeExit && nearSeatId && spectateHint && (
          <div style={s.interactHint}>
            Press <b>{prettyKey(binds.interact)}</b> to spectate the match
          </div>
        )}
        {!menuOpen && !interactId && !match && !matchInvite && !matchWaiting && !footballOpen && !carrying && !carryingShell && !mySitting && !nearBall && !nearShellId && !nearCafeDoor && !nearCafeExit && nearSeatId && !spectateHint && (
          <div style={s.interactHint}>
            Press <b>{prettyKey(binds.interact)}</b> to sit
          </div>
        )}
        {!menuOpen && !interactId && !match && !matchInvite && !matchWaiting && !carrying && !carryingShell && !mySitting && !nearBall && !nearShellId && !nearCafeDoor && !nearCafeExit && !nearSeatId && nearTv && (
          <div style={s.interactHint}>
            {room?.tv ? (
              <>Press <b>{prettyKey(binds.interact)}</b> to join the TV night</>
            ) : (
              <>Press <b>{prettyKey(binds.interact)}</b> for the TV — paste a link, watch together</>
            )}
          </div>
        )}
        {!menuOpen && !interactId && !match && !matchInvite && !matchWaiting && !carrying && !carryingPhoto && !carryingShell && !mySitting && !nearBall && !nearShellId && !nearBoard && !nearCafeDoor && !nearCafeExit && !nearSeatId && !nearTv && nearPhotoId && (
          <div style={s.interactHint}>
            Press <b>{prettyKey(binds.interact)}</b> to look at the polaroid
          </div>
        )}
        {!menuOpen && !interactId && !match && !matchInvite && !matchWaiting && !footballOpen && !carrying && !carryingPhoto && !carryingShell && !mySitting && !nearBall && !nearShellId && !nearCafeDoor && !nearCafeExit && !nearSeatId && !nearTv && !nearPhotoId && onPitch && (
          <div style={s.interactHint}>
            {fb && fb.state !== "end" ? (
              <>Press <b>{prettyKey(binds.interact)}</b> for the match menu</>
            ) : (
              <>Press <b>{prettyKey(binds.interact)}</b> for football — queue up on the pitch</>
            )}
          </div>
        )}
        {!menuOpen && !interactId && !match && !matchInvite && !matchWaiting && !footballOpen && !carrying && !carryingPhoto && !carryingShell && !mySitting && !nearBall && !nearShellId && !nearBoard && !nearCafeDoor && !nearCafeExit && !nearSeatId && !nearTv && !nearPhotoId && !onPitch && nearId && (
          <div style={s.interactHint}>
            Press <b>{prettyKey(binds.interact)}</b> to play with <b>{nearName}</b>
          </div>
        )}

        {/* interaction panel: E near someone */}
        {interactAnim.shouldRender && interactId && (
          <>
            <div className={interactAnim.closing ? "pp-anim-fade-out" : "pp-anim-fade-in"} style={s.backdrop} onClick={() => setInteractId(null)} />
            <div className={interactAnim.closing ? "pp-anim-center-out" : "pp-anim-center-in"} style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 300, maxWidth: "90%", zIndex: 31 }}>
              {viewProfileId && viewProfile ? (
                <>
                  {/* their profile card (divider always shows, even with no bio) */}
                  <div style={{ position: "relative" }}>
                    <div style={{ position: "relative", zIndex: 2, filter: "drop-shadow(0 5px 4px rgba(43,26,18,0.35))" }}>
                      <ProfileCard
                        p={{
                          display_name: viewProfile.display_name,
                          username: viewProfile.username,
                          bio: viewNoAccount ? "This player doesn't have an account yet." : viewProfile.bio,
                          avatar_url: viewProfile.avatar_url,
                          avatar_crop: viewProfile.avatar_crop,
                          country: viewProfile.country,
                          languages: viewProfile.languages,
                          card_color: viewProfile.card_color,
                          card_color2: viewProfile.card_color2,
                          card_text: viewProfile.card_text,
                        }}
                        avatarSize={40}
                        pinned={viewPinned}
                      />
                    </div>
                    <button
                      className="pp-iconbtn pp-iconbtn-off"
                      style={{ position: "absolute", top: -12, right: -12, width: 32, height: 32, fontSize: 13, zIndex: 3 }}
                      onClick={() => setInteractId(null)}
                      title="Close"
                    >
                      ✕
                    </button>
                  </div>
                  {/* actions ride a default-cream block tucked underneath the card */}
                  <div className="pp-panel" style={{ margin: "-28px 10px 0", padding: "38px 14px 14px", position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                    {!viewNoAccount && viewRelation !== "friends" && (
                      viewRelation === null ? (
                        <button className="pp-btn pp-btn-wood" disabled>…</button>
                      ) : viewRelation === "incoming" ? (
                        <button className="pp-btn pp-btn-leaf"
                          onClick={() => void acceptViewRelation()}>
                          Accept friend request
                        </button>
                      ) : (
                        <button className="pp-btn pp-btn-wood"
                          disabled={requestingTo === interactId || viewRelation === "pending"}
                          onClick={() => void sendFriendRequestTo(interactId)}>
                          {requestingTo === interactId ? "Sending…" : viewRelation === "pending" ? "Request pending" : "+ Add friend"}
                        </button>
                      )
                    )}
                    <button
                      className="pp-btn pp-btn-wood"
                      title={`Tip ${viewProfile.display_name} some coins`}
                      onClick={() => { setTipAmount(1); setTipMsg(""); setTipOpen(true); }}
                    >
                      Tip coins
                    </button>
                    <span style={{ position: "relative", display: "flex" }}>
                      <button
                        className="pp-btn pp-btn-cream"
                        style={{ flex: 1 }}
                        onClick={() => setPlayOpen((o) => !o)}
                      >
                        Play together {playOpen ? "▴" : "▾"}
                      </button>
                      {playOpen && (
                        <>
                          <span
                            style={{ position: "fixed", inset: 0, zIndex: 15 }}
                            onClick={() => setPlayOpen(false)}
                          />
                          <span
                            className="pp-card pp-scroll"
                            style={{
                              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 16,
                              maxHeight: 180, overflowY: "auto", padding: 6,
                              display: "flex", flexDirection: "column", gap: 2,
                            }}
                          >
                            {GAME_LIST.map((g) => (
                              <button
                                key={g.id}
                                onClick={() => interactId && sendMatchInvite(interactId, g.id)}
                                style={{
                                  background: "none", border: "none", borderRadius: 8, padding: "8px 10px",
                                  cursor: "pointer", font: "inherit", fontSize: 14, fontWeight: 800,
                                  color: "#4a3728", textAlign: "left",
                                }}
                              >
                                {g.label}
                              </button>
                            ))}
                          </span>
                        </>
                      )}
                    </span>
                  </div>
                  {tipOpen && (
                    <div
                      style={{
                        position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 5,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: "rgba(43,26,18,0.55)", borderRadius: 14,
                      }}
                      onClick={() => setTipOpen(false)}
                    >
                      <div
                        className="pp-panel"
                        style={{ width: 240, maxWidth: "90%", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <b style={{ fontSize: 16, textAlign: "center" }}>Tip {viewProfile.display_name}</b>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "#6b543f", textAlign: "center" }}>
                          You have {myCoins} coin{myCoins === 1 ? "" : "s"}
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <button className="pp-btn pp-btn-wood" style={{ padding: "6px 12px", flexShrink: 0 }} onClick={() => setTipAmount((a) => Math.max(0, a - 1))} title="Less">−</button>
                          <input
                            id="ct-tip-amount" name="tipAmount" type="number" min={0}
                            className="pp-input" style={{ margin: 0, flex: 1, minWidth: 0, textAlign: "center" }}
                            value={tipAmount}
                            onChange={(e) => setTipAmount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                            onKeyDown={(e) => { if (e.key === "Enter") sendTipAmount(); }}
                          />
                          <button className="pp-btn pp-btn-wood" style={{ padding: "6px 12px", flexShrink: 0 }} onClick={() => setTipAmount((a) => a + 1)} title="More">+</button>
                        </div>
                        {tipMsg && <div style={{ fontSize: 12, fontWeight: 800, color: "#a83e2f", textAlign: "center" }}>{tipMsg}</div>}
                        <div style={{ display: "flex", gap: 8 }}>
                          <button className="pp-btn pp-btn-cream" style={{ flex: 1 }} onClick={() => setTipOpen(false)}>Cancel</button>
                          <button className="pp-btn pp-btn-leaf" style={{ flex: 1 }} onClick={sendTipAmount}>Send</button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                // card still loading (in-game name is already known)
                <div className="pp-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                  <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textAlign: "center" }}>{interactName}</h2>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#6b543f", textAlign: "center" }}>
                    Loading profile…
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* football: pitch queue + live match (Sunny Plaza field) */}
        {footballAnim.shouldRender && (
          <>
            <div className={footballAnim.closing ? "pp-anim-fade-out" : "pp-anim-fade-in"} style={s.backdrop} onClick={() => setFootballOpen(false)} />
            <div className={"pp-panel " + (footballAnim.closing ? "pp-anim-center-out" : "pp-anim-center-in")} style={s.miniModal}>
              {!fb ? (
                <>
                  <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textAlign: "center" }}>⚽ Football</h2>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#6b543f", textAlign: "center" }}>
                    West vs East · first to 5 · outs return to midfield
                  </div>
                  {fbQueue.length === 0 ? (
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#6b543f", textAlign: "center" }}>
                      Queue is empty — join to kick off!
                    </div>
                  ) : (
                    <div className="pp-scroll" style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 150, overflowY: "auto" }}>
                      {fbQueue.map((e) => (
                        <div key={e.tab} className="pp-card" style={{ ...s.playerRow, fontSize: 14 }}>
                          <span style={{ flex: 1 }}>{e.name}{e.tab === tabId ? " (you)" : ""}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {fbInQueue ? (
                    <>
                      <button className="pp-btn pp-btn-leaf" disabled={!fbCanStart} onClick={() => socket.emit("football-start")}>
                        Start match
                      </button>
                      {!fbCanStart && (
                        <div style={{ fontSize: 12, fontWeight: 800, color: "#6b543f", textAlign: "center" }}>
                          Need an even 2–8 to start (now {fbQueue.length})
                        </div>
                      )}
                      <button className="pp-btn pp-btn-cream" onClick={() => socket.emit("football-leave")}>
                        Leave queue
                      </button>
                    </>
                  ) : (
                    <button className="pp-btn pp-btn-leaf" onClick={() => socket.emit("football-join")}>
                      Join queue
                    </button>
                  )}
                </>
              ) : (
                <>
                  <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textAlign: "center" }}>
                    WEST {fb.scoreA} – {fb.scoreB} EAST
                  </h2>
                  {fb.state === "goal" && (
                    <div style={{ fontSize: 15, fontWeight: 900, color: "#8a6d1f", textAlign: "center" }}>
                      GOAL{fb.goalBy ? ` — ${fb.goalBy}!` : "!"}
                    </div>
                  )}
                  {fb.state === "end" && (
                    <div style={{ fontSize: 15, fontWeight: 900, textAlign: "center" }}>
                      {fb.winner === "A" ? "WEST" : "EAST"} WINS!
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    {([
                      ["WEST", fb.teamA, fbMyTeam === "A"],
                      ["EAST", fb.teamB, fbMyTeam === "B"],
                    ] as const).map(([label, team, mine]) => (
                      <div key={label} className="pp-card" style={{ flex: 1, padding: "8px 10px", fontSize: 13 }}>
                        <b>{label}{mine ? " (you)" : ""}</b>
                        {team.map((t) => (
                          <div key={t.tab} style={{ fontWeight: 700 }}>{t.name}</div>
                        ))}
                      </div>
                    ))}
                  </div>
                  {fbMyTeam && fb.state !== "end" && (
                    <button className="pp-btn pp-btn-cream" onClick={() => socket.emit("football-quit")}>
                      Quit match
                    </button>
                  )}
                </>
              )}
              <button className="pp-btn pp-btn-cream" onClick={() => setFootballOpen(false)}>Close</button>
            </div>
          </>
        )}

        {/* outgoing invite: waiting on them */}
        {waitingAnim.shouldRender && matchWaiting && (
          <>
            <div className={waitingAnim.closing ? "pp-anim-fade-out" : "pp-anim-fade-in"} style={s.backdrop} />
            <div className={"pp-panel " + (waitingAnim.closing ? "pp-anim-center-out" : "pp-anim-center-in")} style={s.miniModal}>
              <div style={{ textAlign: "center", fontWeight: 900, fontSize: 16 }}>
                Waiting for <b>{waitingName}</b>…
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#6b543f", textAlign: "center" }}>invites expire after 25s</div>
              <button className="pp-btn pp-btn-cream" onClick={cancelMatchInvite}>Cancel invite</button>
            </div>
          </>
        )}

        {/* incoming invite: green tick / red cross */}
        {inviteAnim.shouldRender && matchInvite && (
          <>
            <div className={inviteAnim.closing ? "pp-anim-fade-out" : "pp-anim-fade-in"} style={s.backdrop} />
            <div className={"pp-panel " + (inviteAnim.closing ? "pp-anim-center-out" : "pp-anim-center-in")} style={s.miniModal}>
              <div style={{ textAlign: "center", fontWeight: 900, fontSize: 17 }}>
                <b>{matchInvite.fromName}</b> wants to play {gameLabel(matchInvite.kind)}!
              </div>
              <div style={{ display: "flex", gap: 14, justifyContent: "center" }}>
                <button
                  onClick={() => respondMatch(true)}
                  title="Accept (play!)"
                  style={verdictBtn("#58a05c")}
                >✓</button>
                <button
                  onClick={() => respondMatch(false)}
                  title="Decline"
                  style={verdictBtn("#d95f4b")}
                >✕</button>
              </div>
            </div>
          </>
        )}

        {/* the board itself */}
        {matchAnim.shouldRender && match && (
          <>
            {match.kind === "ttt" && (
              <TicTacToe
                game={match}
                closing={matchAnim.closing}
                myId={myId}
                queued={rematchQueued}
                offerFromName={rematchOffer && rematchOffer.gameId === match.gameId ? rematchOffer.fromName : null}
                onMove={matchMove}
                onQuit={quitMatch}
                onRematch={queueRematch}
                onCancelRematch={cancelRematch}
              />
            )}
            {match.kind === "rps" && (
              <RpsBoard
                game={match}
                closing={matchAnim.closing}
                myId={myId}
                queued={rematchQueued}
                offerFromName={rematchOffer && rematchOffer.gameId === match.gameId ? rematchOffer.fromName : null}
                onMove={matchMove}
                onQuit={quitMatch}
                onRematch={queueRematch}
                onCancelRematch={cancelRematch}
              />
            )}
            {match.kind === "dots" && (
              <DotsBoard
                game={match}
                closing={matchAnim.closing}
                myId={myId}
                queued={rematchQueued}
                offerFromName={rematchOffer && rematchOffer.gameId === match.gameId ? rematchOffer.fromName : null}
                onMove={matchMove}
                onQuit={quitMatch}
                onRematch={queueRematch}
                onCancelRematch={cancelRematch}
              />
            )}
            {match.kind === "c4" && (
              <ConnectFour
                game={match}
                closing={matchAnim.closing}
                myId={myId}
                queued={rematchQueued}
                offerFromName={rematchOffer && rematchOffer.gameId === match.gameId ? rematchOffer.fromName : null}
                onMove={matchMove}
                onQuit={quitMatch}
                onRematch={queueRematch}
                onCancelRematch={cancelRematch}
              />
            )}
          </>
        )}

        {/* cozy TV: E in front of the arcade wall screen */}
        {tvAnim.shouldRender && (
          <TvModal
            closing={tvAnim.closing}
            tv={room?.tv ?? null}
            watchers={players.length}
            onPlay={(url) => socket.emit("tv-play", { url })}
            onPause={() => socket.emit("tv-pause")}
            onResume={() => socket.emit("tv-resume")}
            onRestart={() => socket.emit("tv-restart")}
            onSeek={(position) => socket.emit("tv-seek", { position })}
            onStop={() => socket.emit("tv-stop")}
            onClose={() => setTvOpen(false)}
          />
        )}

        {/* café blackboard: shared chalk — what you draw lands on the wall */}
        {boardAnim.shouldRender && (
          <Blackboard
            strokes={room?.board?.strokes || []}
            menu={room?.board?.menu !== false}
            closing={boardAnim.closing}
            onClose={() => setBoardOpen(false)}
            onStroke={(st) => socket.emit("board-stroke", st)}
            onClear={() => socket.emit("board-clear")}
          />
        )}

        {/* polaroid camera: frozen frame, square crop on you, effects */}
        {camAnim.shouldRender && camShot && (
          <CameraModal
            closing={camAnim.closing}
            shot={camShot}
            onClose={() => setCamOpen(false)}
            onSaveInGame={saveInGamePhoto}
          />
        )}

        {/* polaroid viewer: look at a shared print, or pick it up */}
        {photoAnim.shouldRender && viewPhotoId && (() => {
          const ph = room?.photos?.find((p) => p.id === viewPhotoId) || null;
          const img = viewPhotoId ? photoImgs.current.get(viewPhotoId) || null : null;
          const mine = !!ph && ph.holder === myId;
          return (
            <>
              <div className={photoAnim.closing ? "pp-anim-fade-out" : "pp-anim-fade-in"} style={s.backdrop} onClick={() => setViewPhotoId(null)} />
              <div className={"pp-panel " + (photoAnim.closing ? "pp-anim-center-out" : "pp-anim-center-in")} style={s.miniModal}>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textAlign: "center" }}>
                  {ph ? `Photo by ${ph.ownerName}` : "Photo"}
                </h2>
                <div style={{ alignSelf: "center", background: "#fff8e7", border: "3px solid #4a3728", borderRadius: 6, padding: 10, paddingBottom: 8, boxShadow: "0 4px 0 #4a3728" }}>
                  {img ? (
                    <img src={img} alt="Shared polaroid" style={{ width: 240, height: 240, display: "block", borderRadius: 2 }} />
                  ) : (
                    <div style={{ width: 240, height: 240, display: "flex", alignItems: "center", justifyContent: "center", background: "#d9c193", borderRadius: 2, fontWeight: 800, color: "#6b543f" }}>
                      Developing…
                    </div>
                  )}
                  <div style={{ textAlign: "center", fontWeight: 900, fontSize: 14, color: "#4a3728", paddingTop: 6, fontStyle: "italic" }}>
                    {ph?.caption || "Cloak Town"}
                  </div>
                </div>
                {ph && !ph.holder && !mine && !carryingShell && (
                  <button
                    className="pp-btn pp-btn-leaf"
                    onClick={() => {
                      socket.emit("photo-pickup", { id: ph.id });
                      setViewPhotoId(null);
                    }}
                    title="Carry it around — Interact sets it back down"
                  >
                    Pick it up
                  </button>
                )}
                {mine && (
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#3e7d46", textAlign: "center" }}>
                    You're holding this one — Interact sets it down.
                  </div>
                )}
                <button className="pp-btn pp-btn-cream" onClick={() => setViewPhotoId(null)}>Close</button>
              </div>
            </>
          );
        })()}

        {menuAnim.shouldRender && (
          <>
            <div className={menuAnim.closing ? "pp-anim-fade-out" : "pp-anim-fade-in"} style={s.backdrop} />
            <div className={"pp-panel pp-scroll " + (menuAnim.closing ? "pp-anim-center-out" : "pp-anim-center-in")} style={s.modal}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h2 style={{ margin: 0, fontSize: 21, fontWeight: 900 }}>{room?.name || worldName}</h2>
                <button className="pp-iconbtn pp-iconbtn-off" style={{ width: 38, height: 38, fontSize: 15 }} onClick={() => setMenuOpen(false)} title="Close">✕</button>
              </div>
              {room?.desc && (
                <div style={{ fontSize: 14, fontWeight: 700, color: "#6b543f" }}>{room.desc}</div>
              )}
              <div style={s.modalRow}>
                <span>{worldName} · {room?.isPrivate ? "Private" : "Public"} · {players.length}{room?.maxPlayers ? `/${room.maxPlayers}` : ""} online</span>
                <span style={{ color: connected ? "#3e7d46" : "#b3814d", fontSize: 13, fontWeight: 800 }}>{connected ? "● connected" : "○ reconnecting…"}</span>
              </div>
              <div style={s.modalRow}>
                <span>Room <b>{room?.code}</b></span>
              </div>
              <button className="pp-btn pp-btn-wood" onClick={() => { navigator.clipboard?.writeText(room?.code || ""); alert("Room code copied: " + room?.code); }}>
                Copy invite code
              </button>

              {accountId && (
                <button
                  className="pp-btn pp-btn-cream"
                  onClick={() => { setAccountTab("profile"); setAccountOpen(true); }}
                >
                  Profile{notifUnread > 0 ? ` (${notifUnread})` : ""}
                </button>
              )}

              <button className="pp-btn pp-btn-cream" onClick={() => setSettingsOpen(true)}>
                Settings
              </button>

              <button className="pp-btn pp-btn-danger" onClick={leaveRoom}>Leave room</button>
            </div>
          </>
        )}
        {accountAnim.shouldRender && (
        <AccountPanel
          open={accountOpen}
          closing={accountAnim.closing}
          onClose={() => setAccountOpen(false)}
          onAccount={handleAccount}
          accountId={accountId}
          onFriendsList={setFriendIds}
          avatar={avatar}
          startTab={accountTab}
          inviteCode={screen === "game" ? (room?.code || null) : null}
          roomUserIds={screen === "game" ? (room?.players.map((p) => p.userId).filter((u): u is string => !!u) || []) : []}
          serverName={screen === "game" ? (room?.name || "") : ""}
          onJoinRoom={acceptInvite}
        />
        )}
        {settingsAnim.shouldRender && (
          <SettingsModal
            onClose={() => setSettingsOpen(false)}
            closing={settingsAnim.closing}
            binds={binds}
            dust={dust}
            debugMode={debugMode}
            showColliders={showColliders}
            uiScale={uiScale}
            showBuddy={showBuddy}
            micDeviceId={micDeviceId}
            voiceMode={voiceMode}
            echoCancellation={echoCancellation}
            voice={voice}
            commitSettings={commitSettings}
            />
        )}
        {toast && (
          <div style={{
            position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 50,
            background: "#4a3728", color: "#fff8e7", fontWeight: 800, fontSize: 14,
            padding: "8px 20px", borderRadius: 999, boxShadow: "0 3px 0 #2b1f16",
            pointerEvents: "none",
          }}>
            {toast}
          </div>
        )}
      </div>

      {/* side panel: absolute overlay — showing/hiding never touches canvas size */}
      {chatAnim.shouldRender && (
        <div className={"pp-panel " + (chatAnim.closing ? "pp-anim-side-out" : "pp-anim-side-in")} style={s.side}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <PersonGlyph />
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, flex: 1 }}>{players.length} online</h3>
            <button className="pp-btn pp-btn-cream" style={{ padding: "5px 12px", fontSize: 14 }} onClick={() => setPlayersOpen((o) => !o)} title={playersOpen ? "Hide player list" : "Show player list"}>
              {playersOpen ? "▾" : "▸"}
            </button>
          </div>
          {playersOpen && (
            <div className="pp-scroll" style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10, maxHeight: 164, overflowY: "auto", paddingRight: 2 }}>
              {players.map((p) => (
                <div key={p.id} className="pp-card" style={s.playerRow}>
                  <span style={{ width: 15, height: 15, borderRadius: "50%", background: p.color, border: "2.5px solid #4a3728", display: "inline-block", flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{p.name} {p.id === myId ? "(you)" : ""}</span>
                  {p.speaking && <span className="pp-speaking-dot" />}
                </div>
              ))}
            </div>
          )}
          <div className="pp-card" style={s.youCard} key={coinFlash} title="Coins in this server — kept if you leave and rejoin">
            <span style={{ width: 20, height: 20, borderRadius: "50%", background: color, border: "2.5px solid #4a3728", display: "inline-block", flexShrink: 0 }} />
            <b style={{ flex: 1 }}>{name}</b>
            <CoinDot />
            <b>{myCoins}</b>
          </div>
          <div className="pp-scroll" style={{ flex: 1, overflowY: "auto", background: "#f1e4c3", border: "3px solid #d9c193", borderRadius: 14, padding: 10, minHeight: 120, marginTop: 10, boxShadow: "inset 0 3px 0 rgba(74,55,40,0.12)" }}>
            {chat.map((m, i) => (
              m.id === "system" ? (
                <div key={i} className="pp-msg-sys">★ {m.text}</div>
              ) : (
                <div key={i} className="pp-card" style={{ fontSize: 14, padding: "6px 10px", marginBottom: 6 }}>
                  <b style={{ color: "#4e8d7c" }}>{m.name} </b><span style={{ color: "#4a3728", fontWeight: 700 }}>{m.text}</span>
                </div>
              )
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input id="ct-chat" name="chat" className="pp-input" style={{ margin: 0, flex: 1 }} value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendChat()}
              placeholder="Say something…" maxLength={140} />
            <button className="pp-btn pp-btn-leaf" style={{ padding: "9px 16px" }} onClick={sendChat}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100%", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
  card: { padding: 30, maxWidth: 640, width: "100%" },
  // game root: stage is always full-size; panel is an absolute overlay
  root: { position: "relative", height: "100%", overflow: "hidden", background: "#241a12", fontFamily: "inherit" },
  stage: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  topbar: { position: "absolute", top: 12, left: 12, display: "flex", gap: 10, alignItems: "center", zIndex: 10 },
  hint: { position: "absolute", bottom: 12, left: 14, fontSize: 13, fontWeight: 800, color: "#4a3728", background: "#faf3df", border: "3px solid #4a3728", padding: "6px 14px", borderRadius: 999, zIndex: 5, pointerEvents: "none", boxShadow: "0 3px 0 #4a3728" },
  interactHint: { position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)", fontSize: 14, fontWeight: 800, color: "#4a3728", background: "#faf3df", border: "3px solid #4a3728", padding: "8px 18px", borderRadius: 999, zIndex: 12, pointerEvents: "none", boxShadow: "0 3px 0 #4a3728", whiteSpace: "nowrap" },
  miniModal: { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 300, maxWidth: "90%", padding: 22, zIndex: 31, display: "flex", flexDirection: "column", gap: 12 },
  // panel overlay + edge collapse tab (tab never unmounts the canvas)
  side: { position: "absolute", top: 0, right: 0, bottom: 0, width: 320, boxSizing: "border-box", padding: 14, display: "flex", flexDirection: "column", zIndex: 15, borderRadius: "18px 0 0 18px", borderRight: "none" },
  tab: { position: "absolute", top: "50%", transform: "translateY(-50%)", width: 38, height: 88, background: "#8a5a33", border: "3px solid #4a3728", borderRight: "none", borderRadius: "10px 0 0 10px", color: "white", cursor: "pointer", fontSize: 15, zIndex: 16, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "-3px 3px 0 rgba(0,0,0,0.3)", padding: 0 },
  tabBadge: { position: "absolute", top: -10, left: -10, background: "#d95f4b", border: "2.5px solid #4a3728", color: "white", borderRadius: 12, fontSize: 12, fontWeight: 900, padding: "2px 7px", minWidth: 12, textAlign: "center" },
  emoteBar: { position: "absolute", bottom: 56, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 8, padding: 10, zIndex: 20, borderRadius: 16, alignItems: "center" },
  emoteBtn: { position: "relative", width: 54, height: 54, padding: 6, display: "flex", alignItems: "center", justifyContent: "center" },
  emoteKey: { position: "absolute", bottom: -8, right: -8, background: "#d95f4b", border: "2px solid #4a3728", color: "white", borderRadius: 9, fontSize: 11, fontWeight: 900, padding: "0px 5px" },
  emotePageBtn: { width: 30, height: 54, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 900 },
  emotePageHint: { fontSize: 11, fontWeight: 900, color: "#6b543f", minWidth: 26, textAlign: "center" },
  youCard: { display: "flex", gap: 9, alignItems: "center", fontSize: 15, fontWeight: 800, padding: "9px 12px" },
  playerRow: { display: "flex", gap: 9, alignItems: "center", fontSize: 15, fontWeight: 700, padding: "7px 11px" },
  // options modal
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(43,26,18,0.62)", zIndex: 30 },  modal: { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 380, maxWidth: "92%", maxHeight: "92%", padding: 22, zIndex: 31, display: "flex", flexDirection: "column", gap: 9 },
  customizeModal: { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 1020, maxWidth: "96vw", maxHeight: "94vh", overflowY: "auto", overflowX: "hidden", zIndex: 41, borderRadius: 20, padding: 4 },
  modalRow: { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14, fontWeight: 700, color: "#6b543f" },
};

/** Big round verdict button (green tick / red cross) for game invites. */
function verdictBtn(bg: string): React.CSSProperties {
  return {
    width: 64, height: 64, borderRadius: "50%", background: bg, color: "#fff8e7",
    border: "3px solid #4a3728", boxShadow: "0 4px 0 #4a3728",
    fontSize: 28, fontWeight: 900, cursor: "pointer", fontFamily: "inherit",
  };
}

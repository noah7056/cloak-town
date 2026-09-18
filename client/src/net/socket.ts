import { io, Socket } from "socket.io-client";
import type { Avatar } from "../game/avatar";

let s: Socket | null = null;

/** Where the game server lives (env override → Vite-dev fallback → same origin). */
export function serverUrlLabel(): string {
  const env = (import.meta.env.VITE_SERVER_URL || "").trim();
  if (env) return env;
  if (typeof window !== "undefined" && window.location.port === "5173") return "http://localhost:3001";
  if (typeof window !== "undefined") return window.location.origin;
  return "?";
}

export function getSocket(): Socket {
  if (!s) {
    // Priority: explicit VITE_SERVER_URL > Vite-dev fallback (:5173 page
    // means the game server is on :3001) > same origin (single-URL deploy
    // where the server serves client/dist, zero config needed).
    const url = serverUrlLabel();
    const isSameOrigin = typeof window !== "undefined" && url === window.location.origin;
    s = isSameOrigin
      ? io({ transports: ["websocket"] })
      : io(url, { transports: ["websocket"] });
  }
  return s;
}

export type Player = {
  id: string;
  /** persistent per-browser id: per-server coin balances are keyed by this */
  pid?: string;
  name: string;
  color: string;
  avatar?: Avatar;
  x: number; y: number;
  dir: string; moving: boolean;
  bubble?: string; speaking?: boolean;
  emote?: string; emoteAt?: number;
  z?: number; crouch?: boolean;
  sitting?: boolean; seatId?: string | null;
  /** ms timestamp of last +1 earn — engine draws the floating popup */
  coinPop?: number;
  /** server teleport stamp (football kickoff) — engine snaps exactly */
  warp?: number;
};

export type TvState = {
  url: string;
  playing: boolean;
  /** playhead seconds at updatedAt (add elapsed while playing) */
  position: number;
  updatedAt: number;
  by?: string;
} | null;

export type Coin = { id: string; x: number; y: number };

/** One pitch queue entry (tab-keyed: two tabs = two players). */
export type FootballQueueEntry = { pid: string; tab: string; name: string };

export type FootballTeamEntry = { id: string | null; pid: string; tab: string; name: string };

/** Live pitch match. West (teamA) defends west, East (teamB) defends east.
 *  Socket ids resolve per broadcast; pids are stable across reconnects. */
export type FootballState = {
  state: "play" | "goal" | "end";
  scoreA: number;
  scoreB: number;
  teamA: FootballTeamEntry[];
  teamB: FootballTeamEntry[];
  goalTeam: "A" | "B" | null;
  goalBy: string | null;
  winner: "A" | "B" | null;
};

export type RoomState = {
  code: string;
  name?: string;
  desc?: string;
  maxPlayers?: number;
  isPrivate?: boolean;
  mapId: string;
  players: Player[];
  ball: { x: number; y: number; vx: number; vy: number; holder?: string | null };
  tv: TvState;
  photos?: Photo[];
  coins?: Coin[];
  balances?: Record<string, number>;
  footballQueue?: FootballQueueEntry[];
  football?: FootballState | null;
};

/** A shared polaroid: metadata rides room-state, jpeg bytes ride
 *  photo-new / photo-sync (id -> dataURL cache lives client-side). */
export type Photo = {
  id: string;
  ownerName: string;
  caption: string;
  x: number; y: number;
  holder?: string | null;
  placedAt: number;
};

/** Full photo record as sent by photo-new / photo-sync (includes the jpeg). */
export type PhotoFull = Photo & { img: string };

/** One row in the server browser (public servers only — never has a password). */
export type ServerInfo = {
  code: string;
  name: string;
  desc: string;
  mapId: string;
  playerCount: number;
  maxPlayers: number;
  hasPassword: boolean;
};

export type JoinError = { msg: string; needPassword?: boolean; code?: string };

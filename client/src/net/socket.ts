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
  /** Supabase auth user id (null for guests) — links presence to accounts */
  userId?: string | null;
  name: string;
  color: string;
  avatar?: Avatar;
  x: number; y: number;
  dir: string; moving: boolean;
  /** true while the run key is held (drives water spray + gait) */
  sprint?: boolean;
  bubble?: string; speaking?: boolean;
  emote?: string; emoteAt?: number;
  z?: number; crouch?: boolean;
  sitting?: boolean; seatId?: string | null;
  /** "snake" while locked at the snake cabinet (Shift+E leaves) */
  snakeLock?: string | null;
  /** "pong" while locked at the pong cabinet (Shift+E leaves) */
  pongLock?: string | null;
  /** "ah" while locked at the air hockey table (Shift+E leaves) */
  ahLock?: string | null;
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

/** One chalk stroke on the café blackboard (points normalized 0..1). */
export type BoardStroke = {
  color: string;
  /** line width as a fraction of the slate width */
  size: number;
  pts: [number, number][];
};

export type BoardState = {
  strokes: BoardStroke[];
  /** false once the printed house menu has been wiped off with the rest */
  menu: boolean;
};

/** A beach shell: little pink carryable (E to grab, E to set down). */
export type Shell = {
  id: string;
  x: number; y: number;
  holder?: string | null;
  tint: string;
};

/** One deck-tabletop item (free play — normalized 0..1 table space). */
export type TableItem = {
  id: string;
  kind: "card" | "chip" | "die" | "coin" | "board" | "piece";
  /** normalized position on the tabletop */
  x: number; y: number;
  /** pile order — higher is on top, server-authoritative (boards pin at 0) */
  z?: number;
  /** cards only: french | italian | uno (default french) */
  deck?: string;
  rank?: string; suit?: string; faceUp?: boolean;
  /** chips only (hex); pieces: black | white | red */
  color?: string;
  /** dice only: 1-6 */
  value?: number;
  /** pieces only: pawn | rook | … (chess) or fairy id (others) */
  ptype?: string;
  /** pieces only: chess | others (default chess) */
  pset?: string;
  /** boards only: chess | morabaraba */
  variant?: string;
  /** pile id (shared by stacked cards) — higher z within is on top */
  stack?: string;
  /** quarter-turns clockwise (0-3) */
  rot?: number;
};

/** One pitch queue entry (tab-keyed: two tabs = two players). */
export type FootballQueueEntry = { pid: string; tab: string; name: string };

export type FootballTeamEntry = { id: string | null; pid: string; tab: string; name: string };

/** Toy-car race: three color-coded sticks on the ground + matching cars. */
export type RaceStick = { id: number; color: string; x: number; y: number; holder: string | null };
export type RaceCar = { id: number; color: string; x: number; y: number; angle: number; speed: number; holder: string | null };
export type RacePart = {
  sid: string; tab: string; pid: string; name: string; carId: number; color: string;
  progress: number; checkpoint: boolean; finishMs: number | null; lastAngle: number;
};
export type RaceState = {
  state: "countdown" | "racing" | "finished";
  countdownAt: number; startAt: number; endAt: number;
  winnerTab: string | null;
  parts: RacePart[];
} | null;

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

/** Live snake run on the arcade cabinet (null when nobody started one).
 *  Spectators mirror cells/food/score; the holder steers via snake-turn. */
export type SnakeState = {
  holder: string;
  holderName: string;
  status: "play" | "over";
  score: number;
  best: number;
  win: boolean;
  w: number;
  h: number;
  cells: [number, number][];
  food: [number, number] | null;
} | null;

/** Live pong match on the arcade cabinet (null when the board is fresh).
 *  Paddles/ball ride room-state at 20Hz; players steer via pong-input. */
export type PongState = {
  p1: string | null;
  p2: string | null;
  p1Name: string;
  p2Name: string;
  status: "lobby" | "countdown" | "play" | "over";
  s1: number;
  s2: number;
  pad1: number;
  pad2: number;
  ball: { x: number; y: number } | null;
  ready1: boolean;
  ready2: boolean;
  countdownAt: number;
  winner: string | null;
  winnerName: string | null;
  winByQuit: boolean;
} | null;

/** Live air hockey match (null when the table is fresh).
 *  Field units match the room table 1:1 (260x100); the table itself renders
 *  the live state in-world, so bystanders watch without a modal. */
export type AhState = {
  p1: string | null;
  p2: string | null;
  p1Name: string;
  p2Name: string;
  status: "lobby" | "countdown" | "play" | "over";
  s1: number;
  s2: number;
  st1: { x: number; y: number };
  st2: { x: number; y: number };
  puck: { x: number; y: number } | null;
  ready1: boolean;
  ready2: boolean;
  countdownAt: number;
  winner: string | null;
  winnerName: string | null;
  winByQuit: boolean;
} | null;

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
  shells?: Shell[];
  board?: BoardState;
  balances?: Record<string, number>;
  /** arcade tokens per pid (1 coin = 5, 1 per snake run) */
  tokens?: Record<string, number>;
  snake?: SnakeState;
  /** snake personal bests per pid (this server) */
  snakePB?: Record<string, number>;
  pong?: PongState;
  ah?: AhState;
  footballQueue?: FootballQueueEntry[];
  football?: FootballState | null;
  raceSticks?: RaceStick[];
  raceCars?: RaceCar[];
  race?: RaceState;
  /** deck tabletops: 4 open free-play surfaces (cards + chips) */
  tables?: TableState[];
};

export type TableState = { items: TableItem[] };

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

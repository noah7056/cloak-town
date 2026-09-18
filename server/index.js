import express from "express";
import http from "http";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { Server } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/api", (_req, res) => res.json({
  ok: true,
  service: "cloak-town-server",
}));

// Single-URL mode: if the client has been built (npm run build in /client),
// serve it from here so one link does everything (open → join public /
// create private / share code). Dev mode still uses Vite on :5173.
const distDir = path.join(__dirname, "..", "client", "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/socket\.io|\/health|\/api).*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
} else {
  app.get("/", (_req, res) => res.json({
    ok: true,
    service: "cloak-town-server",
    howTo: "Run the client (cd client; npm run dev) and open http://localhost:5173. It connects here via VITE_SERVER_URL.",
  }));
}

const server = http.createServer(app);
// Generous heartbeat: background tabs get throttled and would otherwise be
// dropped (killing their voice) just for being unfocused for a bit.
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const PORT = process.env.PORT || 3001;

// ---------- Server model ----------
// Server (a player-created room):
// { code, name, desc, mapId, isPrivate, password (private only, plain —
//   game-room convenience, NOT secure: don't reuse a real password),
//   maxPlayers, players: Map<socketId, player>, ball, tv,
//   createdAt, emptySince (null while occupied) }
// Player: { id, name, color, x, y, dir, moving, bubble, speaking, pid,
//   coinPop (ms timestamp of last +1 earn, for the in-world popup) }
// Coins: room.coins is id -> { id, x, y } (value is always 1 for now);
// room.balances is pid -> coin count, one ledger per server room. pid is a
// client-generated persistent id (pp-pid) so leaving + rejoining the same
// server keeps your coins; balances vanish with the room when it's deleted.
//
// No external database needed: servers are ephemeral by design (empty ones
// expire via the sweeper below). A DB would only make sense later for
// persistent accounts/stats — not for the live server list.

const rooms = new Map();

// Server-browser tuning.
const ALLOWED_MAX = [4, 6, 8, 12, 16];
const DEFAULT_MAX = 8;
const MAX_SERVER_NAME = 24;
const MAX_SERVER_DESC = 120;
const MAX_PASSWORD = 32;
// Empty servers linger this long so a brief 0-player gap (everyone
// reconnecting at once) doesn't nuke the room, then get deleted.
const EMPTY_TTL_MS = 5 * 60 * 1000;

const MAP_SPAWNS = {
  plaza: { x: 800, y: 730 }, // open lawn below the fountain
  beach: { x: 800, y: 620 }, // clear sand between palms and campfire
  arcade: { x: 480, y: 520 }, // just inside the entrance door
};

const MAP_SIZE = {
  plaza: { w: 1600, h: 1200 },
  beach: { w: 1600, h: 1200 },
  arcade: { w: 960, h: 640 },
};

// Mirrors client/src/game/maps.ts — the ball needs the same walls.
const BENCHES = [
  { x: 460, y: 508, w: 110, h: 36 },
  { x: 1030, y: 508, w: 110, h: 36 },
];

// Spectator stands above the pitch (mirrors client PLAZA_STANDS).
const STANDS = [
  { x: 1095, y: 788, w: 110, h: 36 },
  { x: 1395, y: 788, w: 110, h: 36 },
];

// Sit spots (mirrors client SEATS). Sitters snap to x/y and face dir.
const SEATS = [
  ...BENCHES.flatMap((b, bi) => [
    { id: `plaza-bench-${bi + 1}-a`, mapId: "plaza", x: b.x + 30, y: b.y + 10, dir: "down" },
    { id: `plaza-bench-${bi + 1}-b`, mapId: "plaza", x: b.x + 80, y: b.y + 10, dir: "down" },
  ]),
  ...STANDS.flatMap((s, si) => [
    { id: `plaza-stand-${si + 1}-a`, mapId: "plaza", x: s.x + 30, y: s.y + 10, dir: "down" },
    { id: `plaza-stand-${si + 1}-b`, mapId: "plaza", x: s.x + 80, y: s.y + 10, dir: "down" },
  ]),
  { id: "beach-log-1-a", mapId: "beach", x: 694, y: 468, dir: "up", stand: "down" },
  { id: "beach-log-1-b", mapId: "beach", x: 722, y: 468, dir: "up", stand: "down" },
  { id: "beach-log-2-a", mapId: "beach", x: 878, y: 468, dir: "up", stand: "down" },
  { id: "beach-log-2-b", mapId: "beach", x: 906, y: 468, dir: "up", stand: "down" },
  { id: "arcade-couch-a", mapId: "arcade", x: 174, y: 420, dir: "down" },
  { id: "arcade-couch-b", mapId: "arcade", x: 256, y: 420, dir: "down" },
];

function seatById(id) {
  return SEATS.find((s) => s.id === id) || null;
}

// Per-world ball size: plaza football, big bouncy beach ball, pocket-size 8-ball.
const BALL_RADIUS = { plaza: 14, beach: 19, arcade: 11 };
function ballRadius(mapId) {
  return BALL_RADIUS[mapId] || 14;
}

const COLLIDERS = {
  plaza: [
    { x: 700, y: 480, w: 200, h: 140 },
    { x: 180, y: 180, w: 260, h: 150 },
    { x: 1180, y: 180, w: 240, h: 140 },
    { x: 180, y: 900, w: 300, h: 120 },
    // football field here now (walkable — no collider)
    ...[[500, 300], [1100, 350], [350, 700], [1250, 700], [600, 950], [1000, 950]]
      .map(([tx, ty]) => ({ x: tx - 10, y: ty - 6, w: 20, h: 28 })),
    // lamp posts
    ...[[640, 640], [960, 640]]
      .map(([lx, ly]) => ({ x: lx - 8, y: ly - 54, w: 16, h: 56 })),
    ...BENCHES.map((b) => ({ ...b })),
    ...STANDS.map((s) => ({ ...s })),
    // post-fence world edge
    { x: 0, y: 0, w: 1600, h: 30 },
    { x: 0, y: 0, w: 30, h: 1200 },
    { x: 1570, y: 0, w: 30, h: 1200 },
    { x: 0, y: 1170, w: 1600, h: 30 },
  ],
  beach: [
    { x: 0, y: 900, w: 1600, h: 300 },
    { x: 200, y: 200, w: 180, h: 120 },
    { x: 1250, y: 250, w: 160, h: 110 },
    { x: 775, y: 425, w: 50, h: 50 },
    ...[[400, 400], [1150, 500], [700, 300]]
      .map(([tx, ty]) => ({ x: tx - 8, y: ty, w: 16, h: 40 })),
    // rope-fence edges (bottom is the sea, already blocked)
    { x: 0, y: 0, w: 1600, h: 30 },
    { x: 0, y: 0, w: 30, h: 1200 },
    { x: 1570, y: 0, w: 30, h: 1200 },
  ],
  arcade: [
    { x: 100, y: 120, w: 200, h: 90 },
    { x: 660, y: 120, w: 200, h: 90 },
    { x: 100, y: 370, w: 220, h: 90 }, // couch
    { x: 140, y: 552, w: 140, h: 36 }, // TV console
    { x: 866, y: 468, w: 28, h: 34 }, // plant pot
    // walls (the top band is wall, not floor)
    { x: 0, y: 0, w: 960, h: 104 },
    { x: 0, y: 0, w: 16, h: 640 },
    { x: 944, y: 0, w: 16, h: 640 },
    // bottom wall + entrance door (door juts out, own extended box)
    { x: 0, y: 584, w: 960, h: 56 },
    { x: 422, y: 572, w: 116, h: 68 },
  ],
};

// lamp posts (plaza) get their trunks appended below.

function makeCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c.slice(0, 3) + "-" + c.slice(3);
}

// Overhead reactions: validated here, rendered by clients for 3.5s.
const EMOTES = ["heart", "laugh", "wow", "huh", "dance", "sleep", "angry", "star"];

// ---------- minigames lobby (server-arbitrated 1v1) ----------
// Pending invites: invitee socket id -> { from, kind }.
// Live games: id -> { id, kind, room, x, o, xName, oName, status,
//   seats, rematch, data }. status: "play" | "xwin" | "owin" | "draw".
// data is kind-specific (boards, scores, turns). Finished games linger
// 90s for rematches; quits notify the opponent.
const GAME_KINDS = ["ttt", "rps", "dots", "c4"];
const gameInvites = new Map();
const games = new Map();
let gameSeq = 1;

function gameBusy(id) {
  for (const g of games.values()) {
    if (g.status !== "play") continue; // lingering result boards don't block
    if (g.x === id || g.o === id) return true;
  }
  return false;
}

function newGameData(kind) {
  switch (kind) {
    case "ttt":
      return { board: Array(9).fill(null), turn: "X" };
    case "rps":
      return { round: 1, scoreX: 0, scoreO: 0, picked: { x: false, o: false }, last: null };
    case "dots":
      return { h: Array(12).fill(null), v: Array(12).fill(null), boxes: Array(9).fill(null), scoreX: 0, scoreO: 0, turn: "X", goAgain: false };
    case "c4":
      return { grid: Array(42).fill(null), turn: "X" };
    default:
      return { board: Array(9).fill(null), turn: "X" };
  }
}

function makeGame(kind, roomCode, x, o, xName, oName) {
  return {
    id: "game-" + (gameSeq++), kind, room: roomCode, x, o, xName, oName,
    status: "play", seats: { x: true, o: true }, rematch: null,
    data: newGameData(kind),
  };
}

function tttWinner(b) {
  const L = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  for (const [a, c, d] of L) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  return null;
}

function applyTttMove(game, mark, move) {
  const i = Number(move.idx);
  const b = game.data.board;
  if (!Number.isInteger(i) || i < 0 || i > 8 || b[i]) return false;
  b[i] = mark;
  const winner = tttWinner(b);
  if (winner) game.status = winner === "X" ? "xwin" : "owin";
  else if (b.every(Boolean)) game.status = "draw";
  else game.data.turn = mark === "X" ? "O" : "X";
  return true;
}

// Per-kind move. Returns true when the move was legal (and applied).
function applyMove(game, pid, move) {
  if (game.status !== "play") return false;
  const mark = pid === game.x ? "X" : pid === game.o ? "O" : null;
  if (!mark) return false;

  switch (game.kind) {
    case "ttt":
      if (mark !== game.data.turn) return false;
      return applyTttMove(game, mark, move || {});

    case "rps":
      // simultaneous reveal: accept pick when both have picked
      if (game.data.picked[mark.toLowerCase()]) return false;
      if (typeof move.choice !== "string") return false;
      if (!["rock", "paper", "scissors"].includes(move.choice)) return false;
      game.data.picked[mark.toLowerCase()] = true;
      // store picks for reveal
      game.data.lastXPick = mark === "X" ? move.choice : game.data.lastXPick;
      game.data.lastOPick = mark === "O" ? move.choice : game.data.lastOPick;
      // if both picked, resolve round
      if (game.data.picked.x && game.data.picked.o) {
        const xPick = game.data.lastXPick;
        const oPick = game.data.lastOPick;
        let roundWinner = null;
        if (xPick === oPick) roundWinner = "draw";
        else if ((xPick === "rock" && oPick === "scissors") ||
                 (xPick === "paper" && oPick === "rock") ||
                 (xPick === "scissors" && oPick === "paper")) {
          roundWinner = "X";
        } else {
          roundWinner = "O";
        }
        if (roundWinner === "X") game.data.scoreX++;
        else if (roundWinner === "O") game.data.scoreO++;
        game.data.last = { x: xPick, o: oPick, winner: roundWinner };
        game.data.picked = { x: false, o: false };
        game.data.round++;
        // check match end
        if (game.data.scoreX >= 3) game.status = "xwin";
        else if (game.data.scoreO >= 3) game.status = "owin";
        else {
          // next round
        }
      }
      return true;

    case "dots": {
      // edge claim (h: rows 0..3 x cols 0..2 indexed r*3+c,
      // v: rows 0..2 x cols 0..3 indexed r*4+c).
      // Edges store their claimer's mark so clients tint them correctly.
      const { type, r, c } = move || {};
      const d = game.data;
      const ri = Number(r), ci = Number(c);
      if (!Number.isInteger(ri) || !Number.isInteger(ci)) return false;
      if (type === "h") {
        if (ri < 0 || ri > 3 || ci < 0 || ci > 2) return false;
        const idx = ri * 3 + ci;
        if (d.h[idx]) return false;
        d.h[idx] = mark;
      } else if (type === "v") {
        if (ri < 0 || ri > 2 || ci < 0 || ci > 3) return false;
        const idx = ri * 4 + ci;
        if (d.v[idx]) return false;
        d.v[idx] = mark;
      } else {
        return false;
      }
      // check for completed boxes
      let boxesMade = 0;
      for (let br = 0; br < 3; br++) {
        for (let bc = 0; bc < 3; bc++) {
          const bIdx = br * 3 + bc;
          if (d.boxes[bIdx]) continue;
          const top = d.h[br * 3 + bc];
          const bottom = d.h[(br + 1) * 3 + bc];
          const left = d.v[br * 4 + bc];
          const right = d.v[br * 4 + bc + 1];
          if (top && bottom && left && right) {
            d.boxes[bIdx] = mark;
            boxesMade++;
            if (mark === "X") d.scoreX++;
            else d.scoreO++;
          }
        }
      }
      if (boxesMade > 0) {
        d.goAgain = true;
        // turn stays same
      } else {
        d.turn = mark === "X" ? "O" : "X";
        d.goAgain = false;
      }
      // check win
      if (d.scoreX + d.scoreO === 9) {
        if (d.scoreX > d.scoreO) game.status = "xwin";
        else if (d.scoreO > d.scoreX) game.status = "owin";
        else game.status = "draw";
      }
      return true;
    }

    case "c4": {
      // column drop
      const col = Number(move.col);
      if (!Number.isInteger(col) || col < 0 || col > 6) return false;
      if (game.data.turn !== mark) return false;
      // find lowest empty row
      let row = -1;
      for (let r = 5; r >= 0; r--) {
        if (!game.data.grid[r * 7 + col]) {
          row = r;
          break;
        }
      }
      if (row === -1) return false;
      game.data.grid[row * 7 + col] = mark;
      // check 4 in a row
      const g = game.data.grid;
      const check = (r, c, dr, dc) => {
        const m = g[r * 7 + c];
        if (!m || m !== mark) return false;
        for (let k = 1; k < 4; k++) {
          const nr = r + dr * k, nc = c + dc * k;
          if (nr < 0 || nr >= 6 || nc < 0 || nc >= 7) return false;
          if (g[nr * 7 + nc] !== mark) return false;
        }
        return true;
      };
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 7; c++) {
          if (check(r, c, 0, 1) || check(r, c, 1, 0) || check(r, c, 1, 1) || check(r, c, 1, -1)) {
            game.status = mark === "X" ? "xwin" : "owin";
            return true;
          }
        }
      }
      // check draw
      if (g.every(Boolean)) {
        game.status = "draw";
        return true;
      }
      game.data.turn = mark === "X" ? "O" : "X";
      return true;
    }

    default:
      return false;
  }
}

function gamePub(g) {
  const base = {
    gameId: g.id, kind: g.kind, x: g.x, o: g.o,
    xName: g.xName, oName: g.oName, status: g.status,
  };
  switch (g.kind) {
    case "ttt":
      return { ...base, board: [...g.data.board], turn: g.data.turn };
    case "rps":
      return {
        ...base, round: g.data.round, scoreX: g.data.scoreX, scoreO: g.data.scoreO,
        picked: { x: g.data.picked.x, o: g.data.picked.o }, last: g.data.last ? { ...g.data.last } : null,
      };
    case "dots":
      return {
        ...base, h: [...g.data.h], v: [...g.data.v], boxes: [...g.data.boxes],
        scoreX: g.data.scoreX, scoreO: g.data.scoreO, turn: g.data.turn, goAgain: g.data.goAgain,
      };
    case "c4":
      return { ...base, grid: [...g.data.grid], turn: g.data.turn };
    default:
      return base;
  }
}

// Finished boards linger 90s so rematches can find them, then vanish.
function scheduleGameExpiry(id) {
  setTimeout(() => {
    const g = games.get(id);
    if (!g || g.status === "play") return;
    games.delete(id);
    if (g.rematch) io.to(g.rematch).emit("game-rematch-expired", { gameId: id });
  }, 90000);
}

function gameSeatName(g, id) {
  return id === g.x ? g.xName : g.oName;
}

// Ending anything a departing socket was part of (invites out, invites in,
// live games) so nobody stares at a dead board.
function gameCleanup(id) {
  for (const [to, pend] of gameInvites) {
    if (pend.from === id) {
      gameInvites.delete(to);
      io.to(to).emit("game-withdrawn", { from: id });
    }
  }
  gameInvites.delete(id);
  for (const [gid, g] of games) {
    if (g.x !== id && g.o !== id) continue;
    const other = g.x === id ? g.o : g.x;
    if (g.status === "play") {
      games.delete(gid);
      io.to(other).emit("game-end", { gameId: gid, reason: "left" });
    } else {
      // result board: free the seat, settle any pending rematch, drop the
      // record once nobody is looking at it anymore
      if (g.x === id) g.seats.x = false;
      else g.seats.o = false;
      if (g.rematch === id) {
        g.rematch = null;
        io.to(other).emit("game-rematch-withdrawn", { gameId: gid });
      } else if (g.rematch === other) {
        g.rematch = null;
        io.to(other).emit("game-rematch-declined", { gameId: gid });
      }
      if (!g.seats.x && !g.seats.o) games.delete(gid);
    }
  }
}

// Avatar validation — mirrors client/src/game/avatar.ts (keep in sync).
const HEX = /^#[0-9a-fA-F]{6}$/;
const ENUMS = {
  eyeStyle: ["round", "happy", "sleepy", "wink", "sharp", "dot"],
  glasses: ["none", "round", "shades", "star"],
  hat: ["none", "beanie", "wizard", "crown", "flower", "horns", "cat", "tophat", "straw", "headphones"],
  pattern: ["solid", "stripes", "dots", "patches"],
  accessory: ["none", "scarf", "bow", "pendant", "straps"],
  faceDeco: ["none", "blush", "freckles", "scar"],
  back: ["none", "angel", "bat", "cape", "tail"],
  petKind: ["none", "blob", "sprout", "wisp"],
};
const AV_DEFAULTS = {
  color: "#ef4444", cloakEnd: "#3b82f6", trim: "#f2c14e", boots: "#3a2a1e", skin: "#2b1f16",
  eyeStyle: "round", glasses: "none", hat: "none", hatColor: "#4e8d7c",
  pattern: "solid", accessory: "none", faceDeco: "none", back: "none",
  backColor: "#faf3df",
  pet: { kind: "none", color: "#f2c14e", accent: "#d95f4b", eyes: "round", blush: false, boots: "#3a2a1e" },
};
function cleanAvatar(raw, colorFallback) {
  const r = (raw && typeof raw === "object") ? raw : {};
  const hex = (v, fb) => (typeof v === "string" && HEX.test(v) ? v : fb);
  const one = (v, list, fb) => (typeof v === "string" && list.includes(v) ? v : fb);
  const pr = (r.pet && typeof r.pet === "object") ? r.pet : {};
  const bool = (v, fb) => (typeof v === "boolean" ? v : fb);
  return {
    color: hex(r.color ?? colorFallback, AV_DEFAULTS.color),
    gradient: r.gradient === true,
    cloakEnd: hex(r.cloakEnd, AV_DEFAULTS.cloakEnd),
    trim: hex(r.trim, AV_DEFAULTS.trim),
    boots: hex(r.boots, AV_DEFAULTS.boots),
    skin: hex(r.skin, AV_DEFAULTS.skin),
    eyeStyle: one(r.eyeStyle, ENUMS.eyeStyle, AV_DEFAULTS.eyeStyle),
    glasses: one(r.glasses, ENUMS.glasses, AV_DEFAULTS.glasses),
    hat: one(r.hat, ENUMS.hat, AV_DEFAULTS.hat),
    hatColor: hex(r.hatColor, AV_DEFAULTS.hatColor),
    pattern: one(r.pattern, ENUMS.pattern, AV_DEFAULTS.pattern),
    accessory: one(r.accessory, ENUMS.accessory, AV_DEFAULTS.accessory),
    faceDeco: one(r.faceDeco, ENUMS.faceDeco, AV_DEFAULTS.faceDeco),
    back: one(r.back, ENUMS.back, AV_DEFAULTS.back),
    backColor: hex(r.backColor, AV_DEFAULTS.backColor),
    pet: {
      kind: one(pr.kind, ENUMS.petKind, AV_DEFAULTS.pet.kind),
      color: hex(pr.color, AV_DEFAULTS.pet.color),
      accent: hex(pr.accent, AV_DEFAULTS.pet.accent),
      eyes: one(pr.eyes, ENUMS.eyeStyle, AV_DEFAULTS.pet.eyes),
      blush: bool(pr.blush, AV_DEFAULTS.pet.blush),
      boots: hex(pr.boots, AV_DEFAULTS.pet.boots),
    },
  };
}

function isBlocked(mapId, x, y, pad = 34) {
  const size = MAP_SIZE[mapId] || MAP_SIZE.plaza;
  if (x < pad || y < pad || x > size.w - pad || y > size.h - pad) return true;
  return (COLLIDERS[mapId] || []).some(
    (c) => x > c.x - pad && x < c.x + c.w + pad && y > c.y - pad && y < c.y + c.h + pad
  );
}

// Find a spawn point that isn't inside (or right against) a collider, so
// players never materialize stuck in the fountain/campfire/walls.
function safeSpawn(room) {
  const size = MAP_SIZE[room.mapId] || MAP_SIZE.plaza;
  const base = MAP_SPAWNS[room.mapId] || MAP_SPAWNS.plaza;
  const candidates = [{ x: base.x, y: base.y }];
  for (let r = 60; r <= 480; r += 60) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      candidates.push({ x: base.x + Math.cos(a) * r, y: base.y + Math.sin(a) * r });
    }
  }
  for (const c of candidates) {
    const x = Math.max(40, Math.min(size.w - 40, c.x));
    const y = Math.max(40, Math.min(size.h - 40, c.y));
    if (!isBlocked(room.mapId, x, y)) return { x, y };
  }
  return { x: size.w / 2, y: size.h / 2 };
}

function cleanStr(v, max) {
  return String(v || "").trim().slice(0, max);
}

function findRoom(code) {
  if (!code) return null;
  // Accept "abc123", "ABC123" and "ABC-123" alike.
  const norm = cleanStr(code, 16).toUpperCase().replace(/-/g, "");
  for (const room of rooms.values()) {
    if (room.code.replace(/-/g, "") === norm) return room;
  }
  return null;
}

function createServerRoom({ name, desc, mapId, isPrivate, password, maxPlayers }) {
  let code = makeCode();
  while (rooms.has(code)) code = makeCode();
  const cleanMap = ["plaza", "beach", "arcade"].includes(mapId) ? mapId : "plaza";
  const cleanMax = ALLOWED_MAX.includes(Number(maxPlayers)) ? Number(maxPlayers) : DEFAULT_MAX;
  const priv = !!isPrivate;
  const spawn = MAP_SPAWNS[cleanMap] || MAP_SPAWNS.plaza;
  const room = {
    code,
    name: cleanStr(name, MAX_SERVER_NAME) || "Untitled server",
    desc: cleanStr(desc, MAX_SERVER_DESC),
    mapId: cleanMap,
    isPrivate: priv,
    // Passwords only apply to private servers. Public ones stay open so the
    // browser list can promise "click → you're in".
    password: priv ? cleanStr(password, MAX_PASSWORD) : "",
    maxPlayers: cleanMax,
    players: new Map(),
    ball: { x: spawn.x + 120, y: spawn.y, vx: 0, vy: 0, holder: null },
    tv: null,
    // Coins: collectible pickups (always worth 1) + per-session balances.
    coins: new Map(),
    balances: new Map(),
    tipAt: new Map(),
    // Football: pitch queue (pid-keyed) + live match (null when idle).
    footballQueue: [],
    football: null,
    // Polaroids: id -> { id, ownerName, x, y, holder, img (jpeg dataURL),
    // placedAt }. Images ride dedicated events (photo-new / photo-sync), so
    // the 15Hz room-state stays light — only metadata travels with it.
    photos: new Map(),
    createdAt: Date.now(),
    emptySince: null, // creator joins immediately
  };
  rooms.set(code, room);
  ensureCoins(room);
  broadcastServers();
  return room;
}

// Public browser entry — never leaks passwords or private servers.
function serverInfo(room) {
  return {
    code: room.code,
    name: room.name,
    desc: room.desc,
    mapId: room.mapId,
    playerCount: room.players.size,
    maxPlayers: room.maxPlayers,
    hasPassword: false, // public list is always open-join
  };
}

function publicServers(search = "") {
  const q = cleanStr(search, MAX_SERVER_NAME).toLowerCase();
  return [...rooms.values()]
    .filter((r) => !r.isPrivate)
    .filter((r) => !q || r.name.toLowerCase().includes(q))
    .sort((a, b) => b.players.size - a.players.size || b.createdAt - a.createdAt)
    .map(serverInfo);
}

function broadcastServers() {
  io.emit("servers-changed");
}

function markEmpty(room) {
  if (room.players.size === 0 && room.emptySince == null) room.emptySince = Date.now();
  else if (room.players.size > 0) room.emptySince = null;
}

// Empty servers get deleted after a bit (EMPTY_TTL_MS) instead of instantly,
// so a mass-reconnect doesn't vaporize the room everyone is rejoining.
setInterval(() => {
  let changed = false;
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.players.size === 0 && room.emptySince != null && now - room.emptySince > EMPTY_TTL_MS) {
      rooms.delete(code);
      changed = true;
    }
  }
  if (changed) broadcastServers();
}, 15000);

function roomState(room) {
  const r1 = (n) => Math.round(Number(n) * 10) / 10;
  return {
    code: room.code,
    name: room.name,
    desc: room.desc,
    maxPlayers: room.maxPlayers,
    isPrivate: !!room.isPrivate,
    mapId: room.mapId,
    // Fast path, 20Hz: positions + lightweight flags only. Avatars ride
    // one-shot events (avatars-sync / player-avatar) so the hot loop stays
    // small — clients merge them back in. Internal physics scratch (_px…)
    // is stripped, floats are rounded to 0.1px to shrink JSON.
    players: [...room.players.values()].map(({ _px, _py, _vx, _vy, avatar, ...p }) => ({
      ...p,
      x: r1(p.x), y: r1(p.y),
      z: p.z ? r1(p.z) : 0,
    })),
    ball: {
      x: r1(room.ball.x), y: r1(room.ball.y),
      vx: Math.round(room.ball.vx), vy: Math.round(room.ball.vy),
      holder: room.ball.holder || null,
    },
    tv: room.tv || null,
    // photo metadata only — the jpeg bytes travel via photo-new / photo-sync
    photos: [...room.photos.values()].map(({ img, ...p }) => p),
    coins: [...(room.coins?.values() || [])],
    balances: Object.fromEntries(room.balances || new Map()),
    footballQueue: [...(room.footballQueue || [])],
    football: fbPub(room),
  };
}

// One-shot avatar list for a newcomer (fast path strips avatars).
function avatarList(room) {
  return [...room.players.values()].map((p) => ({ id: p.id, avatar: p.avatar }));
}

// ---------- coins (always worth 1, friendly only) ----------
// Per-server balances keyed by persistent pid. Single coin value — no
// lifetime total. Every earn path awards exactly 1, no chat spam (the
// in-world +1 popup via player.coinPop is the feedback).
let coinSeq = 1;
const COIN_VALUE = 1;
const COIN_PICKUP_R = 44;
// Scarce by design: a few coins per map, +1 for every 2 people in the room.
// e.g. plaza with 1-2 players has 4 coins, with 8 players it has 7.
const COIN_BASE = { plaza: 3, beach: 3, arcade: 2 };
const COIN_RESPAWN_MS = 30000;

function coinTarget(mapId, playerCount) {
  const base = COIN_BASE[mapId] ?? 3;
  return base + Math.floor((playerCount || 0) / 2);
}

function randomCoinSpot(room) {
  const size = MAP_SIZE[room.mapId] || MAP_SIZE.plaza;
  for (let tries = 0; tries < 30; tries++) {
    const x = 60 + Math.random() * (size.w - 120);
    const y = 140 + Math.random() * (size.h - 200);
    if (isBlocked(room.mapId, x, y, 30)) continue;
    let nearPlayer = false;
    for (const p of room.players.values()) {
      if (Math.hypot(p.x - x, p.y - y) < 60) { nearPlayer = true; break; }
    }
    if (nearPlayer) continue;
    return { x: Math.round(x), y: Math.round(y) };
  }
  return null;
}

function ensureCoins(room) {
  if (!room.coins) room.coins = new Map();
  const want = coinTarget(room.mapId, room.players.size);
  // Count live coins + pending respawns (marked via _pending).
  const pending = room._coinPending || 0;
  let missing = want - (room.coins.size + pending);
  while (missing > 0) {
    const spot = randomCoinSpot(room);
    if (!spot) break;
    const id = "coin-" + (coinSeq++);
    room.coins.set(id, { id, x: spot.x, y: spot.y });
    missing--;
  }
}

// Trim excess when players leave so a full-then-empty room doesn't stay
// flooded (oldest coins go first — Map preserves insertion order).
function trimCoins(room) {
  const want = coinTarget(room.mapId, room.players.size);
  const pending = room._coinPending || 0;
  let excess = (room.coins.size + pending) - want;
  while (excess > 0 && room.coins.size > 0) {
    const oldest = room.coins.keys().next().value;
    room.coins.delete(oldest);
    excess--;
  }
}

function scheduleCoinRespawn(room) {
  room._coinPending = (room._coinPending || 0) + 1;
  setTimeout(() => {
    room._coinPending = Math.max(0, (room._coinPending || 1) - 1);
    if (!rooms.has(room.code)) return;
    ensureCoins(room);
  }, COIN_RESPAWN_MS);
}

function socketIdForTab(room, tab) {
  for (const [sid, p] of room.players) {
    if (p.tab === tab) return sid;
  }
  return null;
}

function addCoins(room, pid, amount, reason) {
  if (!room.balances) room.balances = new Map();
  const cur = room.balances.get(pid) || 0;
  const next = cur + amount;
  room.balances.set(pid, next);
  // in-world coin popup: stamp the earner's player record (rides room-state)
  for (const p of room.players.values()) {
    if (p.pid === pid && amount > 0) {
      p.coinPop = Date.now();
      p.coinPopAmt = amount;
    }
  }
  // balances are pid-keyed (shared purse across tabs) — ping first match
  let sid = null;
  for (const [id, pl] of room.players) {
    if (pl.pid === pid) { sid = id; break; }
  }
  if (sid) io.to(sid).emit("coins-changed", { balance: next, delta: amount, reason });
  return next;
}

function stepCoins(room) {
  if (!room.coins || room.coins.size === 0) return;
  for (const p of room.players.values()) {
    if (p.sitting) continue;
    for (const [id, c] of room.coins) {
      if (Math.hypot(c.x - p.x, c.y - p.y) < COIN_PICKUP_R) {
        room.coins.delete(id);
        scheduleCoinRespawn(room);
        addCoins(room, p.pid, COIN_VALUE, "found");
        io.to(room.code).emit("coin-collected", { coinId: id, by: p.id, byName: p.name });
        break; // one coin per player per tick
      }
    }
  }
}

// ---------- football (Sunny Plaza pitch minigame) ----------
// Queue on the pitch (2–8 players, even to start) → West vs East, first to
// 5. Presence is tab-keyed (two tabs = two players sharing one coin purse);
// socket ids resolve per broadcast so reconnects rejoin their team.
// No coins involved — glory only.
// Mirrors client/src/game/maps.ts PLAZA_FIELD (keep in sync).
const FIELD = { x: 1080, y: 850, w: 440, h: 240 };
const GOAL_HALF = 24;   // goal mouth half-height around the midfield line
const GOAL_DEPTH = 12;  // ball centre past the line ≈ edge on the net back
const OUT_MARGIN = 6;
const WIN_SCORE = 5;
const GOAL_SHOW_MS = 3000;
const END_SHOW_MS = 6000;
// Full-time reward (paid BY the game TO the winners — nobody loses a coin):
// every winner gets this many, not split. Only for real wins at 5 goals;
// forfeit wins pay nothing.
const FOOTBALL_WIN_COINS = 3;

function fbPayWinners(room, team) {
  const fb = room.football;
  if (!fb) return;
  const winners = team === "A" ? fb.teamA : fb.teamB;
  for (const e of winners) addCoins(room, e.pid, FOOTBALL_WIN_COINS, "won football");
  console.log(`[football] ${room.code} awarded ${FOOTBALL_WIN_COINS} coins each to ${team === "A" ? "West" : "East"} (${winners.length} players)`);
}

function fbTeamOf(room, tab) {
  const fb = room.football;
  if (!fb || !tab) return null;
  if (fb.teamA.some((e) => e.tab === tab)) return "A";
  if (fb.teamB.some((e) => e.tab === tab)) return "B";
  return null;
}

function fbInField(x, y, margin = 0) {
  return x > FIELD.x - margin && x < FIELD.x + FIELD.w + margin &&
    y > FIELD.y - margin && y < FIELD.y + FIELD.h + margin;
}

function clampToField(p) {
  // players may step into the goal boxes but not off the pitch
  p.x = Math.max(FIELD.x - 26, Math.min(FIELD.x + FIELD.w + 26, p.x));
  p.y = Math.max(FIELD.y - 8, Math.min(FIELD.y + FIELD.h + 8, p.y));
}

function fbCenterBall(room, xOff = 0) {
  const b = room.ball;
  b.holder = null;
  b.x = Math.round(FIELD.x + FIELD.w / 2 + xOff);
  b.y = Math.round(FIELD.y + FIELD.h / 2);
  b.vx = 0; b.vy = 0;
  b._lastTouchTab = null;
}

// Pitch edge rules (free ball, match in play): the ball can't leave the
// field. Touchlines and goal lines outside the mouth send it back to
// midfield with the advantage to the side that did NOT touch it last
// (A attacks east, B attacks west); the mouth plays on until the ball
// reaches the back of the net.
function fbFieldEdge(room) {
  const fb = room.football;
  if (!fb || fb.state !== "play") return;
  const b = room.ball;
  const midY = FIELD.y + FIELD.h / 2;
  const inMouth = Math.abs(b.y - midY) < GOAL_HALF;
  if (inMouth && b.x <= FIELD.x - GOAL_DEPTH) return fbGoal(room, "B");
  if (inMouth && b.x >= FIELD.x + FIELD.w + GOAL_DEPTH) return fbGoal(room, "A");
  // the mouth corridor is exempt: the ball plays on until it reaches the net
  // (without this, slow rollers get called "out" at ±6px and can never sink)
  if (!inMouth && (b.x < FIELD.x - OUT_MARGIN || b.x > FIELD.x + FIELD.w + OUT_MARGIN ||
      b.y < FIELD.y - OUT_MARGIN || b.y > FIELD.y + FIELD.h + OUT_MARGIN)) {
    const conceder = fbTeamOf(room, b._lastTouchTab);
    fbCenterBall(room, conceder === "A" ? -70 : conceder === "B" ? 70 : 0);
  }
}

function fbGoal(room, team) {
  const fb = room.football;
  if (!fb || fb.state !== "play") return;
  fb.state = "goal";
  fb.goalTeam = team;
  const scorer = [...room.players.values()].find((pl) => pl.tab === room.ball._lastTouchTab);
  fb.goalBy = scorer ? scorer.name : null;
  fb.goalAt = Date.now();
  room.ball.vx = 0; room.ball.vy = 0;
  console.log(`[football] ${room.code} GOAL ${team === "A" ? "West" : "East"}${fb.goalBy ? ` by ${fb.goalBy}` : ""} (${fb.scoreA}-${fb.scoreB} pending)`);
}

function fbRelease(room, winner) {
  const fb = room.football;
  if (!fb) return;
  fb.state = "end";
  fb.winner = winner;
  fb.endAt = Date.now();
  fb.goalTeam = null;
  fb.goalBy = null;
  console.log(`[football] ${room.code} full time: ${winner === "A" ? "West" : "East"} wins ${fb.scoreA}-${fb.scoreB}`);
}

// After any team removal during play/celebration: an emptied team loses.
function fbCheckQuit(room) {
  const fb = room.football;
  if (!fb || (fb.state !== "play" && fb.state !== "goal")) return;
  if (fb.teamA.length === 0 && fb.teamB.length === 0) room.football = null;
  else if (fb.teamA.length === 0) fbRelease(room, "B");
  else if (fb.teamB.length === 0) fbRelease(room, "A");
}

function fbRemoveTab(room, tab) {
  if (room.footballQueue) {
    room.footballQueue = room.footballQueue.filter((e) => e.tab !== tab);
  }
  const fb = room.football;
  if (fb && (fb.state === "play" || fb.state === "goal")) {
    fb.teamA = fb.teamA.filter((e) => e.tab !== tab);
    fb.teamB = fb.teamB.filter((e) => e.tab !== tab);
    fbCheckQuit(room);
  }
}

function fbPub(room) {
  const fb = room.football;
  if (!fb) return null;
  const withId = (team) => team.map((e) => ({ ...e, id: socketIdForTab(room, e.tab) }));
  return {
    state: fb.state, scoreA: fb.scoreA, scoreB: fb.scoreB,
    teamA: withId(fb.teamA), teamB: withId(fb.teamB),
    goalTeam: fb.goalTeam || null, goalBy: fb.goalBy || null, winner: fb.winner || null,
  };
}

function stepFootball(room) {
  const fb = room.football;
  if (!fb) return;
  const now = Date.now();
  if (fb.state === "goal" && now - fb.goalAt >= GOAL_SHOW_MS) {
    // announcement over — register on the counter
    if (fb.goalTeam === "A") fb.scoreA++;
    else if (fb.goalTeam === "B") fb.scoreB++;
    console.log(`[football] ${room.code} score West ${fb.scoreA} – ${fb.scoreB} East`);
    fb.goalTeam = null; fb.goalBy = null;
    if (fb.scoreA >= WIN_SCORE) { fbPayWinners(room, "A"); fbRelease(room, "A"); }
    else if (fb.scoreB >= WIN_SCORE) { fbPayWinners(room, "B"); fbRelease(room, "B"); }
    else {
      fb.state = "play";
      fbCenterBall(room);
    }
  } else if (fb.state === "end" && now - fb.endAt >= END_SHOW_MS) {
    room.football = null;
  }
  // safety net: nobody dribbles out during play/celebration
  if (fb.state === "play" || fb.state === "goal") {
    for (const p of room.players.values()) {
      if (fbTeamOf(room, p.tab)) clampToField(p);
    }
  }
}

// ---------- polaroids (shared physical photos) ----------
// A photo starts in its photographer's hands (holder), E places it, anyone
// nearby can pick it up again or open it to look. At most MAX_PHOTOS per
// room; the oldest fades away to make space.
let photoSeq = 1;
const MAX_PHOTOS = 20;
const MAX_PHOTO_BYTES = 120000; // ~256px jpeg thumbs land around 10-30KB

function cleanPhotoImg(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length < 100 || s.length > MAX_PHOTO_BYTES) return null;
  if (!s.startsWith("data:image/jpeg;base64,")) return null;
  return s;
}

function clampToMap(room, x, y) {
  const size = MAP_SIZE[room.mapId] || MAP_SIZE.plaza;
  return {
    x: Math.max(20, Math.min(size.w - 20, Number(x) || size.w / 2)),
    y: Math.max(20, Math.min(size.h - 20, Number(y) || size.h / 2)),
  };
}

function notify(room, text) {
  io.to(room.code).emit("chat-msg", { id: "system", name: "★", text, at: Date.now() });
}

// ---------- ball physics (authoritative, 20hz) ----------
// Velocity is px/sec. Players kick the ball by overlapping it — the kick
// blends the player's own velocity with a forward pop, so running into the
// ball launches it and standing still dribbles it.
// A carried ball (E to pick up, E again to throw) rides its holder instead.
// Per-map feel: the plaza football is heavier — weaker kicks, lower top
// speed, stronger roll-out and deader bounces than the beach/arcade balls.
const PLAYER_R = 16;
const TICK_DT = 0.05;
const BALL_TUNE = {
  plaza: { kick: 170, maxSpd: 380, friction: 0.06, rest: 0.45, throwSpd: 340 },
  beach: { kick: 240, maxSpd: 560, friction: 0.2, rest: 0.55, throwSpd: 460 },
  arcade: { kick: 240, maxSpd: 560, friction: 0.2, rest: 0.55, throwSpd: 460 },
};
function ballTune(mapId) {
  return BALL_TUNE[mapId] || BALL_TUNE.beach;
}

// Same circle-vs-rect resolve as the client's collide(): guarantees the
// server never keeps a player embedded in a wall, whatever the client sent
// (stale spawns, lag spikes, teleports). Runs every tick as a safety net.
function rescuePlayer(room, p) {
  // Sitters are pinned to their seat — never rescue them out of it.
  if (p.sitting && p.seatId) {
    const seat = seatById(p.seatId);
    if (seat && seat.mapId === room.mapId) {
      p.x = seat.x; p.y = seat.y; p.dir = seat.dir; p.moving = false;
      return;
    }
    p.sitting = false; p.seatId = null;
  }  const size = MAP_SIZE[room.mapId] || MAP_SIZE.plaza;
  p.x = Math.max(PLAYER_R, Math.min(size.w - PLAYER_R, p.x));
  p.y = Math.max(PLAYER_R, Math.min(size.h - PLAYER_R, p.y));
  for (const c of COLLIDERS[room.mapId] || []) {
    const cx = Math.max(c.x, Math.min(p.x, c.x + c.w));
    const cy = Math.max(c.y, Math.min(p.y, c.y + c.h));
    const dx = p.x - cx, dy = p.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= PLAYER_R * PLAYER_R) continue;
    const d = Math.sqrt(d2);
    if (d > 0.001) {
      if (Math.abs(dx) > Math.abs(dy)) p.x = dx > 0 ? c.x + c.w + PLAYER_R : c.x - PLAYER_R;
      else p.y = dy > 0 ? c.y + c.h + PLAYER_R : c.y - PLAYER_R;
    } else {
      // center buried inside the rect (stale spawn, stand-up, lag spike):
      // exit along least penetration instead of defaulting north, so you
      // can't end up behind the furniture you just stood up from.
      const l = p.x - c.x, r = c.x + c.w - p.x, tp = p.y - c.y, bt = c.y + c.h - p.y;
      const m = Math.min(l, r, tp, bt);
      if (m === l) p.x = c.x - PLAYER_R;
      else if (m === r) p.x = c.x + c.w + PLAYER_R;
      else if (m === tp) p.y = c.y - PLAYER_R;
      else p.y = c.y + c.h + PLAYER_R;
    }
  }
}

function stepBall(room, dt) {
  const b = room.ball;
  const size = MAP_SIZE[room.mapId] || MAP_SIZE.plaza;
  const BALL_R = ballRadius(room.mapId);

  // Carried ball rides overhead — same spot whatever way you face, so it
  // never hides inside your cloak. Clients render it from the holder's
  // own position (no network trail); this is the fallback everyone agrees on.
  const CARRY_DY = -32;
  if (b.holder) {
    const holder = room.players.get(b.holder);
    if (!holder || holder.sitting) {
      b.holder = null;
    } else {
      b.x = holder.x;
      b.y = holder.y + CARRY_DY;
      b.vx = 0; b.vy = 0;
      for (const p of room.players.values()) {
        p._px = p.x;
        p._py = p.y;
      }
      return;
    }
  }
  const tune = ballTune(room.mapId);
  // During a goal announcement the ball sits dead in the net.
  if (room.football && room.football.state === "goal") {
    b.vx = 0; b.vy = 0;
    for (const p of room.players.values()) {
      p._px = p.x;
      p._py = p.y;
    }
    return;
  }
  const fbLive = room.football && room.football.state === "play";
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  const f = Math.pow(tune.friction, dt); // rolling friction
  b.vx *= f;
  b.vy *= f;

  // player kicks (smoothed velocity so one laggy update can't launch it).
  // Sitters never kick — the ball can rest beside the campfire in peace.
  // During a football match only players on the pitch can kick it.
  for (const p of room.players.values()) {
    const ivx = (p.x - (p._px ?? p.x)) / dt;
    const ivy = (p.y - (p._py ?? p.y)) / dt;
    p._vx = (p._vx ?? ivx) * 0.5 + ivx * 0.5;
    p._vy = (p._vy ?? ivy) * 0.5 + ivy * 0.5;
    if (p.sitting) continue;
    if (fbLive && !fbTeamOf(room, p.tab)) continue;
    let dx = b.x - p.x;
    let dy = b.y - p.y;
    let d = Math.hypot(dx, dy);
    const minD = BALL_R + PLAYER_R;
    if (d < minD) {
      if (d < 0.001) { dx = 1; dy = 0; d = 1; }
      const nx = dx / d, ny = dy / d;
      b.x = p.x + nx * minD;
      b.y = p.y + ny * minD;
      b.vx = p._vx * 1.3 + nx * tune.kick;
      b.vy = p._vy * 1.3 + ny * tune.kick;
      b._lastTouchTab = p.tab || null;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > tune.maxSpd) {
        b.vx = (b.vx / sp) * tune.maxSpd;
        b.vy = (b.vy / sp) * tune.maxSpd;
      }
    }
  }
  for (const p of room.players.values()) {
    p._px = p.x;
    p._py = p.y;
  }

  // world bounds bounce
  const REST = tune.rest;
  if (b.x < BALL_R) { b.x = BALL_R; b.vx = Math.abs(b.vx) * REST; }
  if (b.x > size.w - BALL_R) { b.x = size.w - BALL_R; b.vx = -Math.abs(b.vx) * REST; }
  if (b.y < BALL_R) { b.y = BALL_R; b.vy = Math.abs(b.vy) * REST; }
  if (b.y > size.h - BALL_R) { b.y = size.h - BALL_R; b.vy = -Math.abs(b.vy) * REST; }

  // building bounce
  for (const c of COLLIDERS[room.mapId] || []) {
    const cx = Math.max(c.x, Math.min(b.x, c.x + c.w));
    const cy = Math.max(c.y, Math.min(b.y, c.y + c.h));
    const dx = b.x - cx, dy = b.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= BALL_R * BALL_R) continue;
    const d = Math.sqrt(d2);
    let nx, ny, push;
    if (d > 0.001) {
      nx = dx / d; ny = dy / d; push = BALL_R - d;
    } else {
      // center inside the rect: exit along least penetration
      const l = b.x - c.x, r = c.x + c.w - b.x, tp = b.y - c.y, bt = c.y + c.h - b.y;
      const m = Math.min(l, r, tp, bt);
      nx = m === l ? -1 : m === r ? 1 : 0;
      ny = m === tp ? -1 : m === bt ? 1 : 0;
      push = BALL_R;
    }
    b.x += nx * push;
    b.y += ny * push;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= (1 + REST) * vn * nx;
      b.vy -= (1 + REST) * vn * ny;
    }
  }

  // football pitch rules: the ball can't leave the field. Touchlines and
  // goal lines (outside the goal mouth) send it back to midfield with the
  // advantage to the team that did NOT touch it last; the goal mouth plays
  // on until the ball reaches the back of the net.
  if (fbLive && !b.holder) fbFieldEdge(room);

  if (Math.hypot(b.vx, b.vy) < 5) {
    b.vx = 0;
    b.vy = 0;
  }
}

setInterval(() => {
  for (const room of rooms.values()) {
    for (const p of room.players.values()) rescuePlayer(room, p);
    stepBall(room, TICK_DT);
    stepCoins(room);
    stepFootball(room);
  }
}, TICK_DT * 1000);

// broadcast fast state at 20hz (avatars stripped — see roomState)
setInterval(() => {
  for (const room of rooms.values()) {
    io.to(room.code).emit("room-state", roomState(room));
  }
}, 1000 / 20);

io.on("connection", (socket) => {
  let currentCode = null;

  // Live browser list. Client emits optionally { search } (name filter);
  // server answers that socket with "servers-list". Everyone gets a
  // "servers-changed" ping whenever the list may be stale (create / join /
  // leave / expiry) so the lobby can re-request.
  socket.on("list-servers", ({ search } = {}) => {
    try {
      socket.emit("servers-list", publicServers(typeof search === "string" ? search : ""));
    } catch (e) {
      console.error(e);
    }
  });

  function cleanPid(v) {
    const s = String(v || "").trim().slice(0, 40);
    return /^[A-Za-z0-9-]{8,40}$/.test(s) ? s : null;
  }

  function enterRoom(room, { name, color, avatar, pid, tab }) {
    if (currentCode && currentCode !== room.code) socket.leave(currentCode);
    // Re-joining the same room (reconnect): drop the stale ghost entry first.
    currentCode = room.code;
    socket.join(room.code);
    const sp = safeSpawn(room);
    const cleanColor = (typeof color === "string" && HEX.test(color)) ? color : "#ef4444";
    const cleanName = String(name || "Cloakling").slice(0, 16) || "Cloakling";
    // persistent per-browser id: same browser rejoining keeps its per-server
    // balance; a fresh browser (or old client) gets a per-socket fallback.
    // tab is a per-tab id (sessionStorage): two tabs in one browser are two
    // footballers sharing one coin purse.
    const myPid = cleanPid(pid) || socket.id;
    const myTab = cleanPid(tab) || socket.id;
    room.players.set(socket.id, {
      id: socket.id,
      pid: myPid,
      tab: myTab,
      name: cleanName,
      color: cleanColor,
      avatar: cleanAvatar(avatar, cleanColor),
      x: sp.x,
      y: sp.y,
      dir: "down",
      moving: false,
      bubble: "",
      speaking: false,
      z: 0,
      crouch: false,
      sitting: false,
      seatId: null,
      stoodAt: 0,
      satAt: 0,
      coinPop: 0,
    });
    room.emptySince = null;
    if (!room.balances) room.balances = new Map();
    if (!room.balances.has(myPid)) room.balances.set(myPid, 0);
    ensureCoins(room);
    socket.emit("joined", {
      code: room.code, id: socket.id, mapId: room.mapId,
      name: room.name, desc: room.desc,
      maxPlayers: room.maxPlayers, isPrivate: !!room.isPrivate,
    });
    // tell others a peer joined (for voice mesh)
    socket.to(room.code).emit("peer-joined", { id: socket.id });
    // avatars ride one-shot (fast room-state strips them): newcomer gets the
    // wall, everyone else gets just the new arrival
    socket.to(room.code).emit("player-avatar", {
      id: socket.id, avatar: room.players.get(socket.id)?.avatar,
    });
    socket.emit("avatars-sync", avatarList(room));
    // send existing peers to newcomer
    const peers = [...room.players.keys()].filter((id) => id !== socket.id);
    socket.emit("peers", { peers });
    // polaroid wall: newcomer gets every photo's bytes once (room-state only
    // carries metadata at 15Hz, so the jpeg wall stays light)
    socket.emit("photo-sync", [...room.photos.values()]);
    notify(room, `${cleanName} joined the room`);
    broadcastServers();
  }

  socket.on("join", ({ code, name, color, avatar, pid, tab, password } = {}) => {
    try {
      const room = findRoom(code);
      if (!room) {
        socket.emit("join-error", { msg: "No server found with that code. Check it and try again." });
        return;
      }
      // same browser rejoining (same pid) is always allowed back in
      const rejoining = typeof pid === "string" && [...room.players.values()].some((p) => p.pid === pid);
      if (room.players.size >= room.maxPlayers && !room.players.has(socket.id) && !rejoining) {
        socket.emit("join-error", { msg: "That server is full. Try another one." });
        return;
      }
      if (room.password && room.password !== cleanStr(password, MAX_PASSWORD)) {
        socket.emit("join-error", {
          msg: room.password && cleanStr(password, MAX_PASSWORD) ? "Wrong password for that server." : "That server needs a password.",
          needPassword: true, code: room.code,
        });
        return;
      }
      enterRoom(room, { name, color, avatar, pid, tab });
    } catch (e) {
      console.error(e);
    }
  });

  socket.on("create-server", ({ server, name, color, avatar, pid, tab } = {}) => {
    try {
      const room = createServerRoom({
        name: server?.name,
        desc: server?.desc,
        mapId: server?.mapId,
        isPrivate: server?.isPrivate,
        password: server?.password,
        maxPlayers: server?.maxPlayers,
      });
      enterRoom(room, { name, color, avatar, pid, tab });
    } catch (e) {
      console.error(e);
    }
  });

  // Back-compat for older clients still emitting "create-room": treat it as
  // creating a private server with default settings.
  socket.on("create-room", ({ name, color, avatar, pid, tab, mapId }) => {
    try {
      const room = createServerRoom({ mapId, isPrivate: true });
      enterRoom(room, { name, color, avatar, pid, tab });
    } catch (e) {
      console.error(e);
    }
  });

  socket.on("move", ({ x, y, dir, moving, z, crouch }) => {
    if (!currentCode) return;
    const room = rooms.get(currentCode);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    // Sitters stay pinned — movement packets can't drag them off the bench.
    // (Pushing a direction stands you up instead — same as E. Fresh sits get
    // a grace window so walking into the seat doesn't bounce you straight
    // back out.)
    if (p.sitting) {
      if (moving && !(p.satAt && Date.now() - p.satAt < 400)) {
        standUp(p);
        return;
      }
      const seat = p.seatId ? seatById(p.seatId) : null;
      if (seat) {
        p.x = seat.x; p.y = seat.y; p.dir = seat.dir;
      }
      p.moving = false;
      p.z = 0;
      p.crouch = false;
      return;
    }
    // Fresh stand grace (500ms > the 300ms stand-glide + state round-trips):
    // the client's first packets after standing still carry the old seat
    // spot — only position is held, facing/moving/jump/crouch stay live.
    const freshStand = p.stoodAt && Date.now() - p.stoodAt < 500;
    const size = MAP_SIZE[room.mapId] || MAP_SIZE.plaza;
    if (!freshStand) {
      p.x = Math.max(0, Math.min(size.w, Number(x) || p.x));
      p.y = Math.max(0, Math.min(size.h, Number(y) || p.y));
      // footballers stay on the pitch while the match is live
      const mfb = room.football;
      if (mfb && (mfb.state === "play" || mfb.state === "goal") && fbTeamOf(room, p.tab)) {
        clampToField(p);
      }
    }
    p.dir = dir || p.dir;
    p.moving = !!moving;
    const zz = Number(z);
    p.z = Number.isFinite(zz) ? Math.max(0, Math.min(100, zz)) : 0;
    p.crouch = !!crouch;
  });

  socket.on("switch-map", () => {
    // Map switching inside a room is disabled: the world is picked on the
    // lobby screen and stays fixed so everyone shares the same map.
  });

  // ---------- sitting (E on couches / logs / benches, E again to stand) ----------
  socket.on("sit", ({ seatId }) => {
    if (!currentCode || typeof seatId !== "string") return;
    const room = rooms.get(currentCode);
    const p = room?.players.get(socket.id);
    if (!p || p.sitting) return;
    const seat = seatById(seatId);
    if (!seat || seat.mapId !== room.mapId) return;
    // close enough to plop down?
    if (Math.hypot(p.x - seat.x, p.y - seat.y) > 85) return;
    // one butt per seat
    for (const q of room.players.values()) {
      if (q.seatId === seatId && q.sitting) return;
    }
    // can't drag the ball onto the furniture — drop it at your feet
    if (room.ball.holder === socket.id) {
      room.ball.holder = null;
      room.ball.x = p.x;
      room.ball.y = p.y + 10;
      room.ball.vx = 0;
      room.ball.vy = 0;
    }
    p.sitting = true;
    p.seatId = seatId;
    p.satAt = Date.now();
    p.x = seat.x; p.y = seat.y; p.dir = seat.dir;
    p.moving = false; p.z = 0; p.crouch = false;
  });

// Hop a sitter off toward their seat's stand side, clear of the furniture —
// benches land you on the path, the couch in the open room, logs on the
// sand below (they face the fire but you hop off behind you).
function standUp(p) {
  const seat = p.seatId ? seatById(p.seatId) : null;
  const sdir = (seat && (seat.stand || seat.dir)) || "down";
  const dv = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[sdir] || [0, 1];
  p.sitting = false;
  p.seatId = null;
  p.x = (seat ? seat.x : p.x) + dv[0] * 60;
  p.y = (seat ? seat.y : p.y) + dv[1] * 60;
  p._px = p.x; p._py = p.y;
  // grace window: the client's next few move packets still carry the old
  // seat position (state is 15hz) — believing them would yank you straight
  // back into the furniture you just left
  p.stoodAt = Date.now();
  p.moving = false; p.z = 0; p.crouch = false;
}

  socket.on("stand", () => {
    if (!currentCode) return;
    const room = rooms.get(currentCode);
    const p = room?.players.get(socket.id);
    if (!p || !p.sitting) return;
    standUp(p);
  });

  // ---------- ball pickup / throw (E near the ball, E again to launch) ----------
  socket.on("ball-pickup", () => {
    if (!currentCode) return;
    const room = rooms.get(currentCode);
    const p = room?.players.get(socket.id);
    if (!p || p.sitting || room.ball.holder) return;
    // during a football match only players on the pitch can hold the ball
    const mfb = room.football;
    if (mfb && (mfb.state === "play" || mfb.state === "goal") && !fbTeamOf(room, p.tab)) return;
    if (Math.hypot(room.ball.x - p.x, room.ball.y - p.y) > 60) return;
    room.ball.holder = socket.id;
    room.ball.vx = 0;
    room.ball.vy = 0;
  });

  socket.on("ball-throw", ({ dx, dy }) => {
    if (!currentCode) return;
    const room = rooms.get(currentCode);
    const p = room?.players.get(socket.id);
    if (!p || room.ball.holder !== socket.id) return;
    let vx = Number(dx), vy = Number(dy);
    if (!Number.isFinite(vx) || !Number.isFinite(vy)) { vx = 0; vy = 1; }
    if (Math.hypot(vx, vy) < 0.01) {
      // idle: throw where you're facing
      const dirs = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
      [vx, vy] = dirs[p.dir] || [0, 1];
    }
    const len = Math.hypot(vx, vy) || 1;
    const tune = ballTune(room.mapId);
    room.ball.holder = null;
    room.ball.x = p.x + (vx / len) * 24;
    room.ball.y = p.y + (vy / len) * 24;
    room.ball.vx = (vx / len) * tune.throwSpd + (p._vx || 0) * 0.4;
    room.ball.vy = (vy / len) * tune.throwSpd + (p._vy || 0) * 0.4;
    room.ball._lastTouchTab = p.tab || null;
    const sp = Math.hypot(room.ball.vx, room.ball.vy);
    if (sp > tune.maxSpd) {
      room.ball.vx = (room.ball.vx / sp) * tune.maxSpd;
      room.ball.vy = (room.ball.vy / sp) * tune.maxSpd;
    }
  });

// ---------- polaroids (shared physical photos) ----------
  // take: fresh shot from the camera, starts in your hands (E sets it down).
  socket.on("photo-take", ({ x, y, img, caption } = {}) => {
    if (!currentCode) return;
    const room = rooms.get(currentCode);
    const p = room?.players.get(socket.id);
    if (!p) return;
    const clean = cleanPhotoImg(img);
    if (!clean) return;
    // one wall of memories per room — the oldest fades to make space
    if (room.photos.size >= MAX_PHOTOS) {
      let oldest = null;
      for (const ph of room.photos.values()) {
        if (!oldest || ph.placedAt < oldest.placedAt) oldest = ph;
      }
      if (oldest) room.photos.delete(oldest.id);
    }
    const at = clampToMap(room, x ?? p.x, y ?? p.y);
    const photo = {
      id: "pic-" + (photoSeq++),
      ownerName: p.name,
      caption: cleanStr(caption, 24) || "Cloak Town",
      x: at.x, y: at.y,
      holder: socket.id, // in your hands — E sets it down
      img: clean,
      placedAt: Date.now(),
    };
    room.photos.set(photo.id, photo);
    io.to(room.code).emit("photo-new", photo);
  });

  // pickup: grab a loose photo nearby to carry it around.
  socket.on("photo-pickup", ({ id } = {}) => {
    if (!currentCode || typeof id !== "string") return;
    const room = rooms.get(currentCode);
    const p = room?.players.get(socket.id);
    const photo = room?.photos.get(id);
    if (!p || !photo || photo.holder) return;
    if (Math.hypot(photo.x - p.x, photo.y - p.y) > 80) return;
    photo.holder = socket.id;
  });

  // drop: set the carried photo down where you stand.
  socket.on("photo-drop", ({ x, y } = {}) => {
    if (!currentCode) return;
    const room = rooms.get(currentCode);
    const p = room?.players.get(socket.id);
    const photo = [...(room?.photos.values() || [])].find((ph) => ph.holder === socket.id);
    if (!p || !photo) return;
    const at = clampToMap(room, x ?? p.x, y ?? p.y);
    photo.holder = null;
    photo.x = at.x;
    photo.y = at.y;
  });

  // ---------- cozy TV (arcade loft: paste a link, watch together) ----------
  // The room holds one shared program: url + playhead. Anyone can DJ
  // (play/pause/restart/stop); starting one requires standing at the TV.
  const TV_SPOT = { x: 210, y: 505 };
  function tvPos(tv) {
    if (!tv) return 0;
    return tv.playing ? tv.position + (Date.now() - tv.updatedAt) / 1000 : tv.position;
  }
  socket.on("tv-play", ({ url }) => {
    if (!currentCode) return;
    const room = rooms.get(currentCode);
    const p = room?.players.get(socket.id);
    if (!p || room.mapId !== "arcade") return;
    const clean = String(url || "").trim().slice(0, 500);
    if (!clean) return;
    // couch potatoes DJ from their seats; everyone else queues at the set
    const onCouch = !!p.sitting && typeof p.seatId === "string" && p.seatId.indexOf("arcade-couch") === 0;
    if (!onCouch) {
      if (p.sitting) return;
      if (Math.hypot(p.x - TV_SPOT.x, p.y - TV_SPOT.y) > 70) return;
    }
    room.tv = { url: clean, playing: true, position: 0, updatedAt: Date.now(), by: p.name };
    io.to(room.code).emit("tv-state", room.tv);
  });
  // Touch-ups carry the playhead forward first so pause/seek never rewind it.
  const tvTouch = (fn) => {
    if (!currentCode) return;
    const room = rooms.get(currentCode);
    const tv = room?.tv;
    if (!room || !tv) return;
    fn(room, tv);
    io.to(room.code).emit("tv-state", room.tv);
  };
  socket.on("tv-pause", () => tvTouch((room, tv) => {
    tv.position = tvPos(tv); tv.playing = false; tv.updatedAt = Date.now();
  }));
  socket.on("tv-resume", () => tvTouch((room, tv) => {
    tv.position = tvPos(tv); tv.playing = true; tv.updatedAt = Date.now();
  }));
  socket.on("tv-restart", () => tvTouch((room, tv) => {
    tv.position = 0; tv.playing = true; tv.updatedAt = Date.now();
  }));
  socket.on("tv-seek", ({ position }) => tvTouch((room, tv) => {
    const p = Number(position);
    tv.position = Number.isFinite(p) ? Math.max(0, p) : tvPos(tv);
    tv.updatedAt = Date.now();
  }));
  socket.on("tv-stop", () => {
    if (!currentCode) return;
    const room = rooms.get(currentCode);
    if (!room || !room.tv) return;
    room.tv = null;
    io.to(room.code).emit("tv-state", null);
  });

  socket.on("chat", ({ text }) => {    if (!currentCode) return;
    const room = rooms.get(currentCode);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    const clean = String(text || "").slice(0, 140);
    if (!clean) return;
    p.bubble = clean;
    p.bubbleAt = Date.now();
    io.to(room.code).emit("chat-msg", { id: socket.id, name: p.name, text: clean, at: Date.now() });
    setTimeout(() => { if (p.bubble === clean) p.bubble = ""; }, 6000);
  });

  socket.on("emote", ({ id }) => {
    if (!currentCode) return;
    const room = rooms.get(currentCode);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    if (!EMOTES.includes(id)) return;
    const now = Date.now();
    if (now - (p.emoteAt || 0) < 500) return; // anti-spam
    p.emote = id;
    p.emoteAt = now;
  });

  socket.on("speaking", ({ speaking }) => {
    if (!currentCode) return;
    const room = rooms.get(currentCode);
    const p = room?.players.get(socket.id);
    if (p) p.speaking = !!speaking;
  });

  // ---------- minigames (server-arbitrated, 1v1) ----------
  // Invite: A → server → B. Accept: server creates a game, X (inviter)
  // moves first. Moves are validated here; finished boards linger 90s
  // for rematches (clients hold the result).
  socket.on("game-invite", ({ to, kind }) => {
    if (!currentCode) return;
    if (typeof kind !== "string" || !GAME_KINDS.includes(kind)) return;
    const room = rooms.get(currentCode);
    if (!room || typeof to !== "string" || to === socket.id) return;
    const me = room.players.get(socket.id);
    const other = room.players.get(to);
    if (!me || !other) return;
    if (gameBusy(socket.id)) {
      socket.emit("game-error", { msg: "You are already in a game." });
      return;
    }
    if (gameBusy(to)) {
      socket.emit("game-error", { msg: `${other.name} is already in a game.` });
      return;
    }
    gameInvites.set(to, { from: socket.id, kind });
    io.to(to).emit("game-invite", { from: socket.id, fromName: me.name, kind });
    // stale invites die quietly after 25s (both sides are told)
    setTimeout(() => {
      const pend = gameInvites.get(to);
      if (pend && pend.from === socket.id) {
        gameInvites.delete(to);
        socket.emit("game-expired", { to });
        io.to(to).emit("game-withdrawn", { from: socket.id });
      }
    }, 25000);
  });

  socket.on("game-cancel", () => {
    for (const [to, pend] of gameInvites) {
      if (pend.from === socket.id) {
        gameInvites.delete(to);
        io.to(to).emit("game-withdrawn", { from: socket.id });
      }
    }
  });

  socket.on("game-respond", ({ accept }) => {
    const pend = gameInvites.get(socket.id);
    if (!pend) return;
    gameInvites.delete(socket.id);
    const inviter = pend.from;
    if (!accept) {
      io.to(inviter).emit("game-declined", { by: socket.id });
      return;
    }
    if (!currentCode) {
      io.to(inviter).emit("game-error", { msg: "They left the room." });
      return;
    }
    const room = rooms.get(currentCode);
    const me = room?.players.get(socket.id);
    const host = room?.players.get(inviter);
    if (!me || !host) {
      io.to(inviter).emit("game-error", { msg: "They left the room." });
      return;
    }
    if (gameBusy(socket.id) || gameBusy(inviter)) {
      io.to(inviter).emit("game-error", { msg: "Someone is already in a game." });
      return;
    }
    const game = makeGame(pend.kind, room.code, inviter, socket.id, host.name, me.name);
    games.set(game.id, game);
    const pub = gamePub(game);
    io.to(inviter).emit("game-start", pub);
    io.to(socket.id).emit("game-start", pub);
  });

  socket.on("game-move", ({ gameId, ...move }) => {
    const game = games.get(gameId);
    if (!game) return;
    const wasPlay = game.status === "play";
    if (!applyMove(game, socket.id, move)) return;
    const pub = gamePub(game);
    io.to(game.x).emit("game-state", pub);
    io.to(game.o).emit("game-state", pub);
    // finished boards linger for rematches instead of vanishing instantly.
    // Every finished game pays exactly 1 coin: winner takes it, draws share it.
    if (wasPlay && game.status !== "play") {
      scheduleGameExpiry(gameId);
      const room = rooms.get(game.room);
      if (room) {
        const xPid = room.players.get(game.x)?.pid;
        const oPid = room.players.get(game.o)?.pid;
        if (game.status === "xwin" && xPid) addCoins(room, xPid, 1, `won ${game.kind}`);
        else if (game.status === "owin" && oPid) addCoins(room, oPid, 1, `won ${game.kind}`);
        else if (game.status === "draw") {
          if (xPid) addCoins(room, xPid, 1, `drew ${game.kind}`);
          if (oPid) addCoins(room, oPid, 1, `drew ${game.kind}`);
        }
      }
    }
  });

  // Friendly tipping only: send exactly 1 coin to someone in the same room.
  // No stealing, no debt, no custom amounts for now. No chat spam — the
  // receiver's in-world +1 popup is the feedback.
  socket.on("tip-send", ({ to } = {}) => {
    if (!currentCode || typeof to !== "string" || to === socket.id) return;
    const room = rooms.get(currentCode);
    if (!room) return;
    const me = room.players.get(socket.id);
    const other = room.players.get(to);
    if (!me || !other || !me.pid || !other.pid || me.pid === other.pid) return;
    const now = Date.now();
    if (now - (room.tipAt.get(me.pid) || 0) < 1000) return; // anti-spam
    room.tipAt.set(me.pid, now);
    const mine = room.balances.get(me.pid) || 0;
    if (mine < 1) {
      socket.emit("tip-error", { msg: "You need at least 1 coin to tip. Grab a coin first!" });
      return;
    }
    room.balances.set(me.pid, mine - 1);
    const theirs = (room.balances.get(other.pid) || 0) + 1;
    room.balances.set(other.pid, theirs);
    other.coinPop = Date.now();
    io.to(socket.id).emit("coins-changed", { balance: mine - 1, delta: -1, reason: `tipped ${other.name}` });
    io.to(to).emit("coins-changed", { balance: theirs, delta: 1, reason: `tipped by ${me.name}` });
    io.to(to).emit("tip-received", { from: socket.id, fromName: me.name });
  });

  // ---------- football queue + match ----------
  // Join from the pitch, wait in the list (leave any time), start with an
  // even 2–8. West defends west, East defends east, first to 5 wins.
  socket.on("football-join", () => {
    if (!currentCode) return;
    const room = rooms.get(currentCode);
    const p = room?.players.get(socket.id);
    if (!room || !p || !p.tab) return;
    if (room.mapId !== "plaza") {
      socket.emit("fb-error", { msg: "Football lives in Sunny Plaza." });
      return;
    }
    if (room.football) {
      socket.emit("fb-error", { msg: "A match is already on — wait for the next one." });
      return;
    }
    if (!room.footballQueue) room.footballQueue = [];
    if (room.footballQueue.some((e) => e.tab === p.tab)) return; // already queued
    if (room.footballQueue.length >= 8) {
      socket.emit("fb-error", { msg: "The queue is full (8)." });
      return;
    }
    if (!fbInField(p.x, p.y, 60)) {
      socket.emit("fb-error", { msg: "Stand on the football pitch to join." });
      return;
    }
    room.footballQueue.push({ pid: p.pid, tab: p.tab, name: p.name });
  });

  socket.on("football-leave", () => {
    if (!currentCode) return;
    const room = rooms.get(currentCode);
    const p = room?.players.get(socket.id);
    if (!room || !p || !p.tab) return;
    room.footballQueue = (room.footballQueue || []).filter((e) => e.tab !== p.tab);
  });

  socket.on("football-start", () => {
    if (!currentCode) return;
    const room = rooms.get(currentCode);
    const p = room?.players.get(socket.id);
    if (!room || !p || !p.tab) return;
    if (room.mapId !== "plaza" || room.football) return;
    // only queued players can start, with an even 2–8 lineup of people
    // actually still in the room
    const present = new Set([...room.players.values()].map((q) => q.tab));
    const lineup = (room.footballQueue || []).filter((e) => present.has(e.tab));
    room.footballQueue = lineup;
    if (!lineup.some((e) => e.tab === p.tab)) {
      socket.emit("fb-error", { msg: "Join the queue first." });
      return;
    }
    if (lineup.length < 2 || lineup.length > 8 || lineup.length % 2 !== 0) {
      socket.emit("fb-error", { msg: `Need an even 2–8 to start (now ${lineup.length}).` });
      return;
    }
    const teamA = lineup.filter((_, i) => i % 2 === 0).map((e) => ({ pid: e.pid, tab: e.tab, name: e.name }));
    const teamB = lineup.filter((_, i) => i % 2 === 1).map((e) => ({ pid: e.pid, tab: e.tab, name: e.name }));
    room.football = {
      state: "play", teamA, teamB, scoreA: 0, scoreB: 0,
      goalTeam: null, goalBy: null, goalAt: 0, winner: null, endAt: 0,
    };
    room.footballQueue = [];
    // predetermined spots: West holds the west half, East the east half.
    // warp stamps make clients snap exactly (their >400px rule would miss
    // short hops across the pitch).
    const now0 = Date.now();
    const place = (team, left) => {
      team.forEach((e, i) => {
        const sid = socketIdForTab(room, e.tab);
        const pl = sid ? room.players.get(sid) : null;
        if (!pl) return;
        pl.sitting = false; pl.seatId = null;
        pl.x = Math.round(FIELD.x + FIELD.w * (left ? 0.25 : 0.75));
        pl.y = Math.round(FIELD.y + FIELD.h / 2 + (i - (team.length - 1) / 2) * 55);
        pl._px = pl.x; pl._py = pl.y; pl._vx = 0; pl._vy = 0;
        pl.z = 0; pl.crouch = false; pl.moving = false;
        pl.dir = left ? "right" : "left";
        clampToField(pl);
        pl.warp = now0;
      });
    };
    place(teamA, true);
    place(teamB, false);
    fbCenterBall(room);
    console.log(`[football] ${room.code} kickoff: West(${teamA.map((e) => e.name).join(",")}) vs East(${teamB.map((e) => e.name).join(",")})`);
  });

  socket.on("football-quit", () => {
    if (!currentCode) return;
    const room = rooms.get(currentCode);
    const p = room?.players.get(socket.id);
    if (!room || !p || !p.tab || !room.football) return;
    fbRemoveTab(room, p.tab);
  });

  // Rematch: queue on a finished board. If the other side already queued,
  // a fresh same-kind game starts (sides swapped); if they already left
  // the board, it degrades to a normal invite; otherwise they get an offer.
  socket.on("game-rematch", ({ gameId }) => {
    const game = games.get(gameId);
    if (!game || game.status === "play") return;
    if (socket.id !== game.x && socket.id !== game.o) return;
    const mine = socket.id === game.x ? "x" : "o";
    const theirs = mine === "x" ? "o" : "x";
    if (!game.seats[mine]) return;
    const other = socket.id === game.x ? game.o : game.x;
    if (game.rematch && game.rematch !== socket.id) {
      const ng = makeGame(game.kind, game.room, game.o, game.x, game.oName, game.xName);
      games.delete(gameId);
      games.set(ng.id, ng);
      const pub = gamePub(ng);
      io.to(ng.x).emit("game-start", pub);
      io.to(ng.o).emit("game-start", pub);
      return;
    }
    if (game.rematch === socket.id) return; // already queued
    if (!game.seats[theirs]) {
      // opponent already went back — fall back to a plain invite
      gameInvites.set(other, { from: socket.id, kind: game.kind });
      io.to(other).emit("game-invite", { from: socket.id, fromName: gameSeatName(game, socket.id), kind: game.kind });
      io.to(socket.id).emit("game-rematch-converted", { gameId, other, kind: game.kind });
      return;
    }
    game.rematch = socket.id;
    io.to(other).emit("game-rematch-offer", { gameId, from: socket.id, fromName: gameSeatName(game, socket.id) });
  });

  socket.on("game-rematch-cancel", ({ gameId }) => {
    const game = games.get(gameId);
    if (!game || game.rematch !== socket.id) return;
    game.rematch = null;
    const other = socket.id === game.x ? game.o : game.x;
    io.to(other).emit("game-rematch-withdrawn", { gameId });
  });

  // Closing a finished board (the arrow). Mid-game quits still use game-quit.
  socket.on("game-dismiss", ({ gameId }) => {
    const game = games.get(gameId);
    if (!game || game.status === "play") return;
    if (socket.id !== game.x && socket.id !== game.o) return;
    const mine = socket.id === game.x ? "x" : "o";
    game.seats[mine] = false;
    const other = socket.id === game.x ? game.o : game.x;
    if (game.rematch === socket.id) {
      game.rematch = null;
      io.to(other).emit("game-rematch-withdrawn", { gameId });
    } else if (game.rematch === other) {
      game.rematch = null;
      io.to(other).emit("game-rematch-declined", { gameId });
    }
    if (!game.seats.x && !game.seats.o) games.delete(gameId);
  });

  // Quit mid-game: no result for anyone, the opponent is told why it ended.
  socket.on("game-quit", ({ gameId }) => {
    const game = games.get(gameId);
    if (!game) return;
    const other = socket.id === game.x ? game.o : socket.id === game.o ? game.x : null;
    if (!other) return;
    games.delete(gameId);
    io.to(other).emit("game-end", { gameId, reason: "quit" });
  });

  // --- WebRTC signaling relay (voice mesh) ---
  socket.on("voice-offer", ({ to, offer }) => io.to(to).emit("voice-offer", { from: socket.id, offer }));
  socket.on("voice-answer", ({ to, answer }) => io.to(to).emit("voice-answer", { from: socket.id, answer }));
  socket.on("voice-ice", ({ to, candidate }) => io.to(to).emit("voice-ice", { from: socket.id, candidate }));
  // Clean-slate mesh restart: re-send the peer list and re-announce.
  socket.on("voice-hello", () => {
    if (!currentCode) return;
    const room = rooms.get(currentCode);
    if (!room) return;
    socket.emit("peers", { peers: [...room.players.keys()].filter((id) => id !== socket.id) });
    socket.to(room.code).emit("peer-joined", { id: socket.id });
  });

  socket.on("disconnect", () => {
    gameCleanup(socket.id);
    leaveCurrentRoom();
  });

  function leaveCurrentRoom(announce = true) {
    if (!currentCode) return;
    const room = rooms.get(currentCode);
    if (room) {
      const leaving = room.players.get(socket.id);
      const name = leaving?.name || "Someone";
      // dropping the ball at your feet when you leave with it
      if (room.ball.holder === socket.id) {
        room.ball.holder = null;
        if (leaving) {
          room.ball.x = leaving.x;
          room.ball.y = leaving.y + 10;
        }
        room.ball.vx = 0;
        room.ball.vy = 0;
      }
      // polaroids slip out of your hands onto the ground (they stay in the
      // room for everyone else — only the grip is released)
      for (const ph of room.photos.values()) {
        if (ph.holder === socket.id) {
          ph.holder = null;
          if (leaving) {
            const at = clampToMap(room, leaving.x, leaving.y + 10);
            ph.x = at.x;
            ph.y = at.y;
          }
        }
      }
      // balances stay: same browser rejoining keeps its per-server coins.
      // They vanish with the room when the empty-room sweeper deletes it.
      // football queue + team spots are freed (an emptied team loses).
      if (leaving?.tab) fbRemoveTab(room, leaving.tab);
      room.players.delete(socket.id);
      trimCoins(room);
      socket.to(room.code).emit("peer-left", { id: socket.id });
      if (announce && room.players.size > 0) notify(room, `${name} left the room`);
      // lingering programs die with their audience
      if (room.players.size === 0) room.tv = null;
      // empty servers linger for EMPTY_TTL_MS (sweeper deletes them) instead
      // of vanishing instantly — the browser keeps showing 0/x briefly
      markEmpty(room);
      broadcastServers();
    }
    socket.leave(currentCode);
    currentCode = null;
  }

  // Back-to-menu: leave the room but stay connected so the user can join another.
  socket.on("leave", () => {
    gameCleanup(socket.id);
    leaveCurrentRoom();
    socket.emit("left");
  });
});

server.listen(PORT, () => console.log(`cloak-town on :${PORT} (open http://localhost:${PORT} for the game)`));

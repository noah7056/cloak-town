export type Collider = { x: number; y: number; w: number; h: number };
export type MapDef = {
  id: string;
  name: string;
  desc: string;
  width: number;
  height: number;
  colliders: Collider[];
};

// Single source of truth: every collider MUST have a matching visual
// drawn in engine.ts drawMap(). Trees / trunks / rocks included.
const TREES: [number, number][] = [
  [500, 300], [980, 360], [350, 700], [1250, 700], [600, 950], [1000, 950],
];
const PALMS: [number, number][] = [[400, 400], [1150, 500], [700, 300]];

function treeColliders(): Collider[] {
  return TREES.map(([tx, ty]) => ({ x: tx - 10, y: ty - 6, w: 20, h: 28 }));
}

function palmColliders(): Collider[] {
  return PALMS.map(([tx, ty]) => ({ x: tx - 8, y: ty, w: 16, h: 40 }));
}

export const TREES_POS = TREES;
export const PALMS_POS = PALMS;

// ---- Beach water: two levels. Sand above BEACH_WATER_Y, walkable shallow
// wading down to BEACH_DEEP_Y (slowed, splashes), then dark deep water —
// stepping in there dunks you and pops you back to your last dry spot.
export const BEACH_WATER_Y = 900;
export const BEACH_DEEP_Y = 1080;
export type BeachZone = "sand" | "shallow" | "deep";
export function beachZone(y: number): BeachZone {
  if (y < BEACH_WATER_Y) return "sand";
  if (y < BEACH_DEEP_Y) return "shallow";
  return "deep";
}

// Simple football pitch in the sunny plaza (walkable ground — no colliders,
// so the ball rolls free; a proper football minigame comes later).
export const PLAZA_FIELD = { x: 1080, y: 850, w: 440, h: 240 };

// Fountain coin toss (Sunny Plaza): E within radius tosses 1 coin from your
// balance — it arcs in from your hands and splashes. The server mirrors
// these numbers for validation (keep in sync).
export const FOUNTAIN_SPOT = { x: 800, y: 550 };
export const FOUNTAIN_RADIUS = 130;

// ---- Toy-car race track (replaces the old HUT cabin, bottom-left) ----
// Lighter-grass arena, about the size of the football field, holding an
// oval loop wide enough for three cars side by side. Cars are confined to
// the arena rect + kept out of the middle by a tire wall (car-only
// colliders — players walk everywhere freely). The loop is an ellipse
// ring: inside the outer ellipse but outside the inner one = black track
// (fast), otherwise arena grass (slow).
export const RACE_AREA = { x: 60, y: 830, w: 480, h: 270 };
export const RACE_COLORS = ["#d95f4b", "#3b82f6", "#4c9a52"];
export const RACE_TRACK = {
  cx: 300, cy: 965,
  outRx: 210, outRy: 105,
  inRx: 128, inRy: 42,
};
export function raceOnTrack(x: number, y: number): boolean {
  const dx = x - RACE_TRACK.cx, dy = y - RACE_TRACK.cy;
  const eOut = (dx / RACE_TRACK.outRx) ** 2 + (dy / RACE_TRACK.outRy) ** 2;
  if (eOut > 1) return false;
  const eIn = (dx / RACE_TRACK.inRx) ** 2 + (dy / RACE_TRACK.inRy) ** 2;
  return eIn >= 1;
}
// Start/finish at the south straight, heading east (counterclockwise lap).
// Three cars abreast across the track width.
export const RACE_STARTS = [
  { x: 272, y: 1052, angle: 0 },
  { x: 300, y: 1058, angle: 0 },
  { x: 328, y: 1052, angle: 0 },
];
// Joystick pickups parked just south of the arena.
export const RACE_STICKS = [
  { x: 210, y: 1128 },
  { x: 300, y: 1134 },
  { x: 390, y: 1128 },
];

// ---- Social deck (replaces the old SHOP cabin, north-east) ----
// Big open wooden platform, walkable everywhere. Stairs on the south side
// (walkable gap), hedges on the other three sides + south flanks. Four
// small square wooden tables (60x60, smaller than the café's 110x70 rounds)
// in a 2x2 square, each with a chair left + right. Tables in the north half
// so there's open standing room + stairs clearance in the south half.
export const DECK = { x: 1060, y: 100, w: 440, h: 320 };
// Stairs: walkable gap in the south hedge, centered on the deck.
export const DECK_STAIRS = { x: 1235, y: 396, w: 90, h: 30 };
export const DECK_TABLES: { x: number; y: number; w: number; h: number }[] = [
  { x: 1150, y: 145, w: 60, h: 60 },
  { x: 1350, y: 145, w: 60, h: 60 },
  { x: 1150, y: 275, w: 60, h: 60 },
  { x: 1350, y: 275, w: 60, h: 60 },
];
// Chair spots (visual + seat anchor): left + right of each table, facing it.
export const DECK_CHAIRS: { x: number; y: number }[] = [
  { x: 1126, y: 175 }, { x: 1234, y: 175 },
  { x: 1326, y: 175 }, { x: 1434, y: 175 },
  { x: 1126, y: 305 }, { x: 1234, y: 305 },
  { x: 1326, y: 305 }, { x: 1434, y: 305 },
];

function deckHedgeColliders(): Collider[] {
  return [
    // north hedge (sits on the deck's top edge)
    { x: DECK.x - 12, y: DECK.y - 12, w: DECK.w + 24, h: 24 },
    // west + east hedges
    { x: DECK.x - 12, y: DECK.y + 12, w: 24, h: DECK.h - 12 },
    { x: DECK.x + DECK.w - 12, y: DECK.y + 12, w: 24, h: DECK.h - 12 },
    // south hedge, split for the stairs gap (DECK_STAIRS.x .. +w)
    { x: DECK.x - 12, y: DECK.y + DECK.h - 24, w: DECK_STAIRS.x - (DECK.x - 12), h: 24 },
    {
      x: DECK_STAIRS.x + DECK_STAIRS.w,
      y: DECK.y + DECK.h - 24,
      w: (DECK.x + DECK.w + 12) - (DECK_STAIRS.x + DECK_STAIRS.w),
      h: 24,
    },
  ];
}

function deckTableColliders(): Collider[] {
  return DECK_TABLES.map((t) => ({ ...t }));
}

function lampColliders(): Collider[] {
  return [[640, 640], [960, 640]].map(([lx, ly]) => ({ x: lx - 8, y: ly - 54, w: 16, h: 56 }));
}

// Wooden park benches in the plaza (also drawn in engine.ts drawMap).
// Two benches, horizontal, just north of the middle path (facing it, south).
// Each bench is 110x36.
export const BENCHES: { x: number; y: number; w: number; h: number }[] = [
  { x: 460, y: 508, w: 110, h: 36 },
  { x: 1030, y: 508, w: 110, h: 36 },
];

function benchColliders(): Collider[] {
  return BENCHES.map((b) => ({ ...b }));
}

// Spectator stands above the football pitch (normal bench size, 2 seats
// each, facing the game). Kept clear of the corners (goal boxes) and of the
// middle, where the floating scoreboard sits during a match.
export const PLAZA_STANDS: { x: number; y: number; w: number; h: number }[] = [
  { x: 1095, y: 788, w: 110, h: 36 },
  { x: 1395, y: 788, w: 110, h: 36 },
];

function standColliders(): Collider[] {
  return PLAZA_STANDS.map((s) => ({ ...s }));
}

export type SeatDir = "up" | "down" | "left" | "right";
export type Seat = {
  id: string; mapId: string; x: number; y: number; dir: SeatDir;
  /** stand exit override (default: the facing). Logs face the fire but you
   * hop off behind you, onto the sand. */
  stand?: SeatDir;
};

// Round café tables (colliders) + the long serving counter (walk-behind).
// The two top tables sit side by side; the third sits under the counter.
export const CAFE_TABLES: { x: number; y: number; w: number; h: number }[] = [
  { x: 270, y: 170, w: 110, h: 70 },
  { x: 680, y: 390, w: 110, h: 70 },
  { x: 120, y: 170, w: 110, h: 70 },
];
// Counter along the north-east wall. The staff strip (y 104..170) behind it
// stays walkable so you can serve from behind.
export const CAFE_COUNTER = { x: 520, y: 170, w: 340, h: 44 };
// Stools parked in front of the counter (small blockers, sit facing north).
export const CAFE_STOOLS: { x: number; y: number }[] = [
  { x: 580, y: 256 },
  { x: 690, y: 256 },
  { x: 800, y: 256 },
];
// Side chairs for the right-hand table (CAFE_TABLES[1]): one each side,
// facing each other across it like the deck chairs. Seat point = chair
// point (sitters snap onto the cushion); hop off outward.
export const CAFE_SIDE_CHAIRS: { x: number; y: number; dir: SeatDir }[] = (() => {
  const t = CAFE_TABLES[1];
  const y = t.y + t.h / 2;
  return [
    { x: t.x - 24, y, dir: "right" },
    { x: t.x + t.w + 24, y, dir: "left" },
  ];
})();

// Every sit spot in every world. Couches / logs / benches are walkable
// ground visuals — the seat collider keeps you from walking through the
// furniture, the seat point is where a sitter snaps to.
export const SEATS: Seat[] = [
  // sunny plaza benches (2 spots each, facing the middle path, south).
  // Up in the seat so your butt lands mid-slat, not on the edge.
  ...BENCHES.flatMap((b, bi) => [
    { id: `plaza-bench-${bi + 1}-a`, mapId: "plaza", x: b.x + 30, y: b.y + 8, dir: "down" as SeatDir },
    { id: `plaza-bench-${bi + 1}-b`, mapId: "plaza", x: b.x + 80, y: b.y + 8, dir: "down" as SeatDir },
  ]),
  // pitch stands (2 spots each, facing the game, south)
  ...PLAZA_STANDS.flatMap((s, si) => [
    { id: `plaza-stand-${si + 1}-a`, mapId: "plaza", x: s.x + 30, y: s.y + 10, dir: "down" as SeatDir },
    { id: `plaza-stand-${si + 1}-b`, mapId: "plaza", x: s.x + 80, y: s.y + 10, dir: "down" as SeatDir },
  ]),
  // social deck chairs: left chair faces the table (right), hop off left;
  // right chair faces the table (left), hop off right.
  ...DECK_TABLES.flatMap((t, ti) => [
    { id: `deck-t${ti + 1}-l`, mapId: "plaza", x: t.x - 24, y: t.y + t.h / 2, dir: "right" as SeatDir, stand: "left" as SeatDir },
    { id: `deck-t${ti + 1}-r`, mapId: "plaza", x: t.x + t.w + 24, y: t.y + t.h / 2, dir: "left" as SeatDir, stand: "right" as SeatDir },
  ]),
  // cozy beach campfire logs (on the log, facing the fire — hop off south)
  { id: "beach-log-1-a", mapId: "beach", x: 694, y: 468, dir: "up", stand: "down" },
  { id: "beach-log-1-b", mapId: "beach", x: 722, y: 468, dir: "up", stand: "down" },
  { id: "beach-log-2-a", mapId: "beach", x: 878, y: 468, dir: "up", stand: "down" },
  { id: "beach-log-2-b", mapId: "beach", x: 906, y: 468, dir: "up", stand: "down" },
  // arcade loft couch (up on the cushions, facing the TV by the bottom wall)
  { id: "arcade-couch-a", mapId: "arcade", x: 174, y: 420, dir: "down" },
  { id: "arcade-couch-b", mapId: "arcade", x: 256, y: 420, dir: "down" },
  // café tables: one chair each, north side, facing the table.
  // The seat point rides 8px above the chair graphic so sitters rest ON
  // the cushion (chair front peeks out below them). Stand hops off north.
  ...CAFE_TABLES.flatMap((t, ti) => [
    { id: `cafe-t${ti + 1}-n`, mapId: "cafe", x: t.x + t.w / 2, y: t.y - 30, dir: "down" as SeatDir, stand: "up" as SeatDir },
  ]),
  // café counter stools (face the counter, hop off south). The seat rides
  // 14px above the graphic so sitters perch on the cushion with the legs
  // peeking out below them.
  ...CAFE_STOOLS.map((s, si) => (
    { id: `cafe-stool-${si + 1}`, mapId: "cafe", x: s.x, y: s.y - 14, dir: "up" as SeatDir, stand: "down" as SeatDir }
  )),
  // café right-table side chairs (face each other across the table, hop
  // off outward — same pattern as the deck chairs).
  ...CAFE_SIDE_CHAIRS.map((c, ci) => (
    { id: `cafe-t2-${ci === 0 ? "w" : "e"}`, mapId: "cafe", x: c.x, y: c.y, dir: c.dir, stand: (ci === 0 ? "left" : "right") as SeatDir }
  )),
];

// TV unit in the arcade loft: console against the bottom wall with its screen
// facing the couch. Stand right up against the console and press Interact.
export const TV_SPOT = { x: 210, y: 505 };
export const TV_RADIUS = 38;

// Arcade north-wall furniture. Left: air hockey table (playable, 1v1).
// Right: two upright cabinets + token vendor.
export const ARCADE_AIRHOCKEY = { x: 90, y: 115, w: 200, h: 140 };
// Air hockey: P1 stands west of the table, P2 east (mirrors server spots).
export const AH_SPOT_P1 = { x: 52, y: 185 };
export const AH_SPOT_P2 = { x: 328, y: 185 };
export const AH_RADIUS = 40;
export const ARCADE_PONG = { x: 630, y: 120, w: 110, h: 90 };
export const ARCADE_SNAKE = { x: 750, y: 120, w: 110, h: 90 };
export const ARCADE_TOKEN = { x: 872, y: 120, w: 56, h: 90 };
// Stand south of the cabinet, facing it (mirrors server SNAKE_SPOT).
export const SNAKE_SPOT = { x: 805, y: 262 };
export const SNAKE_RADIUS = 40;
// Pong cabinet interact spot (mirrors server PONG_SPOT).
export const PONG_SPOT = { x: 685, y: 262 };
export const PONG_RADIUS = 40;
export const TOKEN_SPOT = { x: 900, y: 262 };
export const TOKEN_RADIUS = 40;

// ---- Café interior (inside the Sunny Plaza CAFÉ cabin) ----
// Same 960x640 cabin format as the arcade loft: wood floor, walls, a long
// counter you can walk behind (staff strip between wall + counter), round
// tables with chairs, and an entrance door at the bottom wall.
// Door flow: CAFE_DOOR_OUTSIDE (plaza, in front of the cabin) -> E enters,
// spawning at CAFE_SPAWN; CAFE_DOOR_INSIDE (just north of the interior door)
// -> E exits back to CAFE_EXIT_OUTSIDE.
export const CAFE_DOOR_OUTSIDE = { x: 310, y: 368 };
export const CAFE_DOOR_RADIUS = 80;
// Chalkboard on the café back wall (slate + E interact spot). Strokes are
// stored normalized 0..1 so the menu modal and the world share them.
export const CAFE_BOARD = { x: 430, y: 16, w: 100, h: 64 };
export const CAFE_BOARD_SPOT = { x: 480, y: 60 };
export const CAFE_BOARD_RADIUS = 95;
export const CAFE_SPAWN = { x: 480, y: 500 };
export const CAFE_DOOR_INSIDE = { x: 480, y: 516 };
export const CAFE_EXIT_RADIUS = 80;
export const CAFE_EXIT_OUTSIDE = { x: 310, y: 372 };

function cafeColliders(): Collider[] {
  return [
    ...CAFE_TABLES.map((t) => ({ ...t })),
    { ...CAFE_COUNTER },
    ...CAFE_STOOLS.map((s) => ({ x: s.x - 14, y: s.y - 14, w: 28, h: 28 })),
    // walls (top band is wall, not floor)
    { x: 0, y: 0, w: 960, h: 104 },
    { x: 0, y: 0, w: 16, h: 640 },
    { x: 944, y: 0, w: 16, h: 640 },
    // bottom wall + entrance door (door juts out, own extended box)
    { x: 0, y: 584, w: 960, h: 56 },
    { x: 422, y: 572, w: 116, h: 68 },
  ];
}

export function seatsFor(mapId: string): Seat[] {
  return SEATS.filter((s) => s.mapId === mapId);
}

export function nearestSeat(mapId: string, x: number, y: number, maxD = 85): Seat | null {
  let best: Seat | null = null;
  let bestD = maxD;
  for (const s of SEATS) {
    if (s.mapId !== mapId) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

export const MAPS: Record<string, MapDef> = {
  plaza: {
    id: "plaza",
    name: "Sunny Plaza",
    desc: "Fountain, café, deck, football field",
    width: 1600, height: 1200,
    colliders: [
      { x: 700, y: 480, w: 200, h: 140 }, // fountain
      { x: 180, y: 180, w: 260, h: 150 }, // cafe
      // (the old SHOP cabin is gone — the open social deck lives here now,
      // walkable platform; hedges + tables are the only blockers)
      ...deckHedgeColliders(),
      ...deckTableColliders(),
      // (the old HUT cabin is gone — the race-track arena lives here now,
      // fully walkable for players; cars get their own invisible walls)
      ...treeColliders(),
      ...lampColliders(),
      ...benchColliders(),
      ...standColliders(),
      // post-fence world edge
      { x: 0, y: 0, w: 1600, h: 30 },
      { x: 0, y: 0, w: 30, h: 1200 },
      { x: 1570, y: 0, w: 30, h: 1200 },
      { x: 0, y: 1170, w: 1600, h: 30 },
    ],
  },
  beach: {
    id: "beach",
    name: "Cozy Beach",
    desc: "Volleyball ball, palms, campfire",
    width: 1600, height: 1200,
    colliders: [
      // the sea is walkable now: shallow wading (BEACH_WATER_Y..BEACH_DEEP_Y)
      // slows you, deep water (BEACH_DEEP_Y..1200) dunks + respawns you.
      // The map edge itself still holds you in (see collide()).
      { x: 200, y: 200, w: 180, h: 120 }, // rock
      { x: 1250, y: 250, w: 160, h: 110 }, // rock2
      { x: 775, y: 425, w: 50, h: 50 }, // campfire stone ring
      ...palmColliders(),
      // rope-fence edges (bottom is the sea, already blocked)
      { x: 0, y: 0, w: 1600, h: 30 },
      { x: 0, y: 0, w: 30, h: 1200 },
      { x: 1570, y: 0, w: 30, h: 1200 },
    ],
  },
  arcade: {
    id: "arcade",
    name: "Arcade Loft",
    desc: "Tiny indoor room for minigames",
    width: 960, height: 640,
    colliders: [
      { x: 90, y: 115, w: 200, h: 140 }, // air hockey table (left)
      { x: 630, y: 120, w: 110, h: 90 }, // pong cabinet (right)
      { x: 750, y: 120, w: 110, h: 90 }, // snake cabinet (right)
      { x: 872, y: 120, w: 56, h: 90 }, // token vendor (right of snake)
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
  },
  cafe: {
    id: "cafe",
    name: "Café Interior",
    desc: "Cozy coffee room off the plaza",
    width: 960, height: 640,
    colliders: cafeColliders(),
  },
};

export function collide(x: number, y: number, r: number, map: MapDef): { x: number; y: number } {
  // circle vs rect resolve, applied on next pos
  let nx = Math.max(r, Math.min(map.width - r, x));
  let ny = Math.max(r, Math.min(map.height - r, y));
  for (const c of map.colliders) {
    const cx = Math.max(c.x, Math.min(nx, c.x + c.w));
    const cy = Math.max(c.y, Math.min(ny, c.y + c.h));
    const dx = nx - cx, dy = ny - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;
    if (Math.hypot(dx, dy) > 0.001) {
      if (Math.abs(dx) > Math.abs(dy)) nx = dx > 0 ? c.x + c.w + r : c.x - r;
      else ny = dy > 0 ? c.y + c.h + r : c.y - r;
    } else {
      // center buried inside the rect: exit along least penetration instead
      // of defaulting north, so pressing into furniture never tunnels you
      // through to the top.
      const l = nx - c.x, rr = c.x + c.w - nx, tp = ny - c.y, bt = c.y + c.h - ny;
      const m = Math.min(l, rr, tp, bt);
      if (m === l) nx = c.x - r;
      else if (m === rr) nx = c.x + c.w + r;
      else if (m === tp) ny = c.y - r;
      else ny = c.y + c.h + r;
    }
  }
  return { x: nx, y: ny };
}

export function pointBlocked(x: number, y: number, mapId: string, pad = 24): boolean {
  const map = MAPS[mapId] || MAPS.plaza;
  if (x < pad || y < pad || x > map.width - pad || y > map.height - pad) return true;
  return map.colliders.some((c) => x > c.x - pad && x < c.x + c.w + pad && y > c.y - pad && y < c.y + c.h + pad);
}

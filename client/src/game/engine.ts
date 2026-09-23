import { MAPS, TREES_POS, PALMS_POS, BENCHES, PLAZA_FIELD, PLAZA_STANDS, CAFE_TABLES, CAFE_COUNTER, CAFE_STOOLS, CAFE_SIDE_CHAIRS, CAFE_BOARD, DECK, DECK_STAIRS, DECK_TABLES, DECK_CHAIRS, RACE_AREA, RACE_TRACK, RACE_COLORS, RACE_STARTS, raceOnTrack, collide, BEACH_WATER_Y, BEACH_DEEP_Y, beachZone, ARCADE_AIRHOCKEY } from "./maps";
import { drawEmoteIcon, EMOTE_DUR, WOW_DELAY_MS } from "./emotes";
import { DEFAULT_AVATAR, sanitizeAvatar, type Avatar, type Pet } from "./avatar";
import type { Player, RoomState, BoardState, AhState } from "../net/socket";
import type { Binds } from "./binds";

/** Merge a player's optional avatar blob over defaults (color stays canonical). */
export function getAvatar(p: Pick<Player, "color" | "avatar">): Avatar {
  const base = sanitizeAvatar({ ...(p.avatar || {}), color: p.color });
  return { ...DEFAULT_AVATAR, ...base, color: p.color || base.color };
}

export type EngineCallbacks = {
  getState: () => RoomState | null;
  getMyId: () => string;
  /** Account ids on your friends list — their nametags render gold. */
  friendIds: () => string[];
  sendMove: (x: number, y: number, dir: string, moving: boolean, z: number, crouch: boolean, sprint: boolean) => void;
  /** Drive inputs for the held toy car (WASD/arrows steer the car, not you). */
  sendDrive: (inp: { w: boolean; a: boolean; s: boolean; d: boolean }) => void;
  /** True while you're holding a race joystick — feet stay put, keys drive. */
  isDriving: () => boolean;
  /** True while a modal menu is up — browser shortcuts stay enabled then. */
  isMenuOpen: () => boolean;
  /** True while ANY in-game menu is open — the character can't move then. */
  isFrozen: () => boolean;
  /** True while the TV panel is up — wiggling must not stand you up. */
  isTvOpen: () => boolean;
  /** True while a shared polaroid is open in the viewer — feet stay put. */
  isViewerOpen: () => boolean;
  /** True while the camera darkroom is up — framing the shot, feet stay put. */
  isCamOpen: () => boolean;
  /** True while the café blackboard is up — chalk in hand, feet stay put. */
  isBoardOpen: () => boolean;
  dustEnabled: () => boolean;
  isDebug: () => boolean;
  showColliders: () => boolean;
  /** Extra debug lines (e.g. voice) supplied by the app. */
  debugLines: () => string[];
  binds: () => Binds;
};

// Fixed logical viewport: identical for every monitor.
export const VIEW_W = 960;
export const VIEW_H = 600;

// ---------- cozy palette ----------
const INK = "#4a3728";
const CREAM = "#fff8e7";
const LEAF_D = "#3e7d46";
const LEAF = "#4c9a52";
const LEAF_L = "#6fbf73";

// deterministic 0..1 hash for stable scenery (no shimmer between frames)
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, v + amt));
  const r = c((n >> 16) & 255), g = c((n >> 8) & 255), b = c(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// Tail side memory: +1 = right, -1 = left. Updated on horizontal movement,
// read on vertical/idle — so the tail keeps its last horizontal side.
const tailSide = new Map<string, number>();

// Emote clock-skew latch: the server stamps p.emoteAt with ITS clock, which
// can be seconds off the client's on hosted deploys. Latching the first-seen
// local time per stamp (same trick as the coin popup) means lag delays the
// start but never cuts the performance short.
const emoteLocal = new Map<string, { emote: string; stamp: number; atLocal: number }>();
// Cut-short surprise landings: emote id -> { touchdown start, lift it fell from }.
const WOW_LAND_MS = 280;
const wowLand = new Map<string, { atLocal: number; lift: number }>();
function emoteStateFor(p: Player, nowMs: number): { em: string | null; eAge: number; landing: { lift: number; age: number } | null } {
  const id = (p as any).emote as string | undefined;
  const stamp = (p as any).emoteAt as number | undefined;
  if (!id || !stamp) {
    const prev = emoteLocal.get(p.id);
    emoteLocal.delete(p.id);
    // surprise yanked out of the sky early (moved off / re-fired): fall fast
    // instead of snapping to the ground
    if (prev && prev.emote === "wow") {
      const age = nowMs - prev.atLocal;
      const wDur = (EMOTE_DUR as Record<string, number>).wow ?? 8000;
      if (age < wDur - WOW_DELAY_MS - 700) {
        const e = age - WOW_DELAY_MS;
        const lift = e <= 0 ? 0 : 14 * Math.min(1, e / 250);
        if (lift > 1) {
          wowLand.set(p.id, { atLocal: nowMs, lift });
          if (wowLand.size > 64) {
            const oldest = wowLand.keys().next().value;
            if (oldest) wowLand.delete(oldest);
          }
          return { em: null, eAge: Infinity, landing: { lift, age: 0 } };
        }
      }
    }
    const land = wowLand.get(p.id);
    if (land) {
      const lage = nowMs - land.atLocal;
      if (lage < WOW_LAND_MS) return { em: null, eAge: Infinity, landing: { lift: land.lift, age: lage } };
      wowLand.delete(p.id);
    }
    return { em: null, eAge: Infinity, landing: null };
  }
  // a live performance takes over — no stale landing behind it
  wowLand.delete(p.id);
  const prev = emoteLocal.get(p.id);
  if (!prev || prev.stamp !== stamp || prev.emote !== id) {
    emoteLocal.set(p.id, { emote: id, stamp, atLocal: nowMs });
    if (emoteLocal.size > 128) {
      const oldest = emoteLocal.keys().next().value;
      if (oldest) emoteLocal.delete(oldest);
    }
    return { em: id, eAge: 0, landing: null };
  }
  const dur = (EMOTE_DUR as Record<string, number>)[id] ?? 8000;
  const eAge = nowMs - prev.atLocal;
  if (Number.isFinite(dur) && eAge >= dur) return { em: null, eAge, landing: null };
  return { em: id, eAge, landing: null };
}

// Angel wing art (right wing) supplied as an SVG path: drawn via Path2D so
// it tints with the wearer's back color. Mirrored horizontally for the left
// wing. Source: public/lobby/wing.svg.
const ANGEL_WING_PATH = new Path2D(
  "M271.51,137c68.14-53.64,250.67-134.08,407.23-51.63,205.31,108.12,234.84,302.3,227.35,346.44-34.98,176.55-231.51,161.56-310.63-32.48,69.12,172.38-46.32,218.21-119.92,194.87-68.29-21.65-114.92-102.43-104.1-209.86-57.46,84.11-224.94,162.45-283.98,131.58-90.77-47.47-11.66-224.85,184.04-378.91Z"
);
// Wing root in path coords (dome top-center, where it meets the shoulders).
const ANGEL_WING_ROOT_X = 480;
const ANGEL_WING_ROOT_Y = 140;
// Small scale — ~24px span at 0.028, keeps the wings delicate behind the cloak.
const ANGEL_WING_K = 0.028;
const ANGEL_WING_LINE = 70;

// ---------------------------------------------------------------- characters
// ------------------------------------------------- hooded wanderer character
// A cozy hooded traveler: cloak in the player's color, shadowed face with
// bright eyes that look toward the walk direction, little boots, leaf pin
// for your own character. Simple shapes, easy to recolor and extend.
// Exported so the avatar preview reuses the exact in-game renderer.
export function drawTraveler(
  ctx: CanvasRenderingContext2D,
  p: Player,
  sx: number, sy: number,
  t: number,
  isMe: boolean,
  anim: { step: number; z: number; crouch: boolean; sitting?: boolean }
) {
  // Ground-sit renders through the exact seat-sitting pose (boots out over
  // the cloak) — no hop, and it lasts until the server clears it.
  const sitting = !!anim.sitting || !!(p as any).sitting || (p as any).emote === "sit";
  const step = sitting ? 0 : anim.step;
  const bob = sitting ? 0 : p.moving ? Math.abs(step) * -2 : Math.sin(t / 900) * 1;
  const blink = t % 3700 < 130;
  const lean = p.dir === "left" ? -2.4 : p.dir === "right" ? 2.4 : 0;
  const sway = p.moving ? step * 1.6 : Math.sin(t / 1100) * 0.8;

  // shadow (shrinks as you jump higher)
  const shScale = Math.max(0.55, 1 - anim.z / 110);
  ctx.fillStyle = "rgba(43,31,22,0.28)";
  ctx.beginPath();
  ctx.ellipse(sx, sy + 21, 14 * shScale, 5 * shScale, 0, 0, Math.PI * 2);
  ctx.fill();

  // speaking ring
  if ((p as any).speaking) {
    ctx.strokeStyle = "#7fc6a4";
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(sx, sy - 2, 27 + Math.sin(t / 200) * 1.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // emote performance: which reaction is playing, if any (latched clock —
  // see emoteStateFor — so hosted clock skew can't shorten anything)
  const nowMs = Date.now();
  const { em, eAge, landing } = emoteStateFor(p, nowMs);

  // per-emote body motion: tilt (radians), liftY (px, up positive), shake, boot spread
  // (idea / sweat / nope / yes are deliberately still — only their icons act)
  let tilt = 0, liftY = 0, shakeX = 0, bootSpread = 0, marchPh = 0;
  if (em === "heart") tilt = Math.sin(eAge / 150) * 0.06;
  if (em === "dance") tilt = Math.sin(eAge / 200) * 0.08;
  if (em === "angry") shakeX = Math.sin(eAge / 45) * 1.5;
  if (em === "dizzy") shakeX = Math.sin(eAge / 50) * 0.8;
  if (em === "march") { marchPh = Math.sin(eAge / 220); tilt = marchPh * 0.07; }
  if (em === "wow") {
    // half-second grace so lag never eats the hop; then airborne for the
    // whole show — touchdown only in the final stretch
    const wDur = (EMOTE_DUR as Record<string, number>).wow ?? 8000;
    const e = eAge - WOW_DELAY_MS;
    const fallStart = wDur - WOW_DELAY_MS - 700;
    if (e > 0) {
      const rise = Math.min(1, e / 250);
      const fall = e < fallStart ? 1 : Math.max(0, 1 - (e - fallStart) / 700);
      liftY = 14 * rise * fall;
      bootSpread = 4;
      // the whole body sways with the kicks while dangling
      tilt = Math.sin(eAge / 300) * 0.05;
    }
  }
  // surprise cut short (moved / re-fired): quick touchdown, never a snap
  if (!em && landing) {
    const k = Math.max(0, 1 - landing.age / WOW_LAND_MS);
    liftY = landing.lift * k * k;
    bootSpread = 4 * k;
  }
  // per-emote breathing (overrides the idle bob)
  let bobs = bob;
  if (em === "laugh") bobs += Math.abs(Math.sin(eAge / 160)) * -3.5;
  if (em === "dance") bobs += Math.abs(Math.sin(eAge / 190)) * -3;
  if (em === "sleep") bobs = Math.sin(eAge / 650) * 2.8;
  if (em === "cry") bobs += -Math.floor(Math.abs(Math.sin(eAge / 170)) * 3) / 3 * 3;
  if (em === "march") bobs += Math.abs(Math.cos(eAge / 220)) * -1.5;

  ctx.save();
  // crouch squash, pivoted at the feet (sitters keep their normal body —
  // only their boots change, poking out from under the cloak)
  if (!sitting && anim.crouch) {
    ctx.translate(sx, sy + 14);
    ctx.scale(1.07, 0.86);
    ctx.translate(-sx, -(sy + 14));
  }
  if (tilt || liftY || shakeX || anim.z > 0) {
    ctx.translate(sx, sy);
    if (tilt) ctx.rotate(tilt);
    ctx.translate(-sx + shakeX, -sy - liftY - anim.z);
  }

  const cx = sx + lean * 0.4;
  const topY = sy - 25 + bobs;
  const hemY = sy + 14;
  const av = getAvatar(p);

  // cape first of all: it hangs behind everything, boots included, so its
  // hem never paints over your feet
  if (av.back === "cape") {
    // wavy hem + swings out behind you in profile so it stays visible
    // instead of hiding behind the cloak (your back faces away from motion)
    const sideFace = p.dir === "left" ? -1 : p.dir === "right" ? 1 : 0;
    const peek = -sideFace * 8;
    const wave = Math.sin(t / 500) * 2;
    const midY = (topY + hemY) / 2;
    const hemY2 = hemY + 2;
    ctx.fillStyle = av.backColor;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx - 10 + peek * 0.3, topY + 8);
    ctx.quadraticCurveTo(cx - 20 + sway * 0.6 + peek, midY, cx - 17 + sway * 0.8 + peek, hemY2 + wave);
    for (let wv = 0; wv < 4; wv++) {
      const xa = cx - 17 + (34 * wv) / 4 + sway * 0.8 + peek;
      const xb = cx - 17 + (34 * (wv + 1)) / 4 + sway * 0.8 + peek;
      ctx.quadraticCurveTo((xa + xb) / 2, hemY2 + 7 + (wv % 2 ? -wave : wave), xb, hemY2 + (wv % 2 ? wave : -wave) * 0.5);
    }
    ctx.quadraticCurveTo(cx + 20 + sway * 0.6 + peek, midY, cx + 10 + peek * 0.3, topY + 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // boots (custom color) — hidden while sitting (the sit-boots below take
  // over, drawn big and over the cloak instead)
  if (!sitting) {
    let f1 = p.moving ? Math.max(0, step) * 3.5 : 0;
    let f2 = p.moving ? Math.max(0, -step) * 3.5 : 0;
    if (em === "march") {
      // marching on the spot: feet take turns leaving the ground
      f1 = Math.max(0, marchPh) * 9;
      f2 = Math.max(0, -marchPh) * 9;
    }
    if (em === "wow" && liftY > 1) {
      // dangling kicks mid-air: hard alternating pumps inside a slow swell
      // (never fully still), legs scissoring with each pump
      const kEnv = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(eAge / 900), 2);
      const kick = Math.sin(eAge / 150);
      f1 += Math.max(0, kick) * 8 * kEnv;
      f2 += Math.max(0, -kick) * 8 * kEnv;
      bootSpread += Math.abs(kick) * 2.5 * kEnv;
    }
    ctx.fillStyle = av.boots;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    for (const [fx, fh] of [[cx - 11 - bootSpread, f1], [cx + 1 + bootSpread, f2]] as const) {
      // the marching lifted foot skips this layer — it strides OVER the
      // cloak below, sitting-boot style; the planted foot stays normal
      if (em === "march" && fh > 0.5) continue;
      ctx.beginPath();
      ctx.roundRect(fx, sy + 13 - fh, 10, 9 + fh, 4);
      ctx.fill();
      ctx.stroke();
    }
  }

  // back extras ride BEHIND the cloak: wings / tail, all tinted by
  // the wearer's back color (the cape already drew behind the boots above)
  // Fresh start — delete everything and retrace from small + left/right.
  if (av.back === "angel" || av.back === "bat") {
    const flap = Math.sin(t / 300) * 2 + (p.moving ? Math.abs(step) * -2 : 0);
    const angel = av.back === "angel";
    if (angel) {
      // Small wings, one per side, flipped via scale(s*K, K).
      // Step 1: get them visible at a small size before tweaking rotation.
      for (const s of [-1, 1] as const) {
        ctx.save();
        ctx.translate(cx + s * 18, topY + 8);
        ctx.rotate(s * flap * 0.03);
        ctx.scale(s * ANGEL_WING_K, ANGEL_WING_K);
        ctx.translate(-ANGEL_WING_ROOT_X, -ANGEL_WING_ROOT_Y);
        ctx.fillStyle = av.backColor;
        ctx.strokeStyle = INK;
        ctx.lineWidth = ANGEL_WING_LINE;
        ctx.lineJoin = "round";
        ctx.fill(ANGEL_WING_PATH);
        ctx.stroke(ANGEL_WING_PATH);
        ctx.restore();
      }
    } else {
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(cx + s * 10, topY + 12);
        ctx.rotate(s * (0.5 + flap * 0.03));
        ctx.fillStyle = av.backColor;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(s * 10, -10 + flap * 0.4, s * 18, -4 + flap * 0.6);
        ctx.quadraticCurveTo(s * 13, -3 + flap * 0.5, s * 12, 2);
        ctx.quadraticCurveTo(s * 8, 0, s * 6, 4);
        ctx.quadraticCurveTo(s * 3, 2, 0, 4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
  } else if (av.back === "tail") {
    // trailing side tracks the last horizontal heading: heading right pins
    // it left, heading left pins it right; up/down/idle keeps whichever
    // side was last (right until you've ever moved sideways)
    if (p.dir === "right") tailSide.set(p.id, -1);
    else if (p.dir === "left") tailSide.set(p.id, 1);
    const s = tailSide.get(p.id) ?? 1;
    const wag = (Math.sin(t / 350) * 3 + sway * 0.5) * s;
    ctx.strokeStyle = av.backColor;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx + s * 10, hemY - 5);
    ctx.quadraticCurveTo(cx + s * 20, hemY - 1 + wag * 0.4, cx + s * 23 + wag, hemY - 8);
    ctx.stroke();
    ctx.fillStyle = av.trim;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(cx + s * 23 + wag, hemY - 8, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // cloak with soft vertical gradient (or a custom two-tone fade)
  const g = ctx.createLinearGradient(0, topY, 0, hemY);
  if (av.gradient) {
    g.addColorStop(0, av.color);
    g.addColorStop(1, av.cloakEnd);
  } else {
    g.addColorStop(0, shade(p.color, 28));
    g.addColorStop(0.55, p.color);
    g.addColorStop(1, shade(p.color, -18));
  }
  ctx.fillStyle = g;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 10, topY + 4);
  ctx.quadraticCurveTo(cx - 16, (topY + hemY) / 2, cx - 15 + sway * 0.4, hemY);
  ctx.quadraticCurveTo(cx - 7, hemY + 4.5, cx, hemY + sway * 0.35);
  ctx.quadraticCurveTo(cx + 7, hemY + 4.5, cx + 15 + sway * 0.4, hemY);
  ctx.quadraticCurveTo(cx + 16, (topY + hemY) / 2, cx + 10, topY + 4);
  ctx.quadraticCurveTo(cx, topY - 7, cx - 10, topY + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // cloak pattern (clipped inside the cloak silhouette)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - 10, topY + 4);
  ctx.quadraticCurveTo(cx - 16, (topY + hemY) / 2, cx - 15 + sway * 0.4, hemY);
  ctx.quadraticCurveTo(cx - 7, hemY + 4.5, cx, hemY + sway * 0.35);
  ctx.quadraticCurveTo(cx + 7, hemY + 4.5, cx + 15 + sway * 0.4, hemY);
  ctx.quadraticCurveTo(cx + 16, (topY + hemY) / 2, cx + 10, topY + 4);
  ctx.quadraticCurveTo(cx, topY - 7, cx - 10, topY + 4);
  ctx.closePath();
  ctx.clip();
  if (av.pattern === "stripes") {
    ctx.fillStyle = "rgba(255,248,231,0.5)";
    for (const yy of [topY + 16, topY + 24, topY + 32]) {
      ctx.fillRect(cx - 16, yy, 32, 3);
    }
    ctx.fillStyle = "rgba(43,31,22,0.25)";
    ctx.fillRect(cx - 16, hemY - 3, 32, 3);
  } else if (av.pattern === "dots") {
    ctx.fillStyle = "rgba(255,248,231,0.65)";
    for (const [dx, dy] of [[-7, 18], [6, 22], [-1, 30], [-8, 34], [7, 36]] as const) {
      ctx.beginPath();
      ctx.arc(cx + dx, topY + dy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (av.pattern === "patches") {
    ctx.fillStyle = shade(av.trim, 10);
    ctx.strokeStyle = "rgba(43,31,22,0.6)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(cx - 12, topY + 22, 9, 8, 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(cx + 3, topY + 30, 9, 8, 2);
    ctx.fill();
    ctx.stroke();
  }
  // trim hem stitching
  ctx.strokeStyle = av.trim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 13, hemY - 1);
  ctx.quadraticCurveTo(cx, hemY + 3, cx + 13, hemY - 1);
  ctx.stroke();
  ctx.restore();

  // cloak fold lines
  ctx.strokeStyle = "rgba(43,31,22,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 6, topY + 22);
  ctx.quadraticCurveTo(cx - 8, hemY - 8, cx - 7 + sway * 0.4, hemY - 2);
  ctx.moveTo(cx + 6, topY + 22);
  ctx.quadraticCurveTo(cx + 8, hemY - 8, cx + 7 + sway * 0.4, hemY - 2);
  ctx.stroke();

  // sit-boots: little legs stretched forward — bigger than usual, painted
  // OVER the cloak hem so they read as dangling in front of it
  if (sitting) {
    ctx.fillStyle = av.boots;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    for (const fx of [cx - 13, cx + 1]) {
      ctx.beginPath();
      ctx.roundRect(fx, sy + 12, 12, 11, 5);
      ctx.fill();
      ctx.stroke();
      // toe highlight
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.roundRect(fx + 2, sy + 14, 4, 7, 2);
      ctx.fill();
      ctx.fillStyle = av.boots;
    }
  } else if (em === "march") {
    // the lifted marching foot: same bottom-view boot as sitting, striding
    // up OVER the cloak while the planted foot stays normal behind it
    ctx.fillStyle = av.boots;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    const liftL = Math.max(0, marchPh) * 9;
    const liftR = Math.max(0, -marchPh) * 9;
    for (const [fx, fh] of [[cx - 12, liftL], [cx, liftR]] as const) {
      if (fh <= 0.5) continue;
      ctx.beginPath();
      ctx.roundRect(fx, sy + 13 - fh, 12, 11, 5);
      ctx.fill();
      ctx.stroke();
      // toe highlight
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.roundRect(fx + 2, sy + 15 - fh, 4, 7, 2);
      ctx.fill();
      ctx.fillStyle = av.boots;
    }
  }

  // pack straps accessory (over the cloak, under the face)
  if (av.accessory === "straps") {
    ctx.strokeStyle = "#5d3a1e";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - 8, topY + 8);
    ctx.lineTo(cx - 9, hemY - 2);
    ctx.moveTo(cx + 8, topY + 8);
    ctx.lineTo(cx + 9, hemY - 2);
    ctx.stroke();
    ctx.fillStyle = "#f2c14e";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.4;
    for (const by of [topY + 20, topY + 28]) {
      ctx.beginPath();
      ctx.roundRect(cx - 10, by, 4, 4, 1);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(cx + 6, by, 4, 4, 1);
      ctx.fill();
      ctx.stroke();
    }
  }

  // hood rim (trim-tinted) + face in the player's skin tone
  ctx.fillStyle = shade(av.trim, -12);
  ctx.beginPath();
  ctx.ellipse(cx, topY + 15, 11.5, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  // face shadow
  ctx.fillStyle = av.skin;
  ctx.beginPath();
  ctx.ellipse(cx, topY + 15.5, 8.6, 9.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // eyes: per-emote reactions, else look toward the walk direction (+blink)
  const lookX = p.dir === "left" ? -2.4 : p.dir === "right" ? 2.4 : 0;
  const lookY = p.dir === "up" ? -1.6 : p.dir === "down" ? 1.2 : 0;
  const eyeY = topY + 15;
  const heartEye = (hx: number, s: number) => {
    ctx.fillStyle = "#d95f4b";
    ctx.beginPath();
    ctx.moveTo(hx, eyeY + s * 0.75);
    ctx.bezierCurveTo(hx - s * 1.15, eyeY - s * 0.1, hx - s * 0.62, eyeY - s * 0.95, hx, eyeY - s * 0.3);
    ctx.bezierCurveTo(hx + s * 0.62, eyeY - s * 0.95, hx + s * 1.15, eyeY - s * 0.1, hx, eyeY + s * 0.75);
    ctx.closePath();
    ctx.fill();
  };
  const starEye = (hx: number, s: number) => {
    ctx.fillStyle = "#f2c14e";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 === 0 ? s : s * 0.45;
      const a = -Math.PI / 2 + (k / 10) * Math.PI * 2;
      const px = hx + Math.cos(a) * r, py = eyeY + Math.sin(a) * r;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };
  const shutEye = (ex: number) => {
    ctx.strokeStyle = "#faf3df";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx + ex - 2 + lookX, eyeY + lookY);
    ctx.lineTo(cx + ex + 2 + lookX, eyeY + lookY);
    ctx.stroke();
  };
  const openEye = (ex: number, r: number) => {
    ctx.fillStyle = "#faf3df";
    ctx.beginPath();
    ctx.arc(cx + ex + lookX * 0.6, eyeY + lookY, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2b1f16";
    ctx.beginPath();
    ctx.arc(cx + ex + lookX, eyeY + 0.4 + lookY, r * 0.48, 0, Math.PI * 2);
    ctx.fill();
  };
  if (em === "heart") {
    heartEye(cx - 3.8, 4.2);
    heartEye(cx + 3.8, 4.2);
  } else if (em === "laugh") {
    // squeezed-shut smiling eyes
    ctx.strokeStyle = "#faf3df";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    for (const ex of [-3.8, 3.8]) {
      ctx.beginPath();
      ctx.arc(cx + ex, eyeY + 1, 2.8, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
    }
  } else if (em === "wow") {
    openEye(-3.8, 4.5);
    openEye(3.8, 4.5);
  } else if (em === "huh") {
    shutEye(-3.8); // one eye half closed
    openEye(3.8, 3.1);
  } else if (em === "sleep") {
    shutEye(-3.8);
    shutEye(3.8);
  } else if (em === "angry") {
    // slanted upset lines, inner ends down
    ctx.strokeStyle = "#faf3df";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - 6.3, eyeY - 2);
    ctx.lineTo(cx - 1.3, eyeY + 1.5);
    ctx.moveTo(cx + 6.3, eyeY - 2);
    ctx.lineTo(cx + 1.3, eyeY + 1.5);
    ctx.stroke();
  } else if (em === "star") {
    starEye(cx - 3.8, 4.2);
    starEye(cx + 3.8, 4.2);
  } else if (em === "sweat") {
    // closed smiling eyes that drift upward every now and then
    const up = Math.pow(Math.max(0, Math.sin(eAge / 1100)), 8) * -2;
    ctx.strokeStyle = "#faf3df";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    for (const ex of [-3.8, 3.8]) {
      ctx.beginPath();
      ctx.arc(cx + ex, eyeY + 1 + up, 2.8, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
    }
  } else if (em === "cry") {
    // diagonal lines, outer ends down (angry is inner-down)
    ctx.strokeStyle = "#faf3df";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - 6.3, eyeY + 1.5);
    ctx.lineTo(cx - 1.3, eyeY - 2);
    ctx.moveTo(cx + 6.3, eyeY + 1.5);
    ctx.lineTo(cx + 1.3, eyeY - 2);
    ctx.stroke();
  } else if (em === "dizzy") {
    // woozy X eyes
    ctx.strokeStyle = "#faf3df";
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    for (const ex of [-3.8, 3.8]) {
      ctx.beginPath();
      ctx.moveTo(cx + ex - 2 + lookX * 0.5, eyeY - 2);
      ctx.lineTo(cx + ex + 2 + lookX * 0.5, eyeY + 2);
      ctx.moveTo(cx + ex + 2 + lookX * 0.5, eyeY - 2);
      ctx.lineTo(cx + ex - 2 + lookX * 0.5, eyeY + 2);
      ctx.stroke();
    }
  } else if (blink) {
    ctx.strokeStyle = "#faf3df";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (const ex of [-3.8, 3.8]) {
      ctx.beginPath();
      ctx.moveTo(cx + ex - 2 + lookX, topY + 15 + lookY);
      ctx.lineTo(cx + ex + 2 + lookX, topY + 15 + lookY);
      ctx.stroke();
    }
  } else if (av.eyeStyle === "happy") {
    ctx.strokeStyle = "#faf3df";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    for (const ex of [-3.8, 3.8]) {
      ctx.beginPath();
      ctx.arc(cx + ex + lookX * 0.5, eyeY + 1 + lookY, 2.8, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
    }
  } else if (av.eyeStyle === "sleepy") {
    ctx.strokeStyle = "#faf3df";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (const ex of [-3.8, 3.8]) {
      ctx.beginPath();
      ctx.moveTo(cx + ex - 2 + lookX, eyeY + 1 + lookY);
      ctx.lineTo(cx + ex + 2 + lookX, eyeY + 1 + lookY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + ex - 1 + lookX, eyeY + 3 + lookY);
      ctx.lineTo(cx + ex + 1 + lookX, eyeY + 3 + lookY);
      ctx.stroke();
    }
  } else if (av.eyeStyle === "wink") {
    shutEye(-3.8);
    openEye(3.8, 3.1);
  } else if (av.eyeStyle === "sharp") {
    ctx.fillStyle = "#faf3df";
    for (const ex of [-3.8, 3.8]) {
      ctx.beginPath();
      ctx.moveTo(cx + ex - 2.6 + lookX, eyeY - 1.5 + lookY);
      ctx.lineTo(cx + ex + 2.6 + lookX, eyeY - 1.5 + lookY);
      ctx.lineTo(cx + ex + 1.4 + lookX, eyeY + 2 + lookY);
      ctx.lineTo(cx + ex - 1.4 + lookX, eyeY + 2 + lookY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = av.skin;
    for (const ex of [-3.8, 3.8]) {
      ctx.beginPath();
      ctx.arc(cx + ex + lookX, eyeY + 0.6 + lookY, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (av.eyeStyle === "dot") {
    ctx.fillStyle = "#faf3df";
    for (const ex of [-3.8, 3.8]) {
      ctx.beginPath();
      ctx.arc(cx + ex + lookX * 0.6, eyeY + lookY, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    for (const ex of [-3.8, 3.8]) {
      ctx.fillStyle = "#faf3df";
      ctx.beginPath();
      ctx.arc(cx + ex + lookX * 0.6, topY + 15 + lookY, 3.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#2b1f16";
      ctx.beginPath();
      ctx.arc(cx + ex + lookX, topY + 15.4 + lookY, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // eye shine
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(cx - 4.6 + lookX, topY + 13.8 + lookY, 0.9, 0, Math.PI * 2);
    ctx.arc(cx + 3 + lookX, topY + 13.8 + lookY, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }

  // face decorations (blush / freckles / scar sit on the face shadow)
  if (av.faceDeco === "blush") {
    ctx.fillStyle = "rgba(232,145,156,0.85)";
    ctx.beginPath();
    ctx.ellipse(cx - 6.4, eyeY + 4.6, 2.2, 1.4, -0.2, 0, Math.PI * 2);
    ctx.ellipse(cx + 6.4, eyeY + 4.6, 2.2, 1.4, 0.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (av.faceDeco === "freckles") {
    ctx.fillStyle = "rgba(250,243,223,0.85)";
    for (const [dx, dy] of [[-6, 3.4], [-4, 4.6], [4, 4.6], [6, 3.4]] as const) {
      ctx.beginPath();
      ctx.arc(cx + dx, eyeY + dy, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (av.faceDeco === "scar") {
    ctx.strokeStyle = "rgba(250,243,223,0.8)";
    ctx.lineWidth = 1.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx + 5.6, eyeY - 3);
    ctx.lineTo(cx + 3.4, eyeY + 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 3.8, eyeY - 1);
    ctx.lineTo(cx + 6, eyeY - 1);
    ctx.stroke();
  }

  // glasses ride over the eyes
  if (av.glasses === "round") {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.8;
    for (const ex of [-3.8, 3.8]) {
      ctx.beginPath();
      ctx.arc(cx + ex, eyeY, 4.6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx + 0.8, eyeY);
    ctx.lineTo(cx - 0.8, eyeY);
    ctx.stroke();
  } else if (av.glasses === "shades") {
    ctx.fillStyle = "#1f1a16";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6;
    for (const ex of [-3.8, 3.8]) {
      ctx.beginPath();
      ctx.roundRect(cx + ex - 4, eyeY - 3, 8, 5.4, 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(cx - 6.4, eyeY - 2.4, 2.4, 1.6);
    ctx.fillRect(cx + 1.2, eyeY - 2.4, 2.4, 1.6);
  } else if (av.glasses === "star") {
    ctx.strokeStyle = "#f2c14e";
    ctx.lineWidth = 1.6;
    ctx.lineJoin = "round";
    for (const ex of [-3.8, 3.8]) {
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = k % 2 === 0 ? 5 : 2.4;
        const a = -Math.PI / 2 + (k / 10) * Math.PI * 2;
        const px = cx + ex + Math.cos(a) * r, py = eyeY + Math.sin(a) * r;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  // neckwear / chest: scarf wraps the hood base, bowtie + pendant use trim
  if (av.accessory === "scarf") {
    ctx.fillStyle = av.trim;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(cx - 10, topY + 24, 20, 7, 3.5);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(cx + 2, topY + 29, 6, 9, 2.5);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(43,31,22,0.5)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx + 3.4, topY + 33);
    ctx.lineTo(cx + 3.4, topY + 37);
    ctx.moveTo(cx + 5.4, topY + 33);
    ctx.lineTo(cx + 5.4, topY + 37);
    ctx.stroke();
  } else if (av.accessory === "bow") {
    ctx.fillStyle = av.trim;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.8;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx, topY + 30);
      ctx.lineTo(cx + s * 6.4, topY + 27.4);
      ctx.lineTo(cx + s * 6.4, topY + 32.6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, topY + 30, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    // bead cord on the cloak (pendant recolors the bead to trim)
    ctx.strokeStyle = "rgba(43,31,22,0.6)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx - 5, topY + 29);
    ctx.quadraticCurveTo(cx, topY + 33, cx + 5, topY + 29);
    ctx.stroke();
    ctx.fillStyle = av.accessory === "pendant" ? av.trim : "#f2c14e";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, topY + 32.5, av.accessory === "pendant" ? 3.4 : 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // hats sit snug on the hood peak — all tinted by hatColor
  const hc = av.hatColor;
  const hTop = topY - 1;
  if (av.hat === "beanie") {
    ctx.fillStyle = hc;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, hTop + 2, 10, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = shade(hc, -24);
    ctx.beginPath();
    ctx.roundRect(cx - 11, hTop - 2, 22, 6, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#faf3df";
    ctx.beginPath();
    ctx.arc(cx, hTop - 9, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (av.hat === "wizard") {
    ctx.fillStyle = hc;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx - 8, hTop + 2);
    ctx.lineTo(cx + 2, hTop - 20);
    ctx.lineTo(cx + 10, hTop + 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f2c14e";
    ctx.beginPath();
    ctx.arc(cx + 1, hTop - 10, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade(hc, -24);
    ctx.beginPath();
    ctx.ellipse(cx, hTop + 2, 13, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (av.hat === "crown") {
    ctx.fillStyle = "#f2c14e";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(cx - 9, hTop + 2);
    ctx.lineTo(cx - 9, hTop - 7);
    ctx.lineTo(cx - 4.5, hTop - 2);
    ctx.lineTo(cx, hTop - 9);
    ctx.lineTo(cx + 4.5, hTop - 2);
    ctx.lineTo(cx + 9, hTop - 7);
    ctx.lineTo(cx + 9, hTop + 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#d95f4b";
    ctx.beginPath();
    ctx.arc(cx, hTop - 2, 1.8, 0, Math.PI * 2);
    ctx.fill();
  } else if (av.hat === "flower") {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 - 0.4;
      const fx = cx + Math.cos(a) * 8.5, fy = hTop + Math.sin(a) * 3.4;
      ctx.fillStyle = k % 2 ? "#e8919c" : "#f7ead0";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(fx, fy, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f2c14e";
      ctx.beginPath();
      ctx.arc(fx, fy, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (av.hat === "horns") {
    ctx.fillStyle = "#f7ead0";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.2;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * 7, hTop + 2);
      ctx.quadraticCurveTo(cx + s * 12, hTop - 4, cx + s * 9, hTop - 11);
      ctx.quadraticCurveTo(cx + s * 6, hTop - 5, cx + s * 4, hTop + 1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (av.hat === "cat") {
    ctx.fillStyle = hc;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.2;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * 9, hTop + 3);
      ctx.lineTo(cx + s * 11, hTop - 9);
      ctx.lineTo(cx + s * 3, hTop - 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#e8919c";
      ctx.beginPath();
      ctx.moveTo(cx + s * 8.2, hTop);
      ctx.lineTo(cx + s * 9.4, hTop - 5.4);
      ctx.lineTo(cx + s * 5, hTop - 1.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = hc;
    }
  } else if (av.hat === "tophat") {
    ctx.fillStyle = hc;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.roundRect(cx - 7, hTop - 16, 14, 17, 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = av.trim;
    ctx.fillRect(cx - 7, hTop - 6, 14, 4);
    ctx.fillStyle = shade(hc, -20);
    ctx.beginPath();
    ctx.ellipse(cx, hTop + 1, 13, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (av.hat === "straw") {
    ctx.fillStyle = "#e8c46a";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(cx, hTop + 1, 15, 4.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#d9a94e";
    ctx.beginPath();
    ctx.arc(cx, hTop, 7, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#d95f4b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 7, hTop - 1);
    ctx.lineTo(cx + 7, hTop - 1);
    ctx.stroke();
  } else if (av.hat === "headphones") {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, hTop + 4, 11, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    ctx.fillStyle = hc;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.roundRect(cx + s * 12 - 4, hTop - 2, 8, 11, 3.5);
      ctx.fill();
      ctx.stroke();
    }
  }

  // leaf pin marks your own character
  if (isMe) {
    ctx.fillStyle = LEAF;
    ctx.strokeStyle = LEAF_D;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(cx - 12.5, topY + 4, 4.6, 2.8, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // emote particles (screen space, unrotated)
  if (em === "heart" || em === "dance" || em === "huh") {
    // rising icons, like the sleepy Z's
    const pid = em;
    for (let k = 0; k < 3; k++) {
      const ph = (nowMs / 1300 + k / 3) % 1;
      ctx.globalAlpha = 0.95 * (1 - ph);
      drawEmoteIcon(ctx, pid, sx - 22 + k * 22 + Math.sin(ph * 5 + k) * 4, sy - 46 - ph * 30, 10 - ph * 3);
    }
    ctx.globalAlpha = 1;
  } else if (em === "march") {
    // alternating dust puffs at the striking foot
    const mph = Math.sin(eAge / 220);
    for (const [side, gate] of [[-1, mph], [1, -mph]] as const) {
      if (gate > 0.55) {
        const k = (gate - 0.55) / 0.45;
        ctx.globalAlpha = 0.5 * (1 - k);
        ctx.fillStyle = "#d6c6aa";
        ctx.beginPath();
        ctx.arc(sx + side * 10, sy + 18 - k * 6, 2 + k * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  } else if (em === "wow") {
    // popping "!" beside the head — delayed with the hop, lingers, fades out
    const e = eAge - WOW_DELAY_MS;
    const wDur = (EMOTE_DUR as Record<string, number>).wow ?? 8000;
    if (e > 0) {
      const pop = e < 200 ? 0.3 + 0.7 * (e / 200) : 1;
      ctx.globalAlpha = eAge > wDur - 500 ? Math.max(0, 1 - (eAge - (wDur - 500)) / 500) : 1;
      drawEmoteIcon(ctx, "wow", sx + 24, sy - 42, 11 * pop);
      ctx.globalAlpha = 1;
    }
  } else if (em === "idea") {
    // bulb glows above the head, gentle bob, fades at the tail
    const wDur = (EMOTE_DUR as Record<string, number>).idea ?? 9000;
    const pop = eAge < 220 ? 0.3 + 0.7 * (eAge / 220) : 1;
    ctx.globalAlpha = eAge > wDur - 500 ? Math.max(0, 1 - (eAge - (wDur - 500)) / 500) : 1;
    const glow = ctx.createRadialGradient(sx, sy - 58, 2, sx, sy - 58, 26);
    glow.addColorStop(0, "rgba(242,193,78,0.5)");
    glow.addColorStop(1, "rgba(242,193,78,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx, sy - 58, 26, 0, Math.PI * 2);
    ctx.fill();
    drawEmoteIcon(ctx, "idea", sx, sy - 58 + Math.sin(nowMs / 400) * 2, 12 * pop);
    ctx.globalAlpha = 1;
  } else if (em === "cry") {
    // real teardrops welling out under each eye, running down, gone pre-feet
    for (const ex of [-3.8, 3.8]) {
      const tx = cx + ex;
      for (let k = 0; k < 2; k++) {
        const ph = (nowMs / 900 + k * 0.5 + (ex > 0 ? 0.25 : 0)) % 1;
        ctx.globalAlpha = 0.95 * (1 - ph);
        drawEmoteIcon(ctx, "cry", tx, eyeY + 6 + ph * 11, 5 - ph * 1.5);
      }
    }
    ctx.globalAlpha = 1;
  } else if (em === "sweat") {
    // one blue drop beads at the cheek: fades in, slides down very slowly
    // for the whole show, then lets go and falls at the very end
    const sDur = (EMOTE_DUR as Record<string, number>).sweat ?? 8000;
    const tail = 600;
    const dx = sx + 15, top = sy - 24;
    if (eAge < sDur - tail) {
      const q = Math.min(1, Math.max(0, eAge / (sDur - tail)));
      ctx.globalAlpha = Math.min(1, eAge / 500);
      drawEmoteIcon(ctx, "sweat", dx, top + q * 10, 9);
    } else {
      const k = Math.min(1, (eAge - (sDur - tail)) / tail);
      ctx.globalAlpha = 0.9 * (1 - k);
      drawEmoteIcon(ctx, "sweat", dx, top + 10 + k * k * 26, 9 - k * 2);
    }
    ctx.globalAlpha = 1;
  } else if (em === "dizzy") {
    // three motes orbiting the head, each its own color
    for (let k = 0; k < 3; k++) {
      const a = nowMs / 500 + (k / 3) * Math.PI * 2;
      const ox = sx + Math.cos(a) * 26, oy = sy - 40 + Math.sin(a) * 10;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = ["#8a6fbf", "#f2c14e", "#4e8d7c"][k];
      ctx.beginPath();
      ctx.arc(ox, oy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (em === "no") {
    // big X pops above the head, trembles a little
    const wDur = (EMOTE_DUR as Record<string, number>).no ?? 8000;
    const pop = eAge < 200 ? 0.3 + 0.7 * (eAge / 200) : 1;
    ctx.globalAlpha = eAge > wDur - 500 ? Math.max(0, 1 - (eAge - (wDur - 500)) / 500) : 1;
    drawEmoteIcon(ctx, "no", sx, sy - 56 + Math.sin(nowMs / 600) * 1.5, 12 * pop);
    ctx.globalAlpha = 1;
  } else if (em === "yes") {
    // green check pops above the head — mirrors nope exactly
    const wDur = (EMOTE_DUR as Record<string, number>).yes ?? 8000;
    const pop = eAge < 200 ? 0.3 + 0.7 * (eAge / 200) : 1;
    ctx.globalAlpha = eAge > wDur - 500 ? Math.max(0, 1 - (eAge - (wDur - 500)) / 500) : 1;
    drawEmoteIcon(ctx, "yes", sx, sy - 56 + Math.sin(nowMs / 600) * 1.5, 12 * pop);
    ctx.globalAlpha = 1;
    // (sit is static on purpose — no particles spamming while you lounge)
  } else if (em === "sleep") {
    ctx.font = "900 12px Nunito, 'Trebuchet MS', sans-serif";
    ctx.textAlign = "center";
    for (let k = 0; k < 2; k++) {
      const ph = (nowMs / 1100 + k * 0.5) % 1;
      ctx.globalAlpha = 0.9 * (1 - ph);
      ctx.fillStyle = "#7c9cc4";
      ctx.fillText("Z", sx + 4 + k * 8 - ph * 8, sy - 54 - ph * 26);
    }
    ctx.globalAlpha = 1;
  } else if (em === "angry") {
    // scribble cloud crackling above the head
    const sc = 1 + Math.sin(nowMs / 120) * 0.08;
    ctx.strokeStyle = "#2b1f16";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let k = 0; k <= 7; k++) {
      const px = sx + Math.sin(k * 2.3) * 9 * sc;
      const py = sy - 54 + Math.cos(k * 1.7) * 5 * sc;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.strokeStyle = "#d95f4b";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let k = 0; k <= 5; k++) {
      const px = sx + Math.cos(k * 2.9) * 6 * sc;
      const py = sy - 54 + Math.sin(k * 2.1) * 4 * sc;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  } else if (em === "star") {
    // twinkling sparkles ringing the head
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
      const spx = sx + Math.cos(a) * 30, spy = sy - 26 + Math.sin(a) * 20;
      const tw = Math.abs(Math.sin(nowMs / 220 + k * 1.3));
      const sr = 2.5 + tw * 4;
      ctx.globalAlpha = 0.35 + 0.65 * tw;
      ctx.strokeStyle = k % 2 ? "#f2c14e" : "#faf3df";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(spx - sr, spy);
      ctx.lineTo(spx + sr, spy);
      ctx.moveTo(spx, spy - sr);
      ctx.lineTo(spx, spy + sr);
      ctx.stroke();
      ctx.fillStyle = "#faf3df";
      ctx.beginPath();
      ctx.arc(spx, spy, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ------------------------------------------------------------------- pets
// Mini-you followers: blob hops along the ground, sprout waddles behind,
// wisp floats above and bobs. Same cozy ink outlines, tinted by the pet's
// own main + accent colors. Follows are simulated identically on every
// client from the owner's position, so no server physics is needed.
export function isFlyingPet(kind: string): boolean {
  return kind === "wisp";
}

export function drawPet(
  ctx: CanvasRenderingContext2D,
  pet: Pet,
  sx: number, sy: number,
  t: number,
  dir: string,
) {
  if (!pet || pet.kind === "none") return;
  const lookX = dir === "left" ? -1.6 : dir === "right" ? 1.6 : 0;
  const flying = isFlyingPet(pet.kind);
  const bobY = flying ? Math.sin(t / 420) * 4 : 0;
  const py = sy + bobY;

  // ground shadow — flyers get none (a shadow underneath made the wisp
  // read as grounded instead of floating)
  if (!flying) {
    ctx.fillStyle = "rgba(43,31,22,0.22)";
    ctx.beginPath();
    ctx.ellipse(sx, sy + 12, 11, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (pet.kind === "wisp") {
    // little ghost: rounded hood + wavy hem, soft glow
    const glow = ctx.createRadialGradient(sx, py, 2, sx, py, 26);
    glow.addColorStop(0, "rgba(255,255,255,0.35)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx, py, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pet.color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(sx - 10, py + 8);
    ctx.lineTo(sx - 10, py - 4);
    ctx.arc(sx, py - 4, 10, Math.PI, 0);
    ctx.lineTo(sx + 10, py + 8);
    // wavy hem
    for (let k = 0; k < 3; k++) {
      ctx.quadraticCurveTo(sx + 10 - (k * 2 + 1) * (20 / 6), py + 12, sx + 10 - (k * 2 + 2) * (20 / 6), py + 8);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // eyes follow the pet's eye style; the accent dot is its little mouth
    const weY = py - 3;
    ctx.lineCap = "round";
    if (pet.eyes === "happy") {
      ctx.strokeStyle = "#2b1f16";
      ctx.lineWidth = 1.8;
      for (const ex of [-3.6, 3.6]) {
        ctx.beginPath();
        ctx.arc(sx + ex + lookX * 0.5, weY, 2.2, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
    } else if (pet.eyes === "sleepy") {
      ctx.strokeStyle = "#2b1f16";
      ctx.lineWidth = 1.8;
      for (const ex of [-3.6, 3.6]) {
        ctx.beginPath();
        ctx.moveTo(sx + ex - 1.8 + lookX, weY);
        ctx.lineTo(sx + ex + 1.8 + lookX, weY);
        ctx.stroke();
      }
    } else if (pet.eyes === "wink") {
      ctx.strokeStyle = "#2b1f16";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(sx - 5.4 + lookX, weY);
      ctx.lineTo(sx - 1.8 + lookX, weY);
      ctx.stroke();
      ctx.fillStyle = "#2b1f16";
      ctx.beginPath();
      ctx.arc(sx + 3.6 + lookX, weY, 1.7, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "#2b1f16";
      for (const ex of [-3.6, 3.6]) {
        ctx.beginPath();
        ctx.arc(sx + ex + lookX, weY, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = pet.accent;
    ctx.beginPath();
    ctx.arc(sx + lookX, py + 2.5, 1.8, 0, Math.PI * 2);
    ctx.fill();
    if (pet.blush) {
      ctx.fillStyle = "rgba(232,145,156,0.85)";
      ctx.beginPath();
      ctx.ellipse(sx - 6.4, py + 1, 1.8, 1.2, -0.2, 0, Math.PI * 2);
      ctx.ellipse(sx + 6.4, py + 1, 1.8, 1.2, 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (pet.kind === "blob") {
    // mini-me: a pocket-size traveler in the pet's colors. Stands and
    // breathes idle exactly like the player — no hopping.
    const miniAv = {
      ...DEFAULT_AVATAR,
      color: pet.color,
      trim: pet.accent,
      boots: pet.boots,
      skin: "#2b1f16",
      eyeStyle: pet.eyes,
      glasses: "none" as const,
      hat: "none" as const,
      pattern: "solid" as const,
      accessory: "none" as const,
      faceDeco: (pet.blush ? "blush" : "none") as "blush" | "none",
      back: "none" as const,
      pet: { kind: "none" as const, color: pet.color, accent: pet.accent, eyes: pet.eyes, blush: pet.blush, boots: pet.boots },
    };
    const mini: Player = {
      id: "pet-mini", name: "", color: pet.color, avatar: miniAv,
      x: 0, y: 0, dir, moving: false,
    };
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(0.45, 0.45);
    ctx.translate(-sx, -sy);
    drawTraveler(ctx, mini, sx, sy, t, false, { step: 0, z: 0, crouch: false });
    ctx.restore();
  } else {
    // sprout buddy: squash-and-stretch hop
    const hop = Math.abs(Math.sin(t / 300)) * -2.5;
    const squash = 1 + Math.sin(t / 300) * 0.04;
    ctx.save();
    ctx.translate(sx, py);
    ctx.scale(2 - squash, squash);
    ctx.translate(-sx, -py);
    // feet nubs
    ctx.fillStyle = shade(pet.color, -30);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.8;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx + s * 5.5, py + 8 + hop * 0.3, 3.4, 2.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // body
    ctx.fillStyle = pet.color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(sx, py + hop * 0.5, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // belly patch
    ctx.fillStyle = pet.accent;
    ctx.beginPath();
    ctx.ellipse(sx, py + 4 + hop * 0.5, 5.5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    if (pet.kind === "sprout") {
      // stem + leafy topper
      ctx.strokeStyle = "#3e7d46";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(sx, py - 10 + hop * 0.5);
      ctx.quadraticCurveTo(sx + 1, py - 14 + hop * 0.5, sx + 3, py - 16 + hop * 0.5);
      ctx.stroke();
      ctx.fillStyle = pet.accent;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(sx + 5, py - 16 + hop * 0.5, 5, 2.8, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // eyes follow the pet's eye style, riding the hop
    const seY = py - 1 + hop * 0.5;
    ctx.lineCap = "round";
    if (pet.eyes === "happy") {
      ctx.strokeStyle = "#2b1f16";
      ctx.lineWidth = 1.7;
      for (const ex of [-3.4, 3.4]) {
        ctx.beginPath();
        ctx.arc(sx + ex + lookX * 0.5, seY, 2.1, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
    } else if (pet.eyes === "sleepy") {
      ctx.strokeStyle = "#2b1f16";
      ctx.lineWidth = 1.7;
      for (const ex of [-3.4, 3.4]) {
        ctx.beginPath();
        ctx.moveTo(sx + ex - 1.7 + lookX, seY);
        ctx.lineTo(sx + ex + 1.7 + lookX, seY);
        ctx.stroke();
      }
    } else if (pet.eyes === "wink") {
      ctx.strokeStyle = "#2b1f16";
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.moveTo(sx - 5.1 + lookX, seY);
      ctx.lineTo(sx - 1.7 + lookX, seY);
      ctx.stroke();
      ctx.fillStyle = "#2b1f16";
      ctx.beginPath();
      ctx.arc(sx + 3.4 + lookX, seY, 1.7, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "#2b1f16";
      for (const ex of [-3.4, 3.4]) {
        ctx.beginPath();
        ctx.arc(sx + ex + lookX, seY, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (pet.blush) {
      ctx.fillStyle = "rgba(232,145,156,0.85)";
      ctx.beginPath();
      ctx.ellipse(sx - 6, seY + 3.4, 1.8, 1.2, -0.2, 0, Math.PI * 2);
      ctx.ellipse(sx + 6, seY + 3.4, 1.8, 1.2, 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// Name tags + speech bubbles always draw above the world, even when the
// traveler is hidden behind a tree or a roof.
// Your own name tag is hidden (your card in the sidebar already says who
// you are) so your character stays fully visible.
//
// Coin popup timing is client-side on purpose: the server stamps
// player.coinPop with ITS clock, which can be seconds off the client's
// clock on hosted deploys (locally they're the same machine, so it always
// worked). We latch the first-seen local time per stamp instead, so the
// +n shows a full ~1.2s regardless of server/client clock skew or latency.
const coinPopLocal = new Map<string, { stamp: number; amt: number; atLocal: number; lastSeen: number }>();
function coinPopupFor(p: Player): { age: number; amt: number } | null {
  const stamp = (p as any).coinPop as number | undefined;
  if (!stamp) return null;
  const amt = (p as any).coinPopAmt || 1;
  const prev = coinPopLocal.get(p.id);
  const now = Date.now();
  if (!prev || prev.stamp !== stamp) {
    coinPopLocal.set(p.id, { stamp, amt, atLocal: now, lastSeen: now });
    if (coinPopLocal.size > 64) {
      for (const [id, entry] of coinPopLocal) {
        if (now - entry.lastSeen > 5000) {
          coinPopLocal.delete(id);
        }
      }
    }
    return { age: 0, amt };
  }
  if (prev.amt !== amt) prev.amt = amt;
  prev.lastSeen = now;
  return { age: now - prev.atLocal, amt: prev.amt };
}

function drawTravelerOverhead(
  ctx: CanvasRenderingContext2D,
  p: Player,
  sx: number, sy: number,
  isMe: boolean,
  isFriend: boolean
) {
  // name tag pill (everyone but you — yours lives in the sidebar).
  // Friends get a gold name on the same dark pill.
  if (!isMe) {
    ctx.font = "800 12px Nunito, 'Trebuchet MS', system-ui, sans-serif";
    ctx.textAlign = "center";
    const label = p.name;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(43,31,22,0.62)";
    ctx.beginPath();
    ctx.roundRect(sx - tw / 2 - 8, sy - 60, tw + 16, 21, 10);
    ctx.fill();
    ctx.fillStyle = isFriend ? "#f2c14e" : "#faf3df";
    ctx.fillText(label, sx, sy - 45);
  }

  // coin earn popup: floating gold "+n" for ~1.2s after a pickup, game
  // win or tip (server stamps player.coinPop + coinPopAmt, no chat needed)
  const popup = coinPopupFor(p);
  if (popup && popup.age < 1200) {
    const k = popup.age / 1200;
    const rise = k * 26;
    ctx.globalAlpha = 1 - k * k;
    ctx.font = "900 15px Nunito, 'Trebuchet MS', system-ui, sans-serif";
    ctx.textAlign = "center";
    const label = `+${popup.amt}`;
    const tw = ctx.measureText(label).width;
    const px = sx, py = sy - 88 - rise;
    ctx.fillStyle = "rgba(43,31,22,0.35)";
    ctx.beginPath();
    ctx.roundRect(px - tw / 2 - 10 + 2, py - 15 + 3, tw + 20, 23, 11);
    ctx.fill();
    ctx.fillStyle = "#f2c14e";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(px - tw / 2 - 10, py - 15, tw + 20, 23, 11);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.fillText(label, px, py + 2);
    ctx.globalAlpha = 1;
  }

  // speech bubble
  if (p.bubble) {
    ctx.font = "700 12px Nunito, 'Trebuchet MS', system-ui, sans-serif";
    ctx.textAlign = "center";
    const btw = Math.min(190, ctx.measureText(p.bubble).width);
    const bw = btw + 18, bh = 27;
    const bx = Math.max(4, sx - bw / 2), by = sy - 96;
    ctx.fillStyle = "rgba(43,31,22,0.25)";
    ctx.beginPath();
    ctx.roundRect(bx + 2, by + 3, bw, bh, 9);
    ctx.fill();
    ctx.fillStyle = CREAM;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 9);
    ctx.fill();
    ctx.stroke();
    // tail
    ctx.fillStyle = CREAM;
    ctx.beginPath();
    ctx.moveTo(sx - 6, by + bh - 2);
    ctx.lineTo(sx + 6, by + bh - 2);
    ctx.lineTo(sx, by + bh + 8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(sx - 6, by + bh - 2);
    ctx.lineTo(sx, by + bh + 8);
    ctx.lineTo(sx + 6, by + bh - 2);
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.fillText(p.bubble.slice(0, 32), sx, by + 18);
  }
}

// A depth-sorted prop: drawn back-to-front with players and the ball by
// ground-contact y, so you slip behind trees, houses and furniture.
export type Prop = { y: number; draw: () => void };

// ------------------------------------------------------------------- scenery
function speckle(
  ctx: CanvasRenderingContext2D,
  X: (n: number) => number, Y: (n: number) => number,
  w: number, h: number, n: number, colors: string[], r: number, seed: number
) {
  for (let i = 0; i < n; i++) {
    const px = hash2(i, seed) * w;
    const py = hash2(i, seed + 999) * h;
    ctx.fillStyle = colors[i % colors.length];
    ctx.beginPath();
    ctx.arc(X(px), Y(py), r * (0.6 + hash2(i, seed + 7) * 0.8), 0, Math.PI * 2);
    ctx.fill();
  }
}

function blob(
  ctx: CanvasRenderingContext2D,
  X: (n: number) => number, Y: (n: number) => number,
  x: number, y: number, rx: number, ry: number, color: string, alpha = 1
) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(X(x), Y(y), rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function tuft(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x - 3, y - 6 * s, x - 6, y - 9 * s);
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x, y - 7 * s, x + 1, y - 11 * s);
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + 3, y - 6 * s, x + 6, y - 9 * s);
  ctx.stroke();
}

function flower(
  ctx: CanvasRenderingContext2D, x: number, y: number, petal: string, center: string, s = 1
) {
  ctx.fillStyle = petal;
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * 3.4 * s, y + Math.sin(a) * 3.4 * s, 2.6 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = center;
  ctx.beginPath();
  ctx.arc(x, y, 2.4 * s, 0, Math.PI * 2);
  ctx.fill();
}

// timber-frame cozy cabin; collider must match (x,y,w,h)
function drawCabin(
  ctx: CanvasRenderingContext2D,
  X: (n: number) => number, Y: (n: number) => number,
  x: number, y: number, w: number, h: number,
  roof: string, sign: string
) {
  // drop shadow
  ctx.fillStyle = "rgba(43,31,22,0.25)";
  ctx.beginPath();
  ctx.roundRect(X(x) + 5, Y(y) + 8, w, h, 10);
  ctx.fill();
  // walls
  ctx.fillStyle = "#f6e8c8";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(X(x), Y(y), w, h, 8);
  ctx.fill();
  ctx.stroke();
  // timber beams
  ctx.fillStyle = "#8a5a33";
  ctx.fillRect(X(x), Y(y) + 8, w, 9);
  ctx.fillRect(X(x) + 14, Y(y), 9, h);
  ctx.fillRect(X(x) + w - 23, Y(y), 9, h);
  ctx.fillRect(X(x), Y(y) + h - 17, w, 9);
  // roof (overhangs walls)
  const rx = X(x) - 16, ry = Y(y) - 44, rw = w + 32, rh = 56;
  ctx.fillStyle = "rgba(43,31,22,0.25)";
  ctx.beginPath();
  ctx.roundRect(rx + 4, ry + 5, rw, rh, 10);
  ctx.fill();
  ctx.fillStyle = roof;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(rx, ry, rw, rh, 10);
  ctx.fill();
  ctx.stroke();
  // roof tiles
  ctx.strokeStyle = "rgba(74,55,40,0.4)";
  ctx.lineWidth = 2;
  for (let ty = ry + 16; ty < ry + rh - 4; ty += 12) {
    ctx.beginPath();
    ctx.moveTo(rx + 6, ty);
    ctx.lineTo(rx + rw - 6, ty);
    ctx.stroke();
  }
  // glowing windows
  for (const wx of [X(x) + 30, X(x) + w - 62]) {
    const wy = Y(y) + 52;
    ctx.fillStyle = "#7a4a26";
    ctx.beginPath();
    ctx.roundRect(wx - 4, wy - 4, 40, 40, 6);
    ctx.fill();
    ctx.fillStyle = "#ffd97a";
    ctx.beginPath();
    ctx.roundRect(wx, wy, 32, 32, 4);
    ctx.fill();
    ctx.strokeStyle = "#7a4a26";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(wx + 16, wy);
    ctx.lineTo(wx + 16, wy + 32);
    ctx.moveTo(wx, wy + 16);
    ctx.lineTo(wx + 32, wy + 16);
    ctx.stroke();
  }
  // arched door
  const dx = X(x) + w / 2 - 17, dy = Y(y) + h - 52;
  ctx.fillStyle = "#6b4226";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(dx, dy + 44);
  ctx.lineTo(dx, dy + 14);
  ctx.arc(dx + 17, dy + 14, 17, Math.PI, 0);
  ctx.lineTo(dx + 34, dy + 44);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f2c14e";
  ctx.beginPath();
  ctx.arc(dx + 25, dy + 28, 3, 0, Math.PI * 2);
  ctx.fill();
  // hanging sign
  const sw = 30 + sign.length * 8.4;
  const sxx = X(x) + w / 2 - sw / 2, syy = Y(y) - 26;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(X(x) + w / 2 - sw / 4, Y(y) - 44);
  ctx.lineTo(X(x) + w / 2 - sw / 4, syy);
  ctx.moveTo(X(x) + w / 2 + sw / 4, Y(y) - 44);
  ctx.lineTo(X(x) + w / 2 + sw / 4, syy);
  ctx.stroke();
  ctx.fillStyle = "#5d3a1e";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(sxx, syy, sw, 24, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#faf3df";
  ctx.font = "800 13px Nunito, 'Trebuchet MS', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(sign, X(x) + w / 2, syy + 17);
}

function drawTree(
  ctx: CanvasRenderingContext2D,
  X: (n: number) => number, Y: (n: number) => number,
  tx: number, ty: number, t: number, apples: boolean
) {
  ctx.fillStyle = "rgba(43,31,22,0.22)";
  ctx.beginPath();
  ctx.ellipse(X(tx), Y(ty) + 22, 30, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  // trunk
  ctx.fillStyle = "#7a4a26";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(X(tx) - 8, Y(ty) - 6, 16, 30, 6);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(43,31,22,0.45)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(X(tx) - 2, Y(ty));
  ctx.lineTo(X(tx) - 3, Y(ty) + 18);
  ctx.stroke();
  // canopy blobs
  const sway = Math.sin(t / 1400 + tx) * 1.6;
  const layers: [number, number, number, string][] = [
    [0, -34, 30, "#3e7d46"],
    [-20, -22, 22, "#4c9a52"],
    [20, -22, 22, "#4c9a52"],
    [0, -14, 24, "#6fbf73"],
  ];
  for (const [ox, oy, rr, col] of layers) {
    ctx.fillStyle = col;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(X(tx) + ox + sway, Y(ty) + oy, rr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.beginPath();
  ctx.arc(X(tx) - 12 + sway, Y(ty) - 30, 9, 0, Math.PI * 2);
  ctx.fill();
  if (apples) {
    for (const [ax, ay] of [[-16, -18], [10, -26], [2, -10]] as const) {
      ctx.fillStyle = "#d95f4b";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(X(tx) + ax + sway, Y(ty) + ay, 4.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      ctx.arc(X(tx) + ax + sway - 1.2, Y(ty) + ay - 1.2, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawFountain(
  ctx: CanvasRenderingContext2D,
  X: (n: number) => number, Y: (n: number) => number,
  t: number
) {
  const cx = X(800), cy = Y(550);
  ctx.fillStyle = "rgba(43,31,22,0.22)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + 56, 108, 20, 0, 0, Math.PI * 2);
  ctx.fill();
  // outer stone ring (sits clear of the basin ellipse below)
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    ctx.fillStyle = k % 2 ? "#b8b2a7" : "#a39d90";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * 100, cy + 18 + Math.sin(a) * 66, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // basin
  ctx.fillStyle = "#8f8a80";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 18, 82, 52, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // water
  ctx.fillStyle = "#6fd3ef";
  ctx.beginPath();
  ctx.ellipse(cx, cy + 14, 68, 40, 0, 0, Math.PI * 2);
  ctx.fill();
  // expanding ripples
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 3; i++) {
    const ph = ((t / 1400) + i / 3) % 1;
    ctx.globalAlpha = 0.7 * (1 - ph);
    ctx.beginPath();
    ctx.ellipse(cx, cy + 14, 12 + ph * 52, 8 + ph * 30, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // center column + bowl
  ctx.fillStyle = "#b8b2a7";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(cx - 11, cy - 52, 22, 62, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#c9c2b4";
  ctx.beginPath();
  ctx.ellipse(cx, cy - 54, 30, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // spout water
  ctx.fillStyle = "rgba(111,211,239,0.9)";
  ctx.fillRect(cx - 3, cy - 84, 6, 32);
  for (let i = 0; i < 5; i++) {
    const dy = ((t / 16 + i * 23) % 70);
    ctx.globalAlpha = 0.85 * (1 - dy / 70);
    ctx.fillRect(cx - 9 + hash2(i, 3) * 18 - 6, cy - 88 - dy * 0.35, 3, 7);
  }
  ctx.globalAlpha = 1;
}

// Wooden park bench (110x36 collider, wider for the pitch stands). Slatted
// seat + low backrest on the north edge — you sit facing south.
function drawBench(
  ctx: CanvasRenderingContext2D,
  X: (n: number) => number, Y: (n: number) => number,
  x: number, y: number, w = 110
) {
  const sx = X(x), sy = Y(y), h = 36;
  ctx.fillStyle = "rgba(43,31,22,0.22)";
  ctx.beginPath();
  ctx.ellipse(sx + w / 2, sy + h, w / 2, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  // iron legs
  ctx.fillStyle = "#4e3018";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  for (const lx of [sx + 12, sx + w - 26]) {
    ctx.beginPath();
    ctx.roundRect(lx, sy + h - 12, 14, 14, 4);
    ctx.fill();
    ctx.stroke();
  }
  // seat slats
  ctx.fillStyle = "#b3814d";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(sx, sy, w, h - 10, 8);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(74,55,40,0.55)";
  ctx.lineWidth = 2;
  for (const off of [9, 17]) {
    ctx.beginPath();
    ctx.moveTo(sx + 6, sy + off);
    ctx.lineTo(sx + w - 6, sy + off);
    ctx.stroke();
  }
  // backrest (north edge, two posts + top rail — sitters face the path)
  ctx.fillStyle = "#8a5a33";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  for (const px of [sx + 8, sx + w - 16]) {
    ctx.beginPath();
    ctx.roundRect(px, sy - 8, 8, 16, 3);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = "#a06a3b";
  ctx.beginPath();
  ctx.roundRect(sx + 2, sy - 12, w - 4, 10, 5);
  ctx.fill();
  ctx.stroke();
}

// Open social deck (replaces the old SHOP cabin): big wooden platform with
// stairs on the south side, hedges around, four small square tables with
// wooden chairs left + right. Platform + stairs are flat ground paint
// (walkable — no elevation in collide()); hedges + tables are the blockers.
function drawDeckGround(
  ctx: CanvasRenderingContext2D,
  X: (n: number) => number, Y: (n: number) => number
) {
  const D = DECK, S = DECK_STAIRS;
  // drop shadow so the platform lifts off the grass
  ctx.fillStyle = "rgba(43,31,22,0.25)";
  ctx.beginPath();
  ctx.roundRect(X(D.x) + 5, Y(D.y) + 8, D.w, D.h, 12);
  ctx.fill();
  // wooden base
  ctx.fillStyle = "#a06a3b";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(X(D.x), Y(D.y), D.w, D.h, 12);
  ctx.fill();
  ctx.stroke();
  // planks (horizontal boards + butt joints), clipped to the deck
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(X(D.x), Y(D.y), D.w, D.h, 12);
  ctx.clip();
  ctx.strokeStyle = "rgba(74,55,40,0.45)";
  ctx.lineWidth = 2;
  for (let py = D.y + 26; py < D.y + D.h; py += 26) {
    ctx.beginPath();
    ctx.moveTo(X(D.x), Y(py));
    ctx.lineTo(X(D.x + D.w), Y(py));
    ctx.stroke();
  }
  for (let i = 0; i < 10; i++) {
    const gx = D.x + hash2(i, 77) * D.w;
    const gy = D.y + Math.floor(hash2(i, 78) * ((D.h - 20) / 26)) * 26;
    ctx.beginPath();
    ctx.moveTo(X(gx), Y(gy));
    ctx.lineTo(X(gx), Y(gy + 26));
    ctx.stroke();
  }
  ctx.restore();
  // skirt boards around the rim (front face reads as raised platform)
  ctx.fillStyle = "#7d5230";
  ctx.fillRect(X(D.x + 8), Y(D.y + D.h - 12), D.w - 16, 10);
  // stairs: three wooden steps dropping south past the hedge gap
  for (let k = 0; k < 3; k++) {
    const sy = D.y + D.h - 6 + k * 10;
    const inset = k * 4;
    ctx.fillStyle = k % 2 ? "#b3814d" : "#a06a3b";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(X(S.x + inset), Y(sy), S.w - inset * 2, 12, 4);
    ctx.fill();
    ctx.stroke();
  }
}

function drawDeckHedge(
  ctx: CanvasRenderingContext2D,
  X: (n: number) => number, Y: (n: number) => number,
  x: number, y: number, w: number, h: number, seed: number
) {
  // soil bed under the leaves
  ctx.fillStyle = "#6b4226";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(X(x), Y(y), w, h, 9);
  ctx.fill();
  ctx.stroke();
  // leafy puffs along the bed: horizontal beds spread along x, vertical
  // beds (the deck's west/east sides) spread along y so they don't all
  // pile up in one spot.
  const vertical = h > w;
  const span = vertical ? h : w;
  const n = Math.max(3, Math.floor(span / 34));
  for (let i = 0; i < n; i++) {
    const along = (span * (i + 0.5)) / n;
    const px = vertical ? x + w / 2 : x + along;
    const py = vertical ? y + along : y + h / 2;
    const r = 13 + hash2(i, seed) * 5;
    ctx.fillStyle = i % 2 ? "#4c9a52" : "#3e7d46";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(X(px), Y(py - 4), r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.beginPath();
    ctx.arc(X(px) - r * 0.3, Y(py - 4) - r * 0.3, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDeckTable(
  ctx: CanvasRenderingContext2D,
  X: (n: number) => number, Y: (n: number) => number,
  x: number, y: number, w: number, h: number
) {
  const sx = X(x), sy = Y(y);
  const cx = sx + w / 2, cy = sy + h / 2;
  ctx.fillStyle = "rgba(43,31,22,0.28)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + h / 2, w / 2 + 4, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  // stubby legs
  ctx.fillStyle = "#5d3a1e";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  for (const [lx, ly] of [[sx + 6, sy + h - 6], [sx + w - 6, sy + h - 6]] as const) {
    ctx.beginPath();
    ctx.roundRect(lx - 2.5, ly, 5, 12, 2);
    ctx.fill();
    ctx.stroke();
  }
  // square wooden top with plank line + grain
  ctx.fillStyle = "#c99a5e";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(sx, sy, w, h, 7);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(74,55,40,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx + 6, sy + h / 2);
  ctx.lineTo(sx + w - 6, sy + h / 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath();
  ctx.roundRect(sx + 6, sy + 5, w - 12, 6, 3);
  ctx.fill();
}

function drawDeckChair(
  ctx: CanvasRenderingContext2D,
  X: (n: number) => number, Y: (n: number) => number,
  x: number, y: number, face: "left" | "right"
) {
  const sx = X(x), sy = Y(y);
  ctx.fillStyle = "rgba(43,31,22,0.2)";
  ctx.beginPath();
  ctx.ellipse(sx, sy + 12, 15, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // four legs
  ctx.fillStyle = "#5d3a1e";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  for (const [ox, oy] of [[-10, -6], [10, -6], [-10, 8], [10, 8]] as const) {
    ctx.beginPath();
    ctx.roundRect(sx + ox - 2, sy + oy, 4, 12, 2);
    ctx.fill();
    ctx.stroke();
  }
  // square seat
  ctx.fillStyle = "#8a5a33";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(sx - 13, sy - 10, 26, 22, 6);
  ctx.fill();
  ctx.stroke();
  // backrest on the outer side (away from the table)
  ctx.fillStyle = "#a06a3b";
  const bx = face === "left" ? sx - 16 : sx + 16 - 8;
  ctx.beginPath();
  ctx.roundRect(bx, sy - 14, 8, 26, 3);
  ctx.fill();
  ctx.stroke();
}

// Simple football pitch (PLAZA_FIELD). Flat ground paint — mowed stripes,
// white markings, little goals at each end. Fully walkable: no colliders,
// the ball rolls free. A proper football minigame can build on this later.
function drawFootballField(
  ctx: CanvasRenderingContext2D,
  X: (n: number) => number, Y: (n: number) => number
) {
  const F = PLAZA_FIELD;
  const midY = F.y + F.h / 2;
  // mowed stripes — vertical bands, like a real pitch seen from the side
  ctx.save();
  ctx.beginPath();
  ctx.rect(X(F.x), Y(F.y), F.w, F.h);
  ctx.clip();
  for (let i = 0, xx = F.x; xx < F.x + F.w; i++, xx += 40) {
    ctx.fillStyle = i % 2 ? "#74bd6133" : "#ffffff14";
    ctx.fillRect(X(xx), Y(F.y), Math.min(40, F.x + F.w - xx), F.h);
  }
  ctx.restore();
  // chalk markings
  ctx.strokeStyle = "#faf3df";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.roundRect(X(F.x + 6), Y(F.y + 6), F.w - 12, F.h - 12, 6);
  ctx.stroke();
  // halfway line
  ctx.beginPath();
  ctx.moveTo(X(F.x + F.w / 2), Y(F.y + 6));
  ctx.lineTo(X(F.x + F.w / 2), Y(F.y + F.h - 6));
  ctx.stroke();
  // centre circle + spot
  ctx.beginPath();
  ctx.arc(X(F.x + F.w / 2), Y(midY), 34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#faf3df";
  ctx.beginPath();
  ctx.arc(X(F.x + F.w / 2), Y(midY), 4, 0, Math.PI * 2);
  ctx.fill();
  // penalty boxes at each end
  for (const left of [true, false]) {
    const bx = left ? F.x + 6 : F.x + F.w - 6 - 56;
    ctx.strokeRect(X(bx), Y(midY - 60), 56, 120);
  }
  // little goals just outside each end line
  for (const left of [true, false]) {
    const gx = left ? F.x - 26 : F.x + F.w;
    ctx.fillStyle = "rgba(43,31,22,0.18)";
    ctx.beginPath();
    ctx.ellipse(X(gx + 13), Y(midY + 30), 15, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e8e2d2";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(X(gx), Y(midY - 28), 26, 56, 4);
    ctx.fill();
    ctx.stroke();
    // net mesh
    ctx.strokeStyle = "rgba(74,55,40,0.45)";
    ctx.lineWidth = 1.5;
    for (let k = 1; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(X(gx + k * 6.5), Y(midY - 28));
      ctx.lineTo(X(gx + k * 6.5), Y(midY + 28));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(X(gx), Y(midY));
    ctx.lineTo(X(gx + 26), Y(midY));
    ctx.stroke();
  }
}

// Toy-car race arena (RACE_AREA): lighter grass with no border, oval black
// loop wide enough for three cars abreast, checkered start/finish on the
// south straight + small black tire dots ringing the middle. The tires +
// the arena edge are car-only walls (players walk free); the tires force a
// real loop so grass-cutting to the line never counts.
// Car + joystick art echoes public/lobby/car.svg + joystick.svg, redrawn
// top-view in the cozy ink style so they tint per driver color.
// The flag registers as a depth prop so cars pass behind it properly;
// the tires are flat ground paint, underneath everything.
// Static race-arena ground, pre-rendered once to an offscreen canvas:
// repainting the fat ellipse strokes (76px + 68px), the full-loop dashed
// line and the 24 tires every frame cost real fill-rate up close, and none
// of it ever moves. Served as one drawImage; the waving flag stays a live
// prop below.
const RACE_CACHE_SS = 2;
const RACE_CACHE_PAD = 8;
let raceCache: HTMLCanvasElement | null = null;
function paintRaceGround(ctx: CanvasRenderingContext2D) {
  const A = RACE_AREA, T = RACE_TRACK;
  const X = (n: number) => n - (A.x - RACE_CACHE_PAD);
  const Y = (n: number) => n - (A.y - RACE_CACHE_PAD);
  // lighter grass arena (borderless — melts into the plaza lawn)
  ctx.fillStyle = "#9bd985";
  ctx.beginPath();
  ctx.roundRect(X(A.x), Y(A.y), A.w, A.h, 18);
  ctx.fill();
  // mowed ring inside the arena (kept off the blacktop)
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(X(A.x), Y(A.y), A.w, A.h, 18);
  ctx.clip();
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.06)" : "rgba(62,125,70,0.08)";
    ctx.fillRect(X(A.x + (i * A.w) / 5), Y(A.y), A.w / 5, A.h);
  }
  ctx.restore();
  const cx = X(T.cx), cy = Y(T.cy);
  // black loop: thick stroked ellipse (outer edge inked, asphalt filled)
  ctx.lineCap = "round";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 76;
  ctx.beginPath();
  ctx.ellipse(cx, cy, (T.outRx + T.inRx) / 2, (T.outRy + T.inRy) / 2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "#33333d";
  ctx.lineWidth = 68;
  ctx.beginPath();
  ctx.ellipse(cx, cy, (T.outRx + T.inRx) / 2, (T.outRy + T.inRy) / 2, 0, 0, Math.PI * 2);
  ctx.stroke();
  // dashed cream center line
  ctx.strokeStyle = "rgba(250,243,223,0.85)";
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 10]);
  ctx.beginPath();
  ctx.ellipse(cx, cy, (T.outRx + T.inRx) / 2, (T.outRy + T.inRy) / 2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // small black tire dots ringing the middle (the car-only bumper the
  // server bounces you off): plain ground paint, underneath cars and
  // players. The ring sits fully inside the middle, clear of the track;
  // same-size dots with gaps so none overlap.
  ctx.fillStyle = "#2b2b33";
  {
    const gRx = T.inRx - 14, gRy = T.inRy - 14, TIRES = 24;
    for (let i = 0; i < TIRES; i++) {
      const a = (i / TIRES) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(X(T.cx + Math.cos(a) * gRx), Y(T.cy + Math.sin(a) * gRy), 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // start/finish checker line across the south straight: a vertical strip
  // perpendicular to travel, spanning the full track width (inner edge to
  // outer edge) so every lane crosses it.
  const lx = X(T.cx);
  const lyTop = Y(T.cy + T.inRy), lyBot = Y(T.cy + T.outRy);
  const lw = 14, rows = 9;
  const ch = (lyBot - lyTop) / rows;
  ctx.fillStyle = "#faf3df";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.rect(lx - lw / 2, lyTop, lw, lyBot - lyTop);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#2b2b33";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 2; c++) {
      if ((r + c) % 2 === 0) {
        ctx.fillRect(lx - lw / 2 + c * (lw / 2), lyTop + r * ch, lw / 2, ch);
      }
    }
  }
}

function raceGround(): HTMLCanvasElement {
  if (!raceCache) {
    const A = RACE_AREA;
    const c = document.createElement("canvas");
    c.width = Math.ceil((A.w + RACE_CACHE_PAD * 2) * RACE_CACHE_SS);
    c.height = Math.ceil((A.h + RACE_CACHE_PAD * 2) * RACE_CACHE_SS);
    const g = c.getContext("2d")!;
    g.scale(RACE_CACHE_SS, RACE_CACHE_SS);
    paintRaceGround(g);
    raceCache = c;
  }
  return raceCache;
}

function drawRaceTrack(
  ctx: CanvasRenderingContext2D,
  X: (n: number) => number, Y: (n: number) => number,
  t: number,
  props: Prop[]
) {
  const A = RACE_AREA, T = RACE_TRACK;
  const cache = raceGround();
  ctx.drawImage(
    cache,
    X(A.x - RACE_CACHE_PAD), Y(A.y - RACE_CACHE_PAD),
    A.w + RACE_CACHE_PAD * 2, A.h + RACE_CACHE_PAD * 2
  );
  // checkered flag on the grass below the track, beside the line — a real
  // prop (not ground paint) so cars pass behind its pole.
  {
    const fwx = T.cx + 28, fwy = T.cy + T.outRy + 12;
    props.push({
      y: fwy + 10, draw: () => {
        const fx = X(fwx), fy = Y(fwy);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(fx, fy + 10);
        ctx.lineTo(fx, fy - 16);
        ctx.stroke();
        const wave = Math.sin(t / 300) * 2;
        ctx.fillStyle = "#faf3df";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.rect(fx, fy - 16, 18 + wave, 11);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#2b2b33";
        ctx.fillRect(fx + ((0 + wave) % 2), fy - 16, 4.5, 5.5);
        ctx.fillRect(fx + 9, fy - 16, 4.5, 5.5);
        ctx.fillRect(fx + 4.5, fy - 10.5, 4.5, 5.5);
        ctx.fillRect(fx + 13.5 + wave * 0.3, fy - 10.5, 4.5, 5.5);
      },
    });
  }
}

// Top-view toy car (driver color body, cream stripe, dark windshield).
function drawRaceCar(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, angle: number, color: string, t: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // shadow
  ctx.fillStyle = "rgba(43,31,22,0.28)";
  ctx.beginPath();
  ctx.ellipse(2, 3, 16, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  // wheels
  ctx.fillStyle = "#2b2b33";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  for (const [wx, wy] of [[-8, -11], [8, -11], [-8, 11], [8, 11]] as const) {
    ctx.beginPath();
    ctx.roundRect(wx - 5, wy - 3.5, 10, 7, 2.5);
    ctx.fill();
    ctx.stroke();
  }
  // body
  ctx.fillStyle = color;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(-15, -8, 30, 16, 6);
  ctx.fill();
  ctx.stroke();
  // nose stripe + cockpit
  ctx.fillStyle = "rgba(250,243,223,0.9)";
  ctx.fillRect(-2, -6, 4, 12);
  ctx.fillStyle = "#233043";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-4, -5.5, 9, 11, 4);
  ctx.fill();
  ctx.stroke();
  // headlights
  ctx.fillStyle = "#ffe9a8";
  ctx.beginPath();
  ctx.arc(15, -4.5, 2.2, 0, Math.PI * 2);
  ctx.arc(15, 4.5, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Joystick pickup / held stick: round base + ball top in the driver color
// (ground version casts a shadow; held version is compact for the torso).
// seed pins the idle wobble phase to the world (NOT the screen x — that made
// loose sticks vibrate whenever the camera moved).
function drawJoystick(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, color: string, held: boolean, t: number, seed = 0
) {
  if (!held) {
    ctx.fillStyle = "rgba(43,31,22,0.25)";
    ctx.beginPath();
    ctx.ellipse(x, y + 10, 13, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const s = held ? 0.62 : 1;
  const wob = held ? 0 : Math.sin(t / 600 + seed) * 1.2;
  // base
  ctx.fillStyle = "#5d3a1e";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(x - 11 * s, y - 2 * s, 22 * s, 12 * s, 5 * s);
  ctx.fill();
  ctx.stroke();
  // stick
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4 * s;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y - 2 * s);
  ctx.lineTo(x + wob, y - 14 * s);
  ctx.stroke();
  ctx.strokeStyle = "#b8b2a7";
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(x, y - 2 * s);
  ctx.lineTo(x + wob, y - 14 * s);
  ctx.stroke();
  // ball top (driver color) + button dot
  ctx.fillStyle = color;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(x + wob, y - 18 * s, 7 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.arc(x + wob - 2 * s, y - 20 * s, 2 * s, 0, Math.PI * 2);
  ctx.fill();
}

// Wooden post fence along the world edge. Every post and rail registers its
// own depth so the fence correctly covers you when you hug the bottom edge.
function drawFence(
  ctx: CanvasRenderingContext2D,
  X: (n: number) => number, Y: (n: number) => number,
  w: number, h: number, skipBottom: boolean, props: Prop[],
  // world y where the side runs stop (beach: above the water — fence posts
  // don't belong in the sea; the invisible edge colliders still hold you in)
  sideBottom?: number
) {
  ctx.strokeStyle = INK;
  const post = (px: number, py: number) => {
    ctx.fillStyle = "#8a5a33";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(X(px) - 5, Y(py) - 26, 10, 28, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#b3814d";
    ctx.beginPath();
    ctx.arc(X(px), Y(py) - 26, 5, Math.PI, 0);
    ctx.fill();
  };
  const rail = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.strokeStyle = "#8a5a33";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(X(x1), Y(y1));
    ctx.lineTo(X(x2), Y(y2));
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(X(x1), Y(y1) - 3);
    ctx.lineTo(X(x2), Y(y2) - 3);
    ctx.stroke();
  };
  const step = 64, m = 14;
  // horizontal runs: posts and rails depth-sorted per segment
  for (let x = m; x <= w - m; x += step) {
    const px = x;
    props.push({ y: m + 14, draw: () => post(px, m + 12) });
    if (!skipBottom) props.push({ y: h - m + 2, draw: () => post(px, h - m) });
  }
  for (let x = m; x + step <= w - m + step; x += step) {
    const ax = x, bx = Math.min(x + step, w - m);
    if (bx <= ax) break;
    props.push({ y: m + 24, draw: () => rail(ax, m + 20, bx, m + 20) });
    if (!skipBottom) props.push({ y: h - m + 12, draw: () => rail(ax, h - m + 8, bx, h - m + 8) });
  }
  // side runs: posts plus per-gap rail segments (optionally cut short —
  // the last post reads as the end of the line, rope tied off)
  const sideEnd = sideBottom ?? h - m;
  for (let y = m + step; y <= sideEnd; y += step) {
    const py = y;
    props.push({ y: py + 2, draw: () => { post(m, py); post(w - m, py); } });
  }
  for (let y = m + step; y + step <= sideEnd; y += step) {
    const y1 = y, y2 = y + step, mid = y + step / 2 + 8;
    props.push({ y: mid, draw: () => rail(m + 2, y1 + 8, m + 2, y2 + 8) });
    props.push({ y: mid, draw: () => rail(w - m + 2, y1 + 8, w - m + 2, y2 + 8) });
  }
}

// ---------------------------------------------------------------------- maps
// ---- shared air hockey table painter (table-unit space, 200x140) ----
// The room (drawMap, world scale) and the player window (modal canvas,
// rotated so your goal is at the bottom) render through these, so the two
// tables can never drift apart. Callers set the transform first; everything
// below is in table units, including line widths. Origin = table corner.
export function paintAhTable(ctx: CanvasRenderingContext2D) {
  // wooden rails
  ctx.fillStyle = "#8a5a33";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(0, 0, 200, 140, 16);
  ctx.fill();
  ctx.stroke();
  // corner screws
  ctx.fillStyle = "#5d3a1e";
  for (const [cxo, cyo] of [[14, 14], [186, 14], [14, 126], [186, 126]] as const) {
    ctx.beginPath();
    ctx.arc(cxo, cyo, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // rink surface
  const rg = ctx.createLinearGradient(0, 12, 0, 128);
  rg.addColorStop(0, "#eef7ff");
  rg.addColorStop(1, "#cfe7f7");
  ctx.fillStyle = rg;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(12, 12, 176, 116, 10);
  ctx.fill();
  ctx.stroke();
  // center line + faceoff circle
  ctx.strokeStyle = "#d95f4b";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(100, 17);
  ctx.lineTo(100, 123);
  ctx.stroke();
  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(100, 70, 17, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#d95f4b";
  ctx.beginPath();
  ctx.arc(100, 70, 3, 0, Math.PI * 2);
  ctx.fill();
  // goals: dark slots centered on the short rails
  ctx.fillStyle = "#2b1f16";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  for (const gx of [10, 184]) {
    ctx.beginPath();
    ctx.roundRect(gx, 55, 6, 30, 3);
    ctx.fill();
    ctx.stroke();
  }
}

export function paintAhPieces(
  ctx: CanvasRenderingContext2D,
  m1: { x: number; y: number },
  m2: { x: number; y: number },
  pk: { x: number; y: number } | null,
) {
  if (pk) {
    ctx.fillStyle = "#2b1f16";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pk.x, pk.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.arc(pk.x - 1.2, pk.y - 1.2, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  const mallet = (mx: number, my: number, col: string) => {
    ctx.fillStyle = col;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(mx, my, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#faf3df";
    ctx.beginPath();
    ctx.arc(mx, my, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(43,31,22,0.5)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
  };
  mallet(m1.x, m1.y, "#d95f4b");
  mallet(m2.x, m2.y, "#3b82f6");
}

function drawMap(ctx: CanvasRenderingContext2D, mapId: string, camX: number, camY: number, vw: number, vh: number, t: number, props: Prop[], tvOn: boolean, board: BoardState | null = null, snakeBusy = false, pongBusy = false, ahState: AhState = null) {
  const map = MAPS[mapId] || MAPS.plaza;
  const X = (x: number) => x - camX;
  const Y = (y: number) => y - camY;

  // void outside the world
  ctx.fillStyle = "#241a12";
  ctx.fillRect(0, 0, vw, vh);

  ctx.save();
  ctx.beginPath();
  ctx.rect(X(0), Y(0), map.width, map.height);
  ctx.clip();

  if (mapId === "beach") {
    // sand
    ctx.fillStyle = "#f4df9f";
    ctx.fillRect(X(0), Y(0), map.width, map.height);
    blob(ctx, X, Y, 400, 500, 260, 150, "#eed189", 0.7);
    blob(ctx, X, Y, 1150, 600, 300, 170, "#f9ecc0", 0.8);
    blob(ctx, X, Y, 800, 200, 320, 140, "#f9ecc0", 0.6);
    speckle(ctx, X, Y, map.width, 900, 220, ["#e3c67f", "#d9b96c", "#f9ecc0"], 2.2, 11);
    // sand ripples
    ctx.strokeStyle = "rgba(190,150,90,0.5)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      const rx = hash2(i, 21) * map.width, ry = hash2(i, 22) * 850;
      ctx.beginPath();
      ctx.arc(X(rx), Y(ry), 14 + hash2(i, 23) * 14, 0.3, Math.PI - 0.3);
      ctx.stroke();
    }
    // (No painted shells/starfish anymore — the beach is scattered with
    // real pink shells instead: grabbable little carryables, see drawShell.)
    // sea: bright through the shallows, then a short steep descent into the
    // gloom — still one continuous gradient (no hard line), but the deep
    // reads clearly darker. (BEACH_DEEP_Y sits right at the top of the drop.)
    const sea = ctx.createLinearGradient(0, Y(BEACH_WATER_Y), 0, Y(1200));
    sea.addColorStop(0, "#7ad9f5");
    sea.addColorStop(0.5, "#46b7e6");
    sea.addColorStop(0.68, "#2b7fb6");
    sea.addColorStop(1, "#18517f");
    ctx.fillStyle = sea;
    ctx.fillRect(X(0), Y(BEACH_WATER_Y), map.width, 1200 - BEACH_WATER_Y);
    // shoreline foam: one thin irregular curve (layered slow sines, gently
    // drifting) plus sparse small flecks below it — no band, no chain
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let x = 0; x <= map.width; x += 8) {
      const wy = BEACH_WATER_Y + 1
        + Math.sin(x / 130) * 5
        + Math.sin(x / 47 + 1.7) * 3
        + Math.sin(t / 1100 + x / 210) * 2.5;
      if (x === 0) ctx.moveTo(X(x), Y(wy));
      else ctx.lineTo(X(x), Y(wy));
    }
    ctx.stroke();
    for (let i = 0; i < 70; i++) {
      const fx = hash2(i, 91) * map.width;
      const fy = BEACH_WATER_Y + 5 + hash2(i, 92) * 24;
      const r = 1 + hash2(i, 93) * 2.2;
      const tw = 0.22 + 0.3 * Math.abs(Math.sin(t / 850 + hash2(i, 94) * 6.3));
      ctx.fillStyle = `rgba(255,255,255,${tw.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(X(fx), Y(fy), r, 0, Math.PI * 2);
      ctx.fill();
    }
    // travelling wave streaks
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (let i = 0; i < 12; i++) {
      const wy = 950 + hash2(i, 41) * 220;
      const wx = ((hash2(i, 42) * map.width + t / 60) % (map.width + 240)) - 120;
      ctx.beginPath();
      ctx.moveTo(X(wx), Y(wy));
      ctx.lineTo(X(wx) + 56, Y(wy));
      ctx.stroke();
    }
    // rocks (depth-sorted)
    for (const [rx, ry, rw, rh] of [[200, 200, 180, 120], [1250, 250, 160, 110]] as const) props.push({
      y: ry + rh, draw: () => {
      ctx.fillStyle = "rgba(43,31,22,0.22)";
      ctx.beginPath();
      ctx.ellipse(X(rx) + rw / 2, Y(ry) + rh, rw / 2, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#9a938a";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(X(rx), Y(ry), rw, rh, 30);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#b7b0a4";
      ctx.beginPath();
      ctx.roundRect(X(rx) + 16, Y(ry) + 12, rw - 64, rh - 52, 20);
      ctx.fill();
      ctx.fillStyle = "#6fbf73";
      ctx.beginPath();
      ctx.ellipse(X(rx) + rw - 44, Y(ry) + 22, 22, 10, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(74,55,40,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(X(rx) + 30, Y(ry) + rh - 18);
      ctx.lineTo(X(rx) + 70, Y(ry) + 30);
      ctx.stroke();
      },
    });
    // palms (depth-sorted)
    for (const [tx, ty] of PALMS_POS) props.push({
      y: ty + 42, draw: () => {
      ctx.fillStyle = "rgba(43,31,22,0.2)";
      ctx.beginPath();
      ctx.ellipse(X(tx), Y(ty) + 42, 26, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.fillStyle = "#8a5a33";
      ctx.beginPath();
      ctx.moveTo(X(tx) - 7, Y(ty) + 40);
      ctx.quadraticCurveTo(X(tx) - 12, Y(ty) + 10, X(tx) - 2, Y(ty) - 6);
      ctx.lineTo(X(tx) + 10, Y(ty) - 4);
      ctx.quadraticCurveTo(X(tx) + 2, Y(ty) + 12, X(tx) + 7, Y(ty) + 40);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      const sway = Math.sin(t / 1200 + tx) * 3;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.3;
        ctx.fillStyle = k % 2 ? "#4c9a52" : "#3e7d46";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(X(tx) + Math.cos(a) * 26 + sway, Y(ty) - 8 + Math.sin(a) * 13, 22, 8, a, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = "#6b4226";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      for (const [ox, oy] of [[-7, 2], [7, 3], [0, 9]] as const) {
        ctx.beginPath();
        ctx.arc(X(tx) + ox, Y(ty) + oy, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      },
    });
    // log benches (ground layer — walkable, never cover you)
    {
      const fx0 = X(800), fy0 = Y(450);
      for (const bx of [fx0 - 92, fx0 + 92]) {
        ctx.fillStyle = "#8a5a33";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(bx - 34, fy0 + 18, 68, 20, 10);
        ctx.fill();
        ctx.stroke();
      }
    }
    // campfire (depth-sorted)
    props.push({
      y: 488, draw: () => {
        const fx = X(800), fy = Y(450);
    ctx.fillStyle = "rgba(43,31,22,0.2)";
    ctx.beginPath();
    ctx.ellipse(fx, fy + 26, 46, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      ctx.fillStyle = k % 2 ? "#9a938a" : "#7d766c";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(fx + Math.cos(a) * 28, fy + 8 + Math.sin(a) * 18, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    for (const [lx, lrot] of [[-14, 0.5], [14, -0.5], [0, 1.2]] as const) {
      ctx.save();
      ctx.translate(fx + lx * 0.4, fy + 6);
      ctx.rotate(lrot);
      ctx.fillStyle = "#6b4226";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-20, -6, 40, 12, 6);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    // glow + flame
    const flick = Math.sin(t / 130) * 2 + Math.sin(t / 47) * 1.2;
    const glow = ctx.createRadialGradient(fx, fy, 4, fx, fy, 64);
    glow.addColorStop(0, "rgba(251,191,36,0.55)");
    glow.addColorStop(1, "rgba(251,191,36,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(fx, fy, 64, 0, Math.PI * 2);
    ctx.fill();
    const flame = (r: number, color: string, hgt: number, dx: number) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(fx - r + dx, fy + 6);
      ctx.quadraticCurveTo(fx - r + dx, fy - hgt * 0.5, fx + dx + flick * 0.4, fy - hgt);
      ctx.quadraticCurveTo(fx + r + dx, fy - hgt * 0.5, fx + r + dx, fy + 6);
      ctx.quadraticCurveTo(fx + dx, fy + 12, fx - r + dx, fy + 6);
      ctx.fill();
    };
    flame(15, "#f97316", 34 + flick, 0);
    flame(10, "#fbbf24", 26 + flick * 0.7, 1);
    flame(5.5, "#fff7d6", 17 + flick * 0.5, -1);
    // embers
    for (let i = 0; i < 8; i++) {
      const ph = ((t / 900) + hash2(i, 51) * 1.4) % 1;
      ctx.globalAlpha = 0.9 * (1 - ph);
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(fx + (hash2(i, 52) - 0.5) * 30 * ph, fy - 10 - ph * 60, 2.4 * (1 - ph) + 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
      },
    });
    // rope fence on land edges
    // side fences stop on the sand — the map-edge colliders (invisible,
    // full-height) keep you from slipping out through the water
    drawFence(ctx, X, Y, map.width, map.height, true, props, BEACH_WATER_Y - 30);
  } else if (mapId === "arcade") {
    // --- cozy cabin game room ---
    ctx.fillStyle = "#a06a3b";
    ctx.fillRect(X(0), Y(0), map.width, map.height);
    // planks
    ctx.strokeStyle = "rgba(74,55,40,0.45)";
    ctx.lineWidth = 2;
    for (let py = 96; py < map.height; py += 34) {
      ctx.beginPath();
      ctx.moveTo(X(0), Y(py));
      ctx.lineTo(X(map.width), Y(py));
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const gx = hash2(i, py) * map.width;
        ctx.beginPath();
        ctx.moveTo(X(gx), Y(py));
        ctx.lineTo(X(gx), Y(py) + 34);
        ctx.stroke();
      }
    }
    speckle(ctx, X, Y, map.width, map.height, 60, ["#8f5c30"], 1.6, 61);
    // back wall
    ctx.fillStyle = "#6b4226";
    ctx.fillRect(X(0), Y(0), map.width, 96);
    ctx.fillStyle = "#7d5230";
    for (let wx = 0; wx < map.width; wx += 48) ctx.fillRect(X(wx), Y(0), 24, 96);
    ctx.fillStyle = "#4e3018";
    ctx.fillRect(X(0), Y(88), map.width, 12);
    // side walls (match the wall colliders so nobody walks on them)
    ctx.fillStyle = "#6b4226";
    ctx.fillRect(X(0), Y(0), 16, map.height);
    ctx.fillRect(X(map.width - 16), Y(0), 16, map.height);
    ctx.fillStyle = "#7d5230";
    ctx.fillRect(X(0), Y(0), 6, map.height);
    ctx.fillRect(X(map.width - 6), Y(0), 6, map.height);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(X(16), Y(100));
    ctx.lineTo(X(16), Y(map.height));
    ctx.moveTo(X(map.width - 16), Y(100));
    ctx.lineTo(X(map.width - 16), Y(map.height));
    ctx.stroke();
    // bottom wall, taller, with the closed entrance door you came through
    const bwY = map.height - 44;
    ctx.fillStyle = "#6b4226";
    ctx.fillRect(X(0), Y(bwY), map.width, 44);
    ctx.fillStyle = "#7d5230";
    for (let wx = 0; wx < map.width; wx += 48) ctx.fillRect(X(wx), Y(bwY), 24, 44);
    ctx.fillStyle = "#4e3018";
    ctx.fillRect(X(0), Y(bwY), map.width, 8);
    // entrance door (bigger, centered where you spawn)
    const dx = X(480);
    const doorTop = Y(588);
    ctx.fillStyle = "rgba(43,31,22,0.3)";
    ctx.beginPath();
    ctx.roundRect(dx - 55, doorTop + 6, 110, 52, 10);
    ctx.fill();
    ctx.fillStyle = "#4e3018";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(dx - 55, doorTop, 110, 52, 10);
    ctx.fill();
    ctx.stroke();
    // closed double door with panels
    ctx.fillStyle = "#8a5a33";
    ctx.beginPath();
    ctx.roundRect(dx - 46, doorTop + 5, 92, 47, 8);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.strokeStyle = "rgba(43,31,22,0.5)";
    ctx.lineWidth = 2;
    for (const px of [dx - 32, dx + 8]) {
      ctx.beginPath();
      ctx.roundRect(px, doorTop + 11, 24, 16, 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(px, doorTop + 30, 24, 14, 4);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(dx, doorTop + 5);
    ctx.lineTo(dx, doorTop + 52);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = "#f2c14e";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    for (const kx of [dx - 8, dx + 8]) {
      ctx.beginPath();
      ctx.arc(kx, doorTop + 28, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // TV unit against the bottom wall, screen facing the couch. One depth
    // prop (ground y 588) for the whole thing, so it tucks OVER you when
    // you step right up to it instead of sliding underneath. We see the
    // BACK of the set (dark panel) — on-air shows as a beam spilling up
    // off the screen toward the couch plus the green LED.
    // Matches console collider 140,552,140x36.
    props.push({
      y: 588, draw: () => {
      const fx = X(150), fy = Y(500), fw = 120, fh = 60;
      const ux = X(140), uy = Y(552), uw = 140, uh = 36;
      if (tvOn) {
        // light beaming up off the screen toward the couch, flickering softly
        const flick = 1 + Math.sin(t / 280) * 0.08 + Math.sin(t / 97) * 0.05;
        const cx = fx + fw / 2;
        const bg = ctx.createLinearGradient(0, fy, 0, 398 - camY);
        bg.addColorStop(0, `rgba(170,200,255,${0.55 * flick})`);
        bg.addColorStop(1, "rgba(170,200,255,0)");
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.moveTo(cx - fw / 2 + 10, fy + 4);
        ctx.lineTo(cx + fw / 2 - 10, fy + 4);
        ctx.lineTo(X(210 + 118), Y(398));
        ctx.lineTo(X(210 - 118), Y(398));
        ctx.closePath();
        ctx.fill();
      }
      // frame + neck stand (near-black — no brown edges)
      ctx.fillStyle = "#22222e";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(fx, fy, fw, fh, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#22222e";
      ctx.fillRect(fx + fw / 2 - 8, fy + fh - 2, 16, 8);
      // dark back panel with cooling vents
      ctx.fillStyle = "#23232f";
      ctx.beginPath();
      ctx.roundRect(fx + 8, fy + 8, fw - 16, fh - 16, 4);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 2;
      for (const vy of [fy + 22, fy + 32, fy + 42]) {
        ctx.beginPath();
        ctx.moveTo(fx + 16, vy);
        ctx.lineTo(fx + fw - 16, vy);
        ctx.stroke();
      }
      // console shadow + cabinet (dark stained, matching the set)
      ctx.fillStyle = "rgba(43,31,22,0.3)";
      ctx.beginPath();
      ctx.roundRect(ux + 4, uy + 6, uw, uh, 8);
      ctx.fill();
      ctx.fillStyle = "#4a3a35";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(ux, uy, uw, uh, 8);
      ctx.fill();
      ctx.stroke();
      // light spilling onto the cabinet top while on air
      if (tvOn) {
        ctx.fillStyle = "rgba(255,220,150,0.35)";
        ctx.fillRect(ux + 8, uy - 2, uw - 16, 6);
      }
      // cabinet split + knobs
      ctx.strokeStyle = "rgba(43,31,22,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ux + uw / 2, uy + 6);
      ctx.lineTo(ux + uw / 2, uy + uh - 6);
      ctx.stroke();
      ctx.fillStyle = "#f2c14e";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.6;
      for (const kx of [ux + uw / 2 - 8, ux + uw / 2 + 8]) {
        ctx.beginPath();
        ctx.arc(kx, uy + uh / 2, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      // power LED on the console: red idle, green on air
      ctx.fillStyle = tvOn ? "#58d68d" : "#d95f4b";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(ux + uw - 12, uy + uh / 2, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      },
    });
    // round window with night sky
    const wx = X(480), wy = Y(52);
    ctx.fillStyle = "#1e2a4a";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(wx, wy, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f2c14e";
    ctx.beginPath();
    ctx.arc(wx + 8, wy - 6, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "white";
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(wx - 16 + hash2(i, 71) * 30, wy - 18 + hash2(i, 72) * 34, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "#7a4a26";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(wx - 30, wy);
    ctx.lineTo(wx + 30, wy);
    ctx.moveTo(wx, wy - 30);
    ctx.lineTo(wx, wy + 30);
    ctx.stroke();
    // string lights
    for (const [y0, sag] of [[110, 34], [150, 44]] as const) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(X(20), Y(y0));
      ctx.quadraticCurveTo(X(map.width / 2), Y(y0 + sag * 2), X(map.width - 20), Y(y0));
      ctx.stroke();
      for (let i = 0; i <= 12; i++) {
        const px = 20 + (i / 12) * (map.width - 40);
        const q = i / 12;
        const py = y0 + 2 * sag * 2 * q * (1 - q) * 0.5 + sag * 0.4 * Math.sin(Math.PI * q);
        const cols = ["#f2c14e", "#e8919c", "#7fc6a4"];
        ctx.fillStyle = cols[i % 3];
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(X(px), Y(py) + 7, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(242,193,78,0.3)";
        ctx.beginPath();
        ctx.arc(X(px), Y(py) + 7, 10, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // center rug (ground layer — ties the room together)
    ctx.fillStyle = "#d95f4b";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.ellipse(X(480), Y(400), 220, 120, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#faf3df";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(X(480), Y(400), 190, 100, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#f2c14e";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(X(480), Y(400), 150, 76, 0, 0, Math.PI * 2);
    ctx.stroke();
    // arcade north wall (match colliders in maps.ts):
    // left = air hockey table, right = two upright cabinets (pong + snake)
    // plus the token vendor. Snake's screen goes plain lit while someone is
    // locked in (the real game lives in the modal, spectators mirror it).
    const cabinet = (
      mx: number, w: number,
      opts: { cab: string; marquee: string; label: string; screen: string; kind: "pong" | "snake"; lit?: boolean },
    ) => {
      ctx.fillStyle = "rgba(43,31,22,0.3)";
      ctx.beginPath();
      ctx.roundRect(X(mx) + 5, Y(124), w, 94, 12);
      ctx.fill();
      ctx.fillStyle = opts.cab;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(X(mx), Y(120), w, 90, 12);
      ctx.fill();
      ctx.stroke();
      // side shade strips so the pair reads as two boxes, not one
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(X(mx) + 4, Y(150), 6, 52);
      ctx.fillRect(X(mx) + w - 10, Y(150), 6, 52);
      // marquee
      ctx.fillStyle = opts.marquee;
      ctx.beginPath();
      ctx.roundRect(X(mx) + 10, Y(128), w - 20, 20, 6);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.font = "900 12px Nunito, 'Trebuchet MS', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(opts.label, X(mx) + w / 2, Y(142));
      // screen shell
      const sw = w - 30, sh = 42;
      const sx = mx + (w - sw) / 2, sy = 154;
      const sg = ctx.createLinearGradient(0, Y(sy), 0, Y(sy + sh));
      sg.addColorStop(0, opts.screen);
      sg.addColorStop(1, shade(opts.screen, -40));
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.roundRect(X(sx), Y(sy), sw, sh, 6);
      ctx.fill();
      // occupied cabinet: plain lit screen (the game lives in the
      // modal — spectators mirror it there, not on the cabinet)
      if (opts.lit) {
        const lg = ctx.createLinearGradient(0, Y(sy), 0, Y(sy + sh));
        lg.addColorStop(0, opts.kind === "pong" ? "#cfe0f5" : "#d8ecb8");
        lg.addColorStop(1, opts.kind === "pong" ? "#9db9d9" : "#a9c98a");
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.roundRect(X(sx), Y(sy), sw, sh, 6);
        ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${0.25 + Math.sin(t / 300) * 0.08})`;
        ctx.fillRect(X(sx) + 4, Y(sy) + 4, sw - 8, 5);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(X(sx), Y(sy), sw, sh, 6);
        ctx.stroke();
      } else {
      // themed attract-mode content + shine sweep, masked inside the screen
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(X(sx), Y(sy), sw, sh, 6);
      ctx.clip();
      if (opts.kind === "pong") {
        // center dashed line
        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(X(sx) + sw / 2, Y(sy) + 4);
        ctx.lineTo(X(sx) + sw / 2, Y(sy + sh) - 4);
        ctx.stroke();
        ctx.setLineDash([]);
        // paddles drift, ball ping-pongs (attract loop)
        const lp = Y(sy + sh / 2) + Math.sin(t / 480) * 10;
        const rp = Y(sy + sh / 2) + Math.sin(t / 480 + Math.PI) * 10;
        ctx.fillStyle = "#faf3df";
        ctx.fillRect(X(sx) + 6, lp - 8, 4, 16);
        ctx.fillRect(X(sx) + sw - 10, rp - 8, 4, 16);
        const bx = X(sx) + sw / 2 + Math.sin(t / 420) * (sw / 2 - 14);
        const by = Y(sy + sh / 2) + Math.cos(t / 620) * 9;
        ctx.fillRect(bx - 2.5, by - 2.5, 5, 5);
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.font = "900 10px Nunito, 'Trebuchet MS', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("2   3", X(sx) + sw / 2, Y(sy) + 12);
      } else {
        // snake: dotted grid, pulsing apple, looping snake
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        for (let gx = 0; gx < 7; gx++) {
          for (let gy = 0; gy < 4; gy++) {
            ctx.fillRect(X(sx) + 8 + gx * 10, Y(sy) + 8 + gy * 9, 1.6, 1.6);
          }
        }
        const pulse = 3 + Math.sin(t / 300) * 0.8;
        ctx.fillStyle = "#d95f4b";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(X(sx) + sw - 16, Y(sy) + 12, pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#4c9a52";
        ctx.beginPath();
        ctx.moveTo(X(sx) + sw - 16, Y(sy) + 12 - pulse);
        ctx.lineTo(X(sx) + sw - 14, Y(sy) + 8 - pulse);
        ctx.lineTo(X(sx) + sw - 16, Y(sy) + 10 - pulse);
        ctx.closePath();
        ctx.fill();
        // snake body patrols a small loop
        const segs = 7;
        for (let i = 0; i < segs; i++) {
          const ph = t / 260 - i * 0.55;
          const px = X(sx) + 12 + (Math.sin(ph) * 0.5 + 0.5) * (sw - 34);
          const py = Y(sy) + 24 + Math.sin(ph * 1.7) * 8;
          const s = i === 0 ? 6 : 5 - (i / segs) * 1.5;
          ctx.fillStyle = i === 0 ? "#a3e635" : "#7bc96f";
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.roundRect(px - s / 2, py - s / 2, s, s, 1.5);
          ctx.fill();
          ctx.stroke();
          if (i === 0) {
            ctx.fillStyle = INK;
            ctx.beginPath();
            ctx.arc(px + 1, py - 0.5, 0.9, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      const shx = X(sx) + ((t / 14) % (sw + 34)) - 17;
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.moveTo(shx, Y(sy));
      ctx.lineTo(shx + 14, Y(sy));
      ctx.lineTo(shx + 4, Y(sy + sh));
      ctx.lineTo(shx - 10, Y(sy + sh));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(X(sx), Y(sy), sw, sh, 6);
      ctx.stroke();
      } // end attract-mode branch (lit snake screens return early above)
      // coin slot (left) + two buttons (centered)
      ctx.fillStyle = "#2b1f16";
      ctx.fillRect(X(mx) + 14, Y(199), 5, 9);
      ctx.fillStyle = "#d95f4b";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(X(mx) + 16.5, Y(197), 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      for (const [bx, bc] of [[w / 2 - 11, "#d95f4b"], [w / 2 + 11, "#f2c14e"]] as const) {
        ctx.fillStyle = bc;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(X(mx) + bx, Y(203), 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    };
    props.push({
      y: 210,
      draw: () => cabinet(630, 110, { cab: "#2b4a8f", marquee: "#f2c14e", label: "PONG", screen: "#16233f", kind: "pong", lit: pongBusy }),
    });
    props.push({
      y: 210,
      draw: () => cabinet(750, 110, { cab: "#2e6b34", marquee: "#a3e635", label: "SNAKE", screen: "#14301f", kind: "snake", lit: snakeBusy }),
    });
    // token vendor (matches collider 872,120,56x90): narrow red box with a
    // coin slot, token window and a glowing TOKENS marquee
    props.push({
      y: 210, draw: () => {
        const vx = 872, vw = 56;
        ctx.fillStyle = "rgba(43,31,22,0.3)";
        ctx.beginPath();
        ctx.roundRect(X(vx) + 4, Y(124), vw, 94, 10);
        ctx.fill();
        ctx.fillStyle = "#a83e2f";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(X(vx), Y(120), vw, 90, 10);
        ctx.fill();
        ctx.stroke();
        // marquee
        const glow = 0.6 + Math.sin(t / 500) * 0.15;
        ctx.fillStyle = "#f2c14e";
        ctx.beginPath();
        ctx.roundRect(X(vx) + 7, Y(128), vw - 14, 20, 5);
        ctx.fill();
        ctx.fillStyle = INK;
        ctx.font = "900 9px Nunito, 'Trebuchet MS', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("TOKENS", X(vx) + vw / 2, Y(142));
        // coin slot with glow
        ctx.fillStyle = "#2b1f16";
        ctx.beginPath();
        ctx.roundRect(X(vx) + vw / 2 - 3, Y(154), 6, 12, 2);
        ctx.fill();
        ctx.fillStyle = `rgba(242,193,78,${glow})`;
        ctx.beginPath();
        ctx.arc(X(vx) + vw / 2, Y(152), 3, 0, Math.PI * 2);
        ctx.fill();
        // token window: three silver tokens behind glass
        ctx.fillStyle = "#241a12";
        ctx.beginPath();
        ctx.roundRect(X(vx) + 10, Y(170), vw - 20, 20, 4);
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.stroke();
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = "#bcd8e8";
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.roundRect(X(vx) + 14 + i * 11, Y(173), 8, 14, 3);
          ctx.fill();
          ctx.stroke();
        }
      },
    });
    // air hockey table (matches ARCADE_AIRHOCKEY collider). When players
    // are locked in, the table renders their live match (mallets + puck +
    // score) so the room watches without a spectate modal; otherwise it
    // idles with a gentle drift. The table itself paints through the shared
    // painters below (also used by the player window) so the two can never
    // drift apart.
    props.push({
      y: ARCADE_AIRHOCKEY.y + ARCADE_AIRHOCKEY.h, draw: () => {
        const ax = ARCADE_AIRHOCKEY.x, ay = ARCADE_AIRHOCKEY.y;
        const aw = ARCADE_AIRHOCKEY.w, ah = ARCADE_AIRHOCKEY.h;
        const live = !!(ahState && (ahState.p1 || ahState.p2));
        ctx.fillStyle = "rgba(43,31,22,0.3)";
        ctx.beginPath();
        ctx.roundRect(X(ax) + 5, Y(ay) + 7, aw, ah, 16);
        ctx.fill();
        // field units map 1:1 onto the table box (server AH_W/H = aw/ah)
        let m1 = { x: aw * 0.28 + Math.sin(t / 600 + 1) * 3, y: ah / 2 + Math.cos(t / 750) * 5 };
        let m2 = { x: aw * 0.72 + Math.sin(t / 600 + Math.PI) * 3, y: ah / 2 + Math.cos(t / 750) * 5 };
        let pk: { x: number; y: number } | null =
          { x: aw / 2 + Math.sin(t / 700) * 4, y: ah / 2 + Math.cos(t / 900) * 3 };
        if (live && ahState) {
          m1 = ahState.st1;
          m2 = ahState.st2;
          pk = ahState.puck;
        }
        ctx.save();
        ctx.translate(X(ax), Y(ay));
        paintAhTable(ctx);
        paintAhPieces(ctx, m1, m2, pk);
        ctx.restore();
        // live score plaque on the bottom rail while a match is on
        if (live && ahState && (ahState.s1 + ahState.s2 > 0 || ahState.status !== "lobby")) {
          const cx = X(ax) + aw / 2, cy = Y(ay) + ah - 12;
          ctx.fillStyle = "#241a12";
          ctx.strokeStyle = INK;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(cx - 30, cy - 9, 60, 18, 5);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#faf3df";
          ctx.font = "900 11px 'Courier New', monospace";
          ctx.textAlign = "center";
          ctx.fillText(`${ahState.s1} : ${ahState.s2}`, cx, cy + 4);
        }
      },
    });
    // couch (matches collider 100,370,220x90): backrest north, sitters face
    // the TV by the bottom wall. Shallow depth (above the seats) so sitters
    // on the cushions draw above it, while walkers behind the couch are
    // still covered.
    props.push({
      y: 412, draw: () => {
        const chx = X(100), chy = Y(370);
    ctx.fillStyle = "rgba(43,31,22,0.3)";
    ctx.beginPath();
    ctx.roundRect(chx + 5, chy + 8, 220, 88, 18);
    ctx.fill();
    // wooden legs
    ctx.fillStyle = "#5d3a1e";
    for (const lx of [chx + 16, chx + 190]) {
      ctx.beginPath();
      ctx.roundRect(lx, chy + 82, 14, 14, 4);
      ctx.fill();
    }
    // base
    ctx.fillStyle = "#d98a94";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(chx, chy + 26, 220, 60, 14);
    ctx.fill();
    ctx.stroke();
    // backrest (north edge — you lean on it facing the TV)
    ctx.fillStyle = "#c9747f";
    ctx.beginPath();
    ctx.roundRect(chx + 8, chy, 204, 44, 14);
    ctx.fill();
    ctx.stroke();
    // piping on backrest
    ctx.strokeStyle = "rgba(74,55,40,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(chx + 18, chy + 10);
    ctx.lineTo(chx + 202, chy + 10);
    ctx.stroke();
    // armrests
    ctx.fillStyle = "#e8a9b1";
    for (const ax of [chx + 2, chx + 188]) {
      ctx.beginPath();
      ctx.roundRect(ax, chy + 24, 30, 58, 12);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    // seat cushions with buttons
    for (const cx2 of [chx + 40, chx + 112]) {
      ctx.fillStyle = "#e8a9b1";
      ctx.beginPath();
      ctx.roundRect(cx2, chy + 46, 68, 34, 10);
      ctx.fill();
      ctx.strokeStyle = "rgba(74,55,40,0.55)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#b95f6a";
      ctx.beginPath();
      ctx.arc(cx2 + 34, chy + 63, 3.4, 0, Math.PI * 2);
      ctx.fill();
      }
      },
    });
    // leafy potted plant: stems + bushy leaves rising from the soil
    props.push({
      y: 508, draw: () => {
        const ppx = X(880), ppy = Y(478);
    ctx.fillStyle = "rgba(43,31,22,0.22)";
    ctx.beginPath();
    ctx.ellipse(ppx, ppy + 30, 24, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    // stems fanning up from the soil
    ctx.strokeStyle = LEAF_D;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (const [sx, ex, ey] of [[-12, -20, -34], [0, 0, -44], [12, 20, -34]] as const) {
      ctx.beginPath();
      ctx.moveTo(ppx + sx * 0.4, ppy - 8);
      ctx.quadraticCurveTo(ppx + sx * 0.7, ppy - 22, ppx + ex, ppy + ey);
      ctx.stroke();
    }
    // leaf clusters around the stem tips + heart of the bush
    const leafAt = (lx: number, ly: number, rx: number, ry: number, rot: number, col: string) => {
      ctx.fillStyle = col;
      ctx.strokeStyle = LEAF_D;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(ppx + lx, ppy + ly, rx, ry, rot, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "rgba(62,125,70,0.6)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(ppx + lx - rx * 0.6, ppy + ly);
      ctx.lineTo(ppx + lx + rx * 0.6, ppy + ly);
      ctx.stroke();
    };
    leafAt(-20, -36, 12, 6.5, -0.5, LEAF);
    leafAt(20, -36, 12, 6.5, 0.5, LEAF);
    leafAt(-11, -26, 10, 6, -0.3, LEAF_L);
    leafAt(11, -26, 10, 6, 0.3, LEAF_L);
    leafAt(0, -44, 13, 7, 0, LEAF_L);
    leafAt(-5, -34, 11, 6.5, -0.2, LEAF);
    leafAt(6, -33, 10, 6, 0.25, LEAF);
    // soil
    ctx.fillStyle = "#4e3018";
    ctx.beginPath();
    ctx.ellipse(ppx, ppy - 8, 15, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // terracotta pot with rim
    ctx.fillStyle = "#cf6b4a";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(ppx - 13, ppy - 8);
    ctx.lineTo(ppx + 13, ppy - 8);
    ctx.lineTo(ppx + 9, ppy + 24);
    ctx.lineTo(ppx - 9, ppy + 24);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#b8573c";
    ctx.beginPath();
    ctx.roundRect(ppx - 17, ppy - 14, 34, 11, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.fillRect(ppx - 10, ppy - 4, 5, 24);
      },
    });
  } else if (mapId === "cafe") {
    // --- cozy café interior (same cabin bones as the arcade loft) ---
    ctx.fillStyle = "#a06a3b";
    ctx.fillRect(X(0), Y(0), map.width, map.height);
    // planks
    ctx.strokeStyle = "rgba(74,55,40,0.45)";
    ctx.lineWidth = 2;
    for (let py = 96; py < map.height; py += 34) {
      ctx.beginPath();
      ctx.moveTo(X(0), Y(py));
      ctx.lineTo(X(map.width), Y(py));
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const gx = hash2(i, py) * map.width;
        ctx.beginPath();
        ctx.moveTo(X(gx), Y(py));
        ctx.lineTo(X(gx), Y(py) + 34);
        ctx.stroke();
      }
    }
    speckle(ctx, X, Y, map.width, map.height, 60, ["#8f5c30"], 1.6, 61);
    // back wall
    ctx.fillStyle = "#6b4226";
    ctx.fillRect(X(0), Y(0), map.width, 96);
    ctx.fillStyle = "#7d5230";
    for (let wx = 0; wx < map.width; wx += 48) ctx.fillRect(X(wx), Y(0), 24, 96);
    ctx.fillStyle = "#4e3018";
    ctx.fillRect(X(0), Y(88), map.width, 12);
    // side walls (match the wall colliders so nobody walks on them)
    ctx.fillStyle = "#6b4226";
    ctx.fillRect(X(0), Y(0), 16, map.height);
    ctx.fillRect(X(map.width - 16), Y(0), 16, map.height);
    ctx.fillStyle = "#7d5230";
    ctx.fillRect(X(0), Y(0), 6, map.height);
    ctx.fillRect(X(map.width - 6), Y(0), 6, map.height);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(X(16), Y(100));
    ctx.lineTo(X(16), Y(map.height));
    ctx.moveTo(X(map.width - 16), Y(100));
    ctx.lineTo(X(map.width - 16), Y(map.height));
    ctx.stroke();
    // bottom wall, taller, with the entrance door you came through
    const cbwY = map.height - 44;
    ctx.fillStyle = "#6b4226";
    ctx.fillRect(X(0), Y(cbwY), map.width, 44);
    ctx.fillStyle = "#7d5230";
    for (let wx = 0; wx < map.width; wx += 48) ctx.fillRect(X(wx), Y(cbwY), 24, 44);
    ctx.fillStyle = "#4e3018";
    ctx.fillRect(X(0), Y(cbwY), map.width, 8);
    // entrance door (bigger, centered where you spawn)
    const cdx = X(480);
    const cdoorTop = Y(588);
    ctx.fillStyle = "rgba(43,31,22,0.3)";
    ctx.beginPath();
    ctx.roundRect(cdx - 55, cdoorTop + 6, 110, 52, 10);
    ctx.fill();
    ctx.fillStyle = "#4e3018";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(cdx - 55, cdoorTop, 110, 52, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#8a5a33";
    ctx.beginPath();
    ctx.roundRect(cdx - 46, cdoorTop + 5, 92, 47, 8);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.strokeStyle = "rgba(43,31,22,0.5)";
    ctx.lineWidth = 2;
    for (const px of [cdx - 32, cdx + 8]) {
      ctx.beginPath();
      ctx.roundRect(px, cdoorTop + 11, 24, 16, 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(px, cdoorTop + 30, 24, 14, 4);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cdx, cdoorTop + 5);
    ctx.lineTo(cdx, cdoorTop + 52);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = "#f2c14e";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    for (const kx of [cdx - 8, cdx + 8]) {
      ctx.beginPath();
      ctx.arc(kx, cdoorTop + 28, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // welcome mat just inside the door (ground layer)
    ctx.fillStyle = "#d95f4b";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(X(480) - 52, Y(536), 104, 30, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#faf3df";
    ctx.font = "900 12px Nunito, 'Trebuchet MS', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("WELCOME", X(480), Y(556));
    // runner rug from the door toward the counter (ground layer)
    ctx.fillStyle = "#c9747f";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(X(480) - 40, Y(280), 80, 250, 12);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#faf3df";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(X(480) - 30, Y(290), 60, 230, 8);
    ctx.stroke();
    // day windows on the back wall (left + right of the menu)
    for (const wxx of [300, 660]) {
      const wyy = Y(22);
      ctx.fillStyle = "rgba(43,31,22,0.3)";
      ctx.beginPath();
      ctx.roundRect(X(wxx) - 34 + 3, wyy + 4, 72, 62, 8);
      ctx.fill();
      const sky = ctx.createLinearGradient(0, wyy, 0, wyy + 56);
      sky.addColorStop(0, "#7ec8f0");
      sky.addColorStop(1, "#cdeffd");
      ctx.fillStyle = sky;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(X(wxx) - 34, wyy, 72, 56, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f2c14e";
      ctx.beginPath();
      ctx.arc(X(wxx) + 16, wyy + 16, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.ellipse(X(wxx) - 12, wyy + 38, 14, 6, 0, 0, Math.PI * 2);
      ctx.ellipse(X(wxx) + 2, wyy + 44, 11, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#7a4a26";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(X(wxx), wyy);
      ctx.lineTo(X(wxx), wyy + 56);
      ctx.moveTo(X(wxx) - 34, wyy + 28);
      ctx.lineTo(X(wxx) + 38, wyy + 28);
      ctx.stroke();
    }
    // chalkboard on the back wall (CAFE_BOARD): the house menu baked as the
    // base layer until someone wipes it off, shared doodles composited over
    // it — so the eraser takes the words away pixel by pixel, and wiping
    // clean leaves a truly blank slate
    {
      const mx = X(CAFE_BOARD.x), my = Y(CAFE_BOARD.y), mw = CAFE_BOARD.w, mh = CAFE_BOARD.h;
      const boardStrokes = board?.strokes || [];
      ctx.fillStyle = "#4e3018";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(mx - 4, my - 4, mw + 8, mh + 8, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#2f2a26";
      ctx.beginPath();
      ctx.roundRect(mx, my, mw, mh, 5);
      ctx.fill();
      if (board?.menu !== false) {
        ctx.fillStyle = "#faf3df";
        ctx.textAlign = "center";
        ctx.font = "900 13px Nunito, 'Trebuchet MS', sans-serif";
        ctx.fillText("MENU", mx + mw / 2, my + 18);
        ctx.font = "800 10px Nunito, 'Trebuchet MS', sans-serif";
        ctx.fillStyle = "#f2c14e";
        ctx.fillText("latte · mocha", mx + mw / 2, my + 34);
        ctx.fillText("cocoa · cake", mx + mw / 2, my + 48);
      }
      // same normalized strokes the blackboard menu draws, scaled down
      if (boardStrokes.length > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(mx, my, mw, mh);
        ctx.clip();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (const st of boardStrokes) {
          const pts = st.pts;
          if (!pts || pts.length === 0) continue;
          ctx.strokeStyle = st.color;
          ctx.fillStyle = st.color;
          ctx.lineWidth = Math.max(2, st.size * mw);
          if (pts.length === 1) {
            ctx.beginPath();
            ctx.arc(mx + pts[0][0] * mw, my + pts[0][1] * mh, Math.max(1, st.size * mw * 0.5), 0, Math.PI * 2);
            ctx.fill();
            continue;
          }
          ctx.beginPath();
          ctx.moveTo(mx + pts[0][0] * mw, my + pts[0][1] * mh);
          for (let k = 1; k < pts.length; k++) ctx.lineTo(mx + pts[k][0] * mw, my + pts[k][1] * mh);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    // long serving counter (matches CAFE_COUNTER): staff walk the strip
    // behind it, guests sit on the stools in front
    props.push({
      y: CAFE_COUNTER.y + CAFE_COUNTER.h, draw: () => {
        const ux = X(CAFE_COUNTER.x), uy = Y(CAFE_COUNTER.y);
        const uw = CAFE_COUNTER.w, uh = CAFE_COUNTER.h;
        ctx.fillStyle = "rgba(43,31,22,0.3)";
        ctx.beginPath();
        ctx.roundRect(ux + 5, uy + 7, uw, uh, 8);
        ctx.fill();
        // wooden base with panels
        ctx.fillStyle = "#8a5a33";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(ux, uy + 8, uw, uh, 8);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "rgba(43,31,22,0.5)";
        ctx.lineWidth = 2;
        for (let k = 1; k < 6; k++) {
          const lx = ux + (uw / 6) * k;
          ctx.beginPath();
          ctx.moveTo(lx, uy + 14);
          ctx.lineTo(lx, uy + 8 + uh - 6);
          ctx.stroke();
        }
        // counter top with an overhang
        ctx.fillStyle = "#d9a960";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(ux - 8, uy - 6, uw + 16, 18, 8);
        ctx.fill();
        ctx.stroke();
        // cups + a cake dome sitting on the top
        const cup = (cx: number, steam: boolean) => {
          ctx.fillStyle = "#faf3df";
          ctx.strokeStyle = INK;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(cx - 7, uy - 13, 14, 12, 3);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#6b4226";
          ctx.fillRect(cx - 5, uy - 11, 10, 4);
          if (steam) {
            ctx.strokeStyle = "rgba(250,243,223,0.8)";
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(cx - 2, uy - 15);
            ctx.quadraticCurveTo(cx - 4, uy - 20, cx - 1, uy - 24);
            ctx.stroke();
          }
        };
        cup(ux + 60, true);
        cup(ux + 150, false);
        cup(ux + 250, true);
        // cake dome
        ctx.fillStyle = "rgba(200,220,255,0.5)";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ux + uw - 50, uy - 5, 14, Math.PI, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#e8919c";
        ctx.beginPath();
        ctx.roundRect(ux + uw - 62, uy - 9, 24, 6, 3);
        ctx.fill();
        ctx.stroke();
      },
    });
    // stools in front of the counter (match CAFE_STOOLS colliders).
    // Shallow depth (above the seat point, which rides 14px above the
    // graphic) so sitters perch on top with the legs peeking out below.
    for (const s of CAFE_STOOLS) {
      props.push({
        y: s.y - 18, draw: () => {
          const sx = X(s.x), sy = Y(s.y);
          ctx.fillStyle = "rgba(43,31,22,0.22)";
          ctx.beginPath();
          ctx.ellipse(sx, sy + 12, 16, 5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#5d3a1e";
          ctx.strokeStyle = INK;
          ctx.lineWidth = 2;
          for (const [lx, lz] of [[-9, 0], [9, 0]] as const) {
            ctx.beginPath();
            ctx.roundRect(sx + lx - 2, sy - 2, 4, 14, 2);
            ctx.fill();
            ctx.stroke();
          }
          ctx.fillStyle = "#c9747f";
          ctx.strokeStyle = INK;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.ellipse(sx, sy - 4, 15, 10, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "rgba(255,255,255,0.3)";
          ctx.beginPath();
          ctx.ellipse(sx - 5, sy - 7, 5, 3, -0.3, 0, Math.PI * 2);
          ctx.fill();
        },
      });
    }
    // round tables with one chair each, north side (match CAFE_TABLES
    // colliders). The chair is its own shallow prop (above the seat point)
    // so sitters draw on top of it instead of it painting over them.
    for (const tbl of CAFE_TABLES) {
      // chair graphic tucks to the table's north edge; the seat point rides
      // 8px above it (see maps.ts) and the shallow depth keeps sitters on top
      const chairY = tbl.y - 22;
      const seatY = tbl.y - 30;
      props.push({
        y: seatY - 4, draw: () => {
          const chx = X(tbl.x + tbl.w / 2), chy = Y(chairY);
          ctx.fillStyle = "rgba(43,31,22,0.2)";
          ctx.beginPath();
          ctx.ellipse(chx, chy + 12, 17, 5, 0, 0, Math.PI * 2);
          ctx.fill();
          // front legs so it doesn't sit flat on the ground (behind the seat)
          ctx.fillStyle = "#5d3a1e";
          ctx.strokeStyle = INK;
          ctx.lineWidth = 2;
          for (const lx of [chx - 10, chx + 10]) {
            ctx.beginPath();
            ctx.roundRect(lx - 2, chy + 6, 4, 14, 2);
            ctx.fill();
            ctx.stroke();
          }
          ctx.fillStyle = "#8a5a33";
          ctx.strokeStyle = INK;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.roundRect(chx - 15, chy - 11, 30, 24, 8);
          ctx.fill();
          ctx.stroke();
          // backrest on the far side from the table
          ctx.fillStyle = "#a06a3b";
          ctx.beginPath();
          ctx.roundRect(chx - 15, chy - 17, 30, 10, 5);
          ctx.fill();
          ctx.stroke();
        },
      });
      props.push({
        y: tbl.y + tbl.h, draw: () => {
          const tx = X(tbl.x), ty = Y(tbl.y), tw = tbl.w, th = tbl.h;
          const cx = tx + tw / 2, cy = ty + th / 2;
          // table shadow + legs + cloth + wooden top
          ctx.fillStyle = "rgba(43,31,22,0.28)";
          ctx.beginPath();
          ctx.ellipse(cx, cy + 20, tw / 2, 12, 0, 0, Math.PI * 2);
          ctx.fill();
          // splayed legs so it doesn't sit flat on the ground (tops hide
          // under the cloth, feet land past the shadow)
          ctx.fillStyle = "#5d3a1e";
          ctx.strokeStyle = INK;
          ctx.lineWidth = 2;
          for (const [lox, loy] of [[-1, 0], [1, 0], [-0.55, 0.45], [0.55, 0.45]] as const) {
            const lx = cx + lox * (tw / 2 - 12);
            const ly = cy + 4 + loy * 12;
            ctx.beginPath();
            ctx.roundRect(lx - 2.5, ly, 5, 22, 2);
            ctx.fill();
            ctx.stroke();
          }
          ctx.fillStyle = "#faf3df";
          ctx.strokeStyle = INK;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.ellipse(cx, cy, tw / 2, th / 2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#e8a9b1";
          ctx.beginPath();
          ctx.ellipse(cx, cy, tw / 2 - 12, th / 2 - 10, 0, 0, Math.PI * 2);
          ctx.fill();
          // two steaming cups on the cloth (same cups as the counter)
          for (const [ox, oy] of [[-22, -6], [20, 8]] as const) {
            const ccx = cx + ox, ccy = cy + oy;
            ctx.fillStyle = "#faf3df";
            ctx.strokeStyle = INK;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(ccx - 7, ccy - 7, 14, 12, 3);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "#6b4226";
            ctx.fillRect(ccx - 5, ccy - 5, 10, 4);
            ctx.strokeStyle = "rgba(250,243,223,0.8)";
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(ccx - 2, ccy - 9);
            ctx.quadraticCurveTo(ccx - 4, ccy - 14, ccx - 1, ccy - 18);
            ctx.stroke();
          }
        },
      });
    }
    // side chairs on the right-hand table (match CAFE_SIDE_CHAIRS): same
    // wooden chairs as the deck, backrest outward. Shallow depth (above the
    // seat point, which sits on the cushion) so sitters draw on top.
    CAFE_SIDE_CHAIRS.forEach((c, ci) => {
      const face = ci === 0 ? "left" : "right";
      props.push({ y: c.y - 10, draw: () => drawDeckChair(ctx, X, Y, c.x, c.y, face as "left" | "right") });
    });
  } else {
    // --- sunny plaza ---
    ctx.fillStyle = "#7cc46a";
    ctx.fillRect(X(0), Y(0), map.width, map.height);
    blob(ctx, X, Y, 350, 700, 280, 190, "#8fd27a", 0.8);
    blob(ctx, X, Y, 1250, 500, 300, 200, "#8fd27a", 0.8);
    blob(ctx, X, Y, 800, 1050, 340, 150, "#6aaf55", 0.7);
    blob(ctx, X, Y, 200, 300, 220, 150, "#6aaf55", 0.6);
    speckle(ctx, X, Y, map.width, map.height, 260, ["#6aaf55", "#5d9c4c", "#8fd27a"], 2.2, 5);
    // grass tufts + flowers (kept off the mowed pitch + race arena + deck)
    const onPitch = (px: number, py: number) =>
      (px > PLAZA_FIELD.x - 20 && px < PLAZA_FIELD.x + PLAZA_FIELD.w + 20 &&
        py > PLAZA_FIELD.y - 20 && py < PLAZA_FIELD.y + PLAZA_FIELD.h + 20) ||
      (px > RACE_AREA.x - 16 && px < RACE_AREA.x + RACE_AREA.w + 16 &&
        py > RACE_AREA.y - 16 && py < RACE_AREA.y + RACE_AREA.h + 16) ||
      (px > DECK.x - 16 && px < DECK.x + DECK.w + 16 &&
        py > DECK.y - 16 && py < DECK.y + DECK.h + 16);
    for (let i = 0; i < 70; i++) {
      const px = hash2(i, 101) * map.width, py = hash2(i, 102) * map.height;
      if (!onPitch(px, py)) tuft(ctx, X(px), Y(py), 0.8 + hash2(i, 103) * 0.7, "#5d9c4c");
    }
    for (let i = 0; i < 26; i++) {
      const px = hash2(i, 111) * map.width, py = hash2(i, 112) * map.height;
      if (!onPitch(px, py)) flower(ctx, X(px), Y(py), i % 3 === 0 ? "#f7ead0" : i % 3 === 1 ? "#f2c14e" : "#e8919c", "#d95f4b", 1);
    }
    // cobble paths
    const cobble = (px: number, py: number, pw: number, ph: number) => {
      ctx.fillStyle = "#ecd9a8";
      ctx.fillRect(X(px), Y(py), pw, ph);
      // stones stay strictly inside the dirt path
      ctx.save();
      ctx.beginPath();
      ctx.rect(X(px), Y(py), pw, ph);
      ctx.clip();
      ctx.strokeStyle = "#cfa96f";
      ctx.lineWidth = 2;
      let row = 0;
      for (let ry = py + 6; ry + 16 <= py + ph; ry += 24, row++) {
        for (let rx = px + 5 + (row % 2) * 17; rx + 26 <= px + pw; rx += 34) {
          ctx.beginPath();
          ctx.roundRect(X(rx), Y(ry), 26, 16, 7);
          ctx.stroke();
        }
      }
      ctx.restore();
    };
    cobble(0, 560, map.width, 90);
    cobble(760, 0, 90, map.height);
    // football pitch (ground layer — walkable, the ball rolls free)
    drawFootballField(ctx, X, Y);
    // toy-car race arena (ground layer — walkable for players, cars only;
    // tires + flag ride the prop pass so they depth-sort with the cars)
    drawRaceTrack(ctx, X, Y, t, props);
    // café cabin (depth-sorted so you can slip behind it)
    props.push({ y: 180 + 150, draw: () => drawCabin(ctx, X, Y, 180, 180, 260, 150, "#cf6b4a", "CAFÉ") });
    // social deck (ground layer — walkable platform; hedges + tables ride
    // the prop pass so they depth-sort with players)
    drawDeckGround(ctx, X, Y);
    for (const tbl of DECK_TABLES) {
      props.push({ y: tbl.y + tbl.h, draw: () => drawDeckTable(ctx, X, Y, tbl.x, tbl.y, tbl.w, tbl.h) });
    }
    DECK_CHAIRS.forEach((c, ci) => {
      const face = ci % 2 === 0 ? "left" : "right";
      // shallow depth (above the seat point at c.y) so sitters draw on top
      // of the chair instead of the chair painting over their upper body.
      // Walkers south of the chair still cover it, like café chairs.
      props.push({ y: c.y - 10, draw: () => drawDeckChair(ctx, X, Y, c.x, c.y, face as "left" | "right") });
    });
    // hedges: north / west / east + south flanks (stairs gap stays open).
    // North + south use their bottom edge (front/back correct). West/east
    // are low side bushes with shallow depth so players on the deck draw
    // over them instead of being buried under a full-height wall.
    props.push({ y: DECK.y + 12, draw: () => drawDeckHedge(ctx, X, Y, DECK.x - 12, DECK.y - 12, DECK.w + 24, 24, 11) });
    props.push({ y: DECK.y + 40, draw: () => drawDeckHedge(ctx, X, Y, DECK.x - 12, DECK.y + 12, 24, DECK.h - 12, 12) });
    props.push({ y: DECK.y + 40, draw: () => drawDeckHedge(ctx, X, Y, DECK.x + DECK.w - 12, DECK.y + 12, 24, DECK.h - 12, 13) });
    props.push({ y: DECK.y + DECK.h, draw: () => drawDeckHedge(ctx, X, Y, DECK.x - 12, DECK.y + DECK.h - 24, DECK_STAIRS.x - (DECK.x - 12), 24, 14) });
    props.push({ y: DECK.y + DECK.h, draw: () => drawDeckHedge(ctx, X, Y, DECK_STAIRS.x + DECK_STAIRS.w, DECK.y + DECK.h - 24, (DECK.x + DECK.w + 12) - (DECK_STAIRS.x + DECK_STAIRS.w), 24, 15) });
    // flower bed by the café (ground layer — never covers the player)
    {
      const bedX = 480, bedY = 200, bedW = 150, bedH = 70;
        ctx.fillStyle = "#6b4226";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(X(bedX), Y(bedY), bedW, bedH, 10);
        ctx.fill();
        ctx.stroke();
        for (let i = 0; i < 8; i++) {
          const px = bedX + 20 + i * 16, py = bedY + 22 + (i % 2) * 26;
          ctx.strokeStyle = LEAF_D;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(X(px), Y(py) + 8);
          ctx.lineTo(X(px), Y(py) - 6);
          ctx.stroke();
          flower(ctx, X(px), Y(py) - 8, ["#e8919c", "#f7ead0", "#f2c14e"][i % 3], "#a83e2f", 1.1);
        }
    }
    props.push({ y: 626, draw: () => drawFountain(ctx, X, Y, t) });
    TREES_POS.forEach(([tx, ty], i) =>
      props.push({ y: ty + 22, draw: () => drawTree(ctx, X, Y, tx, ty, t, i % 2 === 0) }));
    // lamp posts
    for (const [lx, ly] of [[640, 640], [960, 640]] as const) {
      props.push({
        y: ly + 2, draw: () => {
          ctx.fillStyle = "rgba(43,31,22,0.22)";
          ctx.beginPath();
          ctx.ellipse(X(lx), Y(ly) + 2, 14, 4, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#4e3018";
          ctx.strokeStyle = INK;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.roundRect(X(lx) - 4, Y(ly) - 52, 8, 54, 4);
          ctx.fill();
          ctx.stroke();
          const lg = ctx.createRadialGradient(X(lx), Y(ly) - 58, 2, X(lx), Y(ly) - 58, 26);
          lg.addColorStop(0, "rgba(255,217,122,0.8)");
          lg.addColorStop(1, "rgba(255,217,122,0)");
          ctx.fillStyle = lg;
          ctx.beginPath();
          ctx.arc(X(lx), Y(ly) - 58, 26, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#ffd97a";
          ctx.strokeStyle = INK;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.roundRect(X(lx) - 9, Y(ly) - 68, 18, 20, 5);
          ctx.fill();
          ctx.stroke();
        },
      });
    }
    // sunny plaza benches: shallow depth so sitters draw above (on the seat,
    // backrest behind them). Walkers behind are still covered.
    for (const b of BENCHES) {
      props.push({ y: b.y + 4, draw: () => drawBench(ctx, X, Y, b.x, b.y) });
    }
    // pitch stands: longer benches above the field, facing the game
    for (const s of PLAZA_STANDS) {
      props.push({ y: s.y + 4, draw: () => drawBench(ctx, X, Y, s.x, s.y, s.w) });
    }
    drawFence(ctx, X, Y, map.width, map.height, false, props);
  }
  ctx.restore(); // unclip
}

// ------------------------------------------------------- balls, per world
// plaza: football (14) • beach: big striped beach ball (19) • arcade: pocket 8-ball (11)
export function ballRadius(mapId: string): number {
  if (mapId === "beach") return 19;
  if (mapId === "arcade") return 11;
  if (mapId === "cafe") return 11;
  return 14;
}
let ballRot = 0;
// A shared polaroid: a small blank white card with a photo slot —
// deliberately NOT the picture itself (that lives in the viewer popup).
// Same size class as the ball so it reads as a little held object.
function drawPhoto(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  held: boolean,
  fl: Floater = DRY,
  t = 0,
  seed = 0
) {
  const W = 24, H = 30;
  const afloat = fl.floating && !held;
  if (!held && !afloat) {
    ctx.fillStyle = "rgba(43,31,22,0.28)";
    ctx.beginPath();
    ctx.ellipse(x, y + H / 2 + 1, W * 0.45, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const surfaceY = y + H / 2 - 8;
  ctx.save();
  if (afloat) clipAboveWaterline(ctx, x, y - 60, surfaceY, t, seed);
  ctx.translate(x, y + (afloat ? fl.bob - 3 : 0));
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(-W / 2 + 2, -H / 2 + 3, W, H);
  ctx.fillStyle = "#fff8e7";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(-W / 2, -H / 2, W, H);
  ctx.fill();
  ctx.stroke();
  // blank photo slot (the real picture only shows in the viewer popup)
  ctx.fillStyle = "#d9c193";
  ctx.fillRect(-W / 2 + 4, -H / 2 + 4, W - 8, W - 8);
  ctx.restore();
  // foam crest on the exact cut so the card reads as sitting in the water
  if (afloat) drawWaterline(ctx, x, surfaceY, t, seed, 13);
}

function drawBall(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, vx: number, vy: number, dt: number,
  mapId: string,
  held = false,
  fl: Floater = DRY,
  t = 0,
  seed = 3.7
) {
  const r = ballRadius(mapId);
  const spd = Math.hypot(vx, vy);
  ballRot += spd * dt * 0.02;
  const afloat = fl.floating && !held;
  if (!held && !afloat) {
  ctx.fillStyle = "rgba(43,31,22,0.25)";
  ctx.beginPath();
  ctx.ellipse(x, y + r + 1, r * 0.93, r * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  }
  // rides up on the surface; everything below the fixed surface line is
  // clipped away — same submersion as swimmers, not an overlap
  const by = y + (afloat ? fl.bob - 5 : 0);
  const surfaceY = y + r * 0.25;
  ctx.save();
  if (afloat) clipAboveWaterline(ctx, x, y - 90, surfaceY, t, seed);
  ctx.translate(x, by);
  ctx.rotate(ballRot);
  if (mapId === "arcade") {
    ctx.fillStyle = "#34343f";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#faf3df";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.font = "900 8px Nunito, 'Trebuchet MS', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("8", 0, 2.8);
  } else {
    ctx.fillStyle = "#fff8e7";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.clip();
    if (mapId === "beach") {
      // classic beach ball: six alternating color/white gores + white cap
      const gore = ["#e05a4e", "#f2c14e", "#3b82f6"];
      for (let k = 0; k < 6; k++) {
        if (k % 2 === 0) {
          ctx.fillStyle = gore[k / 2];
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, r + 1, (k / 6) * Math.PI * 2, ((k + 1) / 6) * Math.PI * 2);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.fillStyle = "#fff8e7";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      // plaza football: white ball, black centre pentagon with seams and
      // rim patches (clipped to the ball, spins with it)
      const pent = (cx: number, cy: number, pr: number) => {
        ctx.beginPath();
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
          const vx = cx + Math.cos(a) * pr, vy = cy + Math.sin(a) * pr;
          if (k === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
      };
      ctx.fillStyle = "#2b2b33";
      pent(0, 0, r * 0.34);
      ctx.fill();
      // seams from the centre pentagon to the rim
      ctx.strokeStyle = "rgba(43,43,51,0.75)";
      ctx.lineWidth = 1.4;
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 - Math.PI / 2 + Math.PI / 5;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.34, Math.sin(a) * r * 0.34);
        ctx.lineTo(Math.cos(a) * (r + 1), Math.sin(a) * (r + 1));
        ctx.stroke();
      }
      // rim patches
      ctx.fillStyle = "#2b2b33";
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 - Math.PI / 2 + Math.PI / 5;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95, r * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
  if (afloat) drawWaterline(ctx, x, surfaceY, t, seed, Math.max(10, r * 0.95));
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.arc(x - r * 0.36, by - r * 0.43, Math.max(2, r * 0.2), 0, Math.PI * 2);
  ctx.fill();
}

// World coins: always worth 1. Spinning gold dot with a soft bob so they
// read as pickups next to the ball/photos. t is engine clock (ms).
function drawCoin(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, t: number, seed: number,
  fl: Floater = DRY
) {
  const bob = Math.sin(t / 500 + seed) * 3 + (fl.floating ? fl.bob : 0);
  const yy = y + bob - (fl.floating ? 4 : 0);
  const squash = Math.abs(Math.cos(t / 500 + seed));
  const rx = 4 + squash * 8;
  if (!fl.floating) {
    ctx.fillStyle = "rgba(43,31,22,0.25)";
    ctx.beginPath();
    ctx.ellipse(x, y + 12, 10, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const surfaceY = y + 6;
  ctx.save();
  if (fl.floating) clipAboveWaterline(ctx, x, y - 60, surfaceY, t, seed);
  ctx.translate(x, yy);
  ctx.fillStyle = "#f2c14e";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#c9952f";
  ctx.beginPath();
  ctx.ellipse(0, 0, Math.max(1.5, rx * 0.38), 5.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // foam crest on the exact cut so the coin reads as sitting in the water
  if (fl.floating) drawWaterline(ctx, x, surfaceY, t, seed, 11);
}

function coinSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (h % 1000) / 100;
}

// ---- beach wading look ----
// How much of the traveler's lower body the water swallows (px above the
// feet): ankle-deep at the shoreline, knee-deep at the drop-off, waist+ in
// the deep while a dunk pulls you under.
function wadeCoverFor(zone: string, y: number): number {
  if (zone === "deep") return 22;
  if (zone !== "shallow") return 0;
  const f = Math.min(1, Math.max(0, (y - BEACH_WATER_Y) / Math.max(1, BEACH_DEEP_Y - BEACH_WATER_Y)));
  return 6 + f * 12;
}

// world-space y of the water surface at a wader's feet — spray spawns and
// dies exactly here, never below the white wave
function surfYFor(zone: string, y: number): number {
  return y + 14 - wadeCoverFor(zone, y);
}

// Objects adrift: anything resting in beach water floats — a gentle bob,
// clipped below a foam crest exactly like swimmers, no ground shadow.
// Purely visual: the ball keeps its push physics, coins/photos stay put.
type Floater = { bob: number; floating: boolean; wob: number };
const DRY: Floater = { bob: 0, floating: false, wob: 0 };
function floatFor(mapId: string, wy: number, t: number, seed: number): Floater {
  if (mapId !== "beach" || wy < BEACH_WATER_Y + 4) return DRY;
  return {
    bob: Math.sin(t / 520 + seed) * 2.5,
    floating: true,
    wob: Math.sin(t / 600 + seed * 1.3) * 2,
  };
}


// Beach shells: little pink scallops — fan of ridges from a hinge, cozy
// ink outlines. Loose ones rest on the sand (or bob in the swash); carried
// ones ride beside the holder's head.
function drawShell(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, t: number, seed: number, tint: string,
  held = false,
  fl: Floater = DRY
) {
  const afloat = fl.floating && !held;
  if (!held && !afloat) {
    ctx.fillStyle = "rgba(43,31,22,0.22)";
    ctx.beginPath();
    ctx.ellipse(x, y + 6, 9, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const surfaceY = y + 4;
  ctx.save();
  if (afloat) clipAboveWaterline(ctx, x, y - 60, surfaceY, t, seed);
  ctx.translate(x, y + (afloat ? fl.bob - 2 : 0));
  ctx.rotate(Math.sin(t / 700 + seed) * 0.05);
  // fan: hinge at (0,5), opening upward
  ctx.fillStyle = tint;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 5);
  ctx.arc(0, 5, 9, -Math.PI / 2 - 1.1, -Math.PI / 2 + 1.1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // ridge lines fanning out of the hinge
  ctx.strokeStyle = "rgba(74,55,40,0.45)";
  ctx.lineWidth = 1.4;
  for (let k = -2; k <= 2; k++) {
    const a = -Math.PI / 2 + k * 0.5;
    ctx.beginPath();
    ctx.moveTo(0, 5);
    ctx.lineTo(Math.cos(a) * 8, 5 + Math.sin(a) * 8);
    ctx.stroke();
  }
  // hinge bump + shine
  ctx.fillStyle = shade(tint, -30);
  ctx.beginPath();
  ctx.arc(0, 5, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.arc(-3, -2, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // foam crest on the exact cut so drops in the swash sit in the water
  if (afloat) drawWaterline(ctx, x, surfaceY, t, seed, 10);
}

// Stable per-player wobble seed (MUST NOT derive from position — a moving
// seed scrambles the foam phase every frame and it looks hyperactive).
function seedOf(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (h % 1000) / 10;
}

// The waterline where a swimmer meets the sea: just a wobbly foam lip.
// Nothing else is needed — the submerged body is clipped away, so the real
// painted sea already runs right up to the foam. No strips, no rectangles,
// no translucency: crowds can't stack it into weirdness. No shadow either:
// shadows don't show when you're in the water.
// Foam crest height at offset x — shared by the clip edge and the foam
// stroke so the cut and the wave can never drift apart.
function foamY(x: number, surfaceY: number, t: number, seed: number): number {
  return surfaceY + Math.sin(t / 340 + x / 7 + seed) * 1.6;
}

function drawWaterline(
  ctx: CanvasRenderingContext2D,
  cx: number, surfaceY: number,
  t: number, seed: number,
  hw = 20
) {
  const wob = (x: number) => foamY(x, surfaceY, t, seed);
  // soft glow tucked just under the crest so the clip cut melts away
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 4.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - hw + 1, wob(-hw + 1) + 1.5);
  for (let x = -hw + 5; x <= hw - 1; x += 4) ctx.lineTo(cx + x, wob(x) + 1.5);
  ctx.stroke();
  // crisp crest
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - hw, wob(-hw));
  for (let x = -hw + 4; x <= hw; x += 4) ctx.lineTo(cx + x, wob(x));
  ctx.stroke();
}

// Wavy waterline clip: keeps everything above the foam crest, cuts the rest.
// The crest drawWaterline paints follows this exact edge, so a submerged body
// and its foam can never drift apart. Used by swimmers AND floaters alike.
function clipAboveWaterline(
  ctx: CanvasRenderingContext2D,
  x: number, topY: number, surfaceY: number,
  t: number, seed: number
) {
  ctx.beginPath();
  ctx.moveTo(x - 60, topY);
  ctx.lineTo(x + 60, topY);
  ctx.lineTo(x + 60, foamY(60, surfaceY, t, seed));
  for (let xx = 56; xx >= -60; xx -= 4) ctx.lineTo(x + xx, foamY(xx, surfaceY, t, seed));
  ctx.closePath();
  ctx.clip();
}

export function startEngine(canvas: HTMLCanvasElement, cb: EngineCallbacks) {
  const ctx = canvas.getContext("2d")!;
  let raf = 0;
  let my = { x: 800, y: 600, dir: "down", moving: false, vz: 0, z: 0, crouch: false };
  // stride phase per player: advances with distance actually traveled, so
  // running animates faster and idling freezes — for everyone, uniformly.
  const stride = new Map<string, { x: number; y: number; ph: number; mvx: number; mvy: number }>();
  // dust puffs (run + landings). Toggle with D (debug + preference).
  // Trail dust, STORED STATELESSLY: each dot only remembers its age, seed
  // and owner — its position is derived every frame from the owner's CURRENT
  // feet + facing. A dot therefore cannot detach, drift, or scale away from
  // its player by construction; if the owner leaves, its dots are dropped.
  // Trail dots: dust (run/landings, behind) + water spray (wading). Water
  // dots ignore the dust toggle — they're swim feedback, not decoration.
  // front=true combs ahead of the heading (stop-splash), else behind.
  type TrailDot = { age: number; seed: number; owner: string; kind: "dust" | "water"; front: boolean };
  const trail: TrailDot[] = [];
  let lastPuff = -999;
  const pushDots = (n: number, owner: string, kind: "dust" | "water" = "dust", front = false) => {
    if (kind === "dust" && !cb.dustEnabled()) return;
    for (let i = 0; i < n; i++) {
      if (trail.length > 64) trail.shift();
      trail.push({ age: Math.random() * 0.06, owner, seed: Math.random(), kind, front });
    }
  };
  // Water spray with real arcs: each drop spawns at the waterline (where the
  // legs disappear), fires upward with its own velocity, then gravity pulls
  // it back down into the water. World-space + simulated, unlike dust.
  type SprayDot = {
    age: number; life: number; owner: string;
    x: number; y: number; vx: number; vy: number;
    floorY: number; r: number;
  };
  const spray: SprayDot[] = [];
  const SPRAY_GRAV = 560;
  const pushSpray = (
    n: number, owner: string, cx: number, cy: number,
    o?: { dx?: number; dy?: number; up?: number; spread?: number; big?: boolean }
  ) => {
    for (let i = 0; i < n; i++) {
      if (spray.length > 110) spray.shift();
      const spread = o?.spread ?? 70;
      spray.push({
        age: Math.random() * 0.03,
        life: 0.45 + Math.random() * 0.3,
        owner,
        x: cx + (Math.random() - 0.5) * 16,
        y: cy + (Math.random() - 0.5) * 5,
        vx: (o?.dx ?? 0) + (Math.random() - 0.5) * spread,
        vy: -((o?.up ?? 120) * (0.7 + Math.random() * 0.6)),
        floorY: cy - 2,
        r: (o?.big ? 1.9 : 1.2) + Math.random() * 1.4,
      });
    }
  };
  // ---- beach water state ----
  // Wading slows you; deep water dunks you back to your last dry-side spot
  // with a dark fade. Dunk visuals run for remote swimmers too (sink + fade
  // at their entry point); only the local player gets the camera fade +
  // the actual teleport (their client owns their position).
  const WATER_SLOW = 0.55;
  // Deck stairs: walking up the steps is very slightly slower (flat ground
  // paint, so this is just a feel multiplier in the stairs rect).
  const STAIR_SLOW = 0.8;
  const DUNK_SINK_MS = 550;
  const DUNK_DUR = 1300;
  const DUNK_GRACE_MS = 600;
  let lastSafe = { x: 800, y: 620 };
  let dunkActive = false;
  let dunkT0 = 0;
  let dunkDone = false; // teleport already applied
  let dunkEntryCover = 12; // waterline height when the dunk started
  const dunkSafe = { x: 800, y: 620 };
  let dunkEndAt = -9999;
  const dunkRemote = new Map<string, { t0: number; x: number; y: number; cover: number }>();
  const lastWater = new Map<string, number>();
  const lastFastWater = new Map<string, number>();
  const lastChurn = new Map<string, number>();
  const interp = new Map<string, { x: number; y: number; z: number }>();
  // sit-down hop: per-player sit start times (engine clock) + last sitting
  // flag, so plopping onto a seat plays a quick little hop everywhere.
  const sitWas = new Map<string, boolean>();
  const sitHopStart = new Map<string, number>();
  // pet follow positions, simulated identically on every client from the
  // owner's position (no server physics needed — every client sees the
  // same owner, so every client draws the same pet).
  const pets = new Map<string, { x: number; y: number }>();
  const keys = new Set<string>();
  let lastSend = 0;
  let lastSent = { x: 0, y: 0, dir: "", moving: false, z: -1, crouch: false };
  let lastDrive = "";
  let lastDriveT = 0;
  let spawned = false;
  let lastWarp = 0;
  // spectate glide position (null while following yourself)
  let specCam: { x: number; y: number } | null = null;
  let lastT = -1;
  let fps = 60;
  let mySpd = 0;
  let lastSitting = false;
  // sit-down glide: leaping from where you stand into the seat (the camera
  // rides along instead of snapping), with a little jump arc on the way
  let glideActive = false;
  let glideT0 = 0;
  const glideFrom = { x: 0, y: 0 };
  const glideTo = { x: 0, y: 0 };
  // ball render smoothing: server snapshots arrive at 15hz, so we glide a
  // predicted position instead of snapping to each snapshot (that was the
  // "snappy/laggy" feel).
  let ballSm = { x: 0, y: 0 };
  let ballSmInit = false;
  let ballSrv = { x: 0, y: 0 };
  let ballSrvT = -1;
  // race-car render smoothing: server snapshots arrive at 20Hz, so each car
  // glides toward its snapshot (position + shortest-path angle) instead of
  // snapping per snapshot — same judder the ball smoothing fixed.
  const carSm = new Map<number, { x: number; y: number; angle: number }>();
  // fountain coin tosses: { by, t0 } in engine-clock ms. Each plays a coin
  // arc from the tosser to the fountain water, then a splash + ripple.
  const FOUNTAIN_TOSS_MS = 650;
  const FOUNTAIN_RIPPLE_MS = 900;
  const FOUNTAIN_WATER = { x: 800, y: 564 };
  const fountainTosses: { by: string; t0: number }[] = [];
  const fountainRipples: { t0: number }[] = [];
  // last frame's camera + own position, so snapshot() can map the player
  // back onto a pixel copy of the canvas
  const snapView = { camX: 0, camY: 0, scale: 1, dpr: 1 };

  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return; // don't steal chat typing
    // Swallow browser chords (save/bookmark/find/reload...) while actually
    // playing so crouch-chords don't trigger them. A few chords (notably
    // Ctrl+W) are hard-reserved by the browser and CANNOT be intercepted —
    // that's what the rebindable non-modifier keys are for.
    if (down && (e.ctrlKey || e.metaKey) && !cb.isMenuOpen()) e.preventDefault();
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    if (down) keys.add(k);
    else keys.delete(k);
  };
  const kd = onKey(true), ku = onKey(false);
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);
  // lost focus (alt-tab) must not leave movement keys stuck down
  const onBlur = () => keys.clear();
  window.addEventListener("blur", onBlur);

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  }  resize();
  window.addEventListener("resize", resize);

  // begin a sit/stand leap: glide from -> to over ~300ms, facing the travel
  // direction like a moving jump (the camera rides along with you)
  const startGlide = (fx: number, fy: number, tx: number, ty: number, now: number) => {
    glideActive = true; glideT0 = now;
    glideFrom.x = fx; glideFrom.y = fy;
    glideTo.x = tx; glideTo.y = ty;
    const gdx = tx - fx, gdy = ty - fy;
    if (Math.hypot(gdx, gdy) > 4) {
      my.dir = Math.abs(gdx) > Math.abs(gdy) ? (gdx < 0 ? "left" : "right") : (gdy < 0 ? "up" : "down");
    }
  };

  function loop(t: number) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = canvas.width / dpr, ch = canvas.height / dpr;
    const state = cb.getState();
    const mapId = state?.mapId || "plaza";
    const me = state?.players.find((p) => p.id === cb.getMyId());
    // Walk-in café: players in a plaza room render the café interior while
    // their area is "cafe" — everyone else keeps seeing the plaza.
    const myArea = (me as any)?.area || null;
    const effMapId = myArea === "cafe" && mapId === "plaza" ? "cafe" : mapId;
    const map = MAPS[effMapId] || MAPS.plaza;
    // Spawn exactly once per engine lifetime, pushed out of any collider —
    // never overwrite the local position with the stale server echo (that
    // caused rubber-banding).
    if (me && !spawned) {
      const s0 = collide(me.x, me.y, 16, map);
      my = { x: s0.x, y: s0.y, dir: me.dir, moving: false, vz: 0, z: 0, crouch: false };
      spawned = true;
    }
    // If the server moved us (fresh spawn far away), snap.
    if (me && spawned && Math.hypot(me.x - my.x, me.y - my.y) > 400) {
      my.x = me.x; my.y = me.y;
    }
    // Server teleports (football kickoff spots): snap exactly, whatever the
    // distance — the >400px rule misses short hops across the pitch.
    if (me && (me as any).warp && (me as any).warp !== lastWarp) {
      lastWarp = (me as any).warp;
      my.x = me.x; my.y = me.y;
      my.z = 0; my.vz = 0;
      glideActive = false;
    }
    // Football: players on the pitch are clamped client-side too (mirrors
    // the server), so the pitch edge feels solid instead of rubber-banding.
    const fbState = (state as any)?.football;
    const fbMatchOn = effMapId === "plaza" && fbState &&
      (fbState.state === "play" || fbState.state === "goal" || fbState.state === "end");
    let fbMeMatch = false;
    if (fbMatchOn) {
      const meId0 = cb.getMyId();
      fbMeMatch = [...(fbState.teamA || []), ...(fbState.teamB || [])].some((e: any) => e.id === meId0);
    }
    // movement clamp only while the ball is live (play/celebration)
    const fbMeLive = fbMeMatch && fbState &&
      (fbState.state === "play" || fbState.state === "goal");

    const dt = lastT < 0 ? 1 / 60 : Math.min(0.05, Math.max(0.001, (t - lastT) / 1000));
    lastT = t;
    fps += ((dt > 0 ? 1 / dt : 60) - fps) * 0.05;

    const sitting = !!me?.sitting;
    // Spectating: sitting in a pitch stand during a live match locks the
    // camera to midfield and unlocks the match UI (dim + score +
    // announcements). Stand up (or the final whistle) and it all lets go.
    const spectating = !!(fbMatchOn && me && me.sitting && me.seatId &&
      me.seatId.indexOf("plaza-stand-") === 0);
    let dx = 0, dy = 0;
    const B = cb.binds();
    if (keys.has(B.up) || keys.has("arrowup")) dy -= 1;
    if (keys.has(B.down) || keys.has("arrowdown")) dy += 1;
    if (keys.has(B.left) || keys.has("arrowleft")) dx -= 1;
    if (keys.has(B.right) || keys.has("arrowright")) dx += 1;
    // joystick drivers steer their car, not their legs: WASD/arrows feed
    // the car sim (W accelerate, S brake/reverse, A/D steer) and feet plant.
    const driving = !sitting && cb.isDriving() && !cb.isFrozen() && !cb.isTvOpen() && !cb.isViewerOpen() && !cb.isCamOpen() && !cb.isBoardOpen();
    const inputMove = !driving && !cb.isFrozen() && !cb.isTvOpen() && !cb.isViewerOpen() && !cb.isCamOpen() && !cb.isBoardOpen() && (dx !== 0 || dy !== 0);
    // sitters broadcast their wiggle (pushing a direction stands you up) but
    // don't steer until the server actually stands them
    const moving = !sitting && !driving && inputMove;
    // run / crouch modifiers. "<" is the crouch key; Ctrl is not bound to
    // anything anymore (its chords belong to the browser).
    const crouchHeld = !sitting && keys.has(B.crouch);
    const running = !sitting && keys.has(B.run);
    const sprinting = running && !crouchHeld;
    // wading drag: the shallows (and the deep lip) slow every step
    const myZonePre = effMapId === "beach" ? beachZone(my.y) : "sand";
    const waterSlow = myZonePre === "sand" ? 1 : WATER_SLOW;
    // stairs drag: the deck steps + a small margin cost a little speed
    const onStairs = effMapId === "plaza" &&
      my.x > DECK_STAIRS.x - 10 && my.x < DECK_STAIRS.x + DECK_STAIRS.w + 10 &&
      my.y > DECK_STAIRS.y - 16 && my.y < DECK.y + DECK.h + 16;
    const stairSlow = onStairs ? STAIR_SLOW : 1;
    const baseSpeed = (crouchHeld ? (running ? 130 : 90) : running ? 240 : 175) * waterSlow * stairSlow;
    my.crouch = crouchHeld;
    if (!lastSitting && sitting && me) {
      // just sat down: leap from where we stand into the seat
      startGlide(my.x, my.y, me.x, me.y, t);
    } else if (lastSitting && !sitting && me) {
      // just stood up: same jump in reverse — leap off the seat down to the
      // stand spot, camera following you down off the furniture
      startGlide(my.x, my.y, me.x, me.y, t);
    }
    if (glideActive) {
      const gAge = t - glideT0, GD = 300;
      if (gAge >= GD || Math.hypot(glideTo.x - my.x, glideTo.y - my.y) < 1.5) {
        glideActive = false;
        if (me) { my.x = me.x; my.y = me.y; my.dir = me.dir; }
        my.z = 0; my.vz = 0;
        sitHopStart.delete(cb.getMyId());
        if (effMapId === "beach" && beachZone(my.y) !== "sand") pushSpray(4, cb.getMyId(), my.x, surfYFor(beachZone(my.y), my.y), { up: 130, spread: 90 });
        else pushDots(2, cb.getMyId()); // landing poof
      } else {
        const k = gAge / GD, e = 1 - (1 - k) * (1 - k);
        my.x = glideFrom.x + (glideTo.x - glideFrom.x) * e;
        my.y = glideFrom.y + (glideTo.y - glideFrom.y) * e;
        my.z = Math.sin((gAge / GD) * Math.PI) * 16;
        my.vz = 0;
      }
      my.crouch = false;
    } else if (sitting && me) {
      // pinned to the seat — the server is authoritative, mirror it exactly
      my.x = me.x; my.y = me.y; my.dir = me.dir;
      my.z = 0; my.vz = 0;
      my.moving = false; my.crouch = false;
    }
    lastSitting = sitting;
    const px0 = my.x, py0 = my.y;
    // dunk lock: sinking/transitioning owns your feet until it lands
    const dunkLocked = dunkActive;
    const canSteer = moving && !glideActive && !dunkLocked;
    // no steering mid-glide — the leap owns your feet until it lands
    if (canSteer) {
      const len = Math.hypot(dx, dy);
      const speed = baseSpeed * dt;
      const nx = my.x + (dx / len) * speed;
      const ny = my.y + (dy / len) * speed;
      const fixed = collide(nx, ny, 16, map);
      my.x = fixed.x; my.y = fixed.y;
      my.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
    }
    // pitch edge (same numbers as the server clamp): footballers stay in,
    // goal boxes included
    if (fbMeLive && !glideActive) {
      my.x = Math.max(PLAZA_FIELD.x - 26, Math.min(PLAZA_FIELD.x + PLAZA_FIELD.w + 26, my.x));
      my.y = Math.max(PLAZA_FIELD.y - 8, Math.min(PLAZA_FIELD.y + PLAZA_FIELD.h + 8, my.y));
    }
    my.moving = dunkLocked ? false : sitting ? inputMove : moving;
    // measured speed (EMA of real displacement — walls slow you for real)
    if (dt > 0) {
      const inst = Math.hypot(my.x - px0, my.y - py0) / dt;
      mySpd += (inst - mySpd) * 0.15;
    }
    // ---- beach dunk state machine (local player) ----
    // Track the last non-deep spot; stepping grounded into the deep starts
    // the sink, the fade covers the hop back to shore.
    let dunkAge = dunkActive ? t - dunkT0 : -1;
    if (effMapId === "beach" && !sitting && !glideActive) {
      const zoneNow = beachZone(my.y);
      if (!dunkActive) {
        if (zoneNow !== "deep") {
          lastSafe.x = my.x; lastSafe.y = my.y;
        } else if (my.z < 8 && t - dunkEndAt > DUNK_GRACE_MS) {
          dunkActive = true; dunkDone = false; dunkT0 = t; dunkAge = 0;
          dunkSafe.x = lastSafe.x; dunkSafe.y = Math.min(lastSafe.y, BEACH_DEEP_Y - 34);
          dunkEntryCover = wadeCoverFor("shallow", Math.min(my.y, BEACH_DEEP_Y - 1));
          my.moving = false; my.z = 0; my.vz = 0;
          // the drop-in burst: water kicked up all around the entry point
          pushSpray(7, cb.getMyId(), my.x, surfYFor("shallow", Math.min(my.y, BEACH_DEEP_Y - 1)), { up: 150, spread: 130, big: true });
        }
      } else {
        my.moving = false;
        // churn: the surface keeps bubbling while you go under
        if (!dunkDone && t - (lastChurn.get(cb.getMyId()) ?? -9999) > 80) {
          lastChurn.set(cb.getMyId(), t);
          pushSpray(1, cb.getMyId(), my.x, my.y + 14 - dunkEntryCover, { up: 120, spread: 80 });
        }
        if (!dunkDone && dunkAge >= DUNK_SINK_MS) {
          dunkDone = true;
          my.x = dunkSafe.x; my.y = dunkSafe.y;
          my.z = 0; my.vz = 0;
        }
        if (dunkAge >= DUNK_DUR) {
          dunkActive = false; dunkEndAt = t; dunkAge = -1;
          lastSafe.x = my.x; lastSafe.y = my.y;
        }
      }
    } else if (dunkActive) {
      // left the beach mid-dunk (or sat down): settle immediately
      dunkActive = false; dunkEndAt = t; dunkAge = -1;
    }
    const dunkAlpha = !dunkActive || dunkAge < 0 ? 0 : dunkAge < DUNK_SINK_MS
      ? 0.75 * (dunkAge / DUNK_SINK_MS)
      : dunkAge < 800 ? 0.75
      : 0.75 * Math.max(0, 1 - (dunkAge - 800) / (DUNK_DUR - 800));
    // joystick drivers hold their car still in their hands: feet plant,
    // WASD streams to the car sim at ~20Hz instead of moving the body.
    if (driving) {
      my.moving = false;
      my.crouch = false;
      const inp = {
        w: keys.has(B.up) || keys.has("arrowup"),
        s: keys.has(B.down) || keys.has("arrowdown"),
        a: keys.has(B.left) || keys.has("arrowleft"),
        d: keys.has(B.right) || keys.has("arrowright"),
      };
      const dl = `${inp.w ? 1 : 0}${inp.a ? 1 : 0}${inp.s ? 1 : 0}${inp.d ? 1 : 0}`;
      // input changes go out instantly; held inputs re-send at the 20Hz
      // sim rate so the server never steers on stale keys (the old 120ms
      // heartbeat made driving feel laggy)
      if (dl !== lastDrive || t - lastDriveT > 50) {
        lastDrive = dl;
        lastDriveT = t;
        cb.sendDrive(inp);
      }
    }
    // jump: snappy little hop (strong gravity, no float), full air control —
    // steering mid-air is a feature. Hold jump to bunny-hop. No jumping
    // seats, and no hopping behind the TV panel (or while driving).
    if (!sitting && !driving && !dunkActive && !cb.isFrozen() && !cb.isTvOpen() && !cb.isViewerOpen() && !cb.isCamOpen() && !cb.isBoardOpen() && keys.has(B.jump) && my.z === 0 && my.vz === 0) {
      my.vz = 270;
      // launching out of the water kicks up a strong burst
      if (effMapId === "beach" && beachZone(my.y) !== "sand") {
        pushSpray(6, cb.getMyId(), my.x, surfYFor(beachZone(my.y), my.y), { up: 190, spread: 110, big: true });
      }
    }
    // gravity stays out of the sit-glide's way (it brings its own arc)
    if (!glideActive && (my.vz !== 0 || my.z > 0)) {
      my.vz -= 1000 * dt;
      my.z += my.vz * dt;
      if (my.z <= 0) {
        my.z = 0;
        my.vz = 0;
        if (effMapId === "beach" && beachZone(my.y) !== "sand") pushSpray(8, cb.getMyId(), my.x, surfYFor(beachZone(my.y), my.y), { up: 200, spread: 110, big: true });
        else pushDots(3, cb.getMyId()); // landing poof
      }
    }

    // 20Hz move cap, but skip redundant packets: idle players send a
    // heartbeat every 500ms instead of 20/s. Halves upstream in busy rooms.
    // While airborne the jump arc changes every frame — send at up to ~33Hz
    // so remote viewers get twice the vertical samples (still tiny packets,
    // only for the ~0.5s you're in the air).
    const airborne = my.z !== 0 || my.vz !== 0;
    if (t - lastSend > (airborne ? 30 : 50)) {
      const lx = lastSent.x, ly = lastSent.y;
      const samePos = Math.hypot(my.x - lx, my.y - ly) < 0.5;
      const sameFlags =
        lastSent.dir === my.dir && lastSent.moving === my.moving &&
        lastSent.z === my.z && lastSent.crouch === my.crouch &&
        (lastSent as any).sprint === sprinting;
      if (!samePos || !sameFlags || t - lastSend > 500) {
        lastSend = t;
        lastSent = { x: my.x, y: my.y, dir: my.dir, moving: my.moving, z: my.z, crouch: my.crouch, sprint: sprinting } as any;
        cb.sendMove(my.x, my.y, my.dir, my.moving, my.z, my.crouch, sprinting);
      }
    }

    // --- cover-fit moving camera: fills the whole window, no bars ---
    // Everyone sees at least the 960x600 base view; larger screens just see
    // a little more around the edges instead of black letterbox bars.
    const scale = Math.max(cw / VIEW_W, ch / VIEW_H);
    const vw = cw / scale, vh = ch / scale;
    let camX: number, camY: number;
    // base camera always follows you first — the spectate glide below takes
    // it from there (starting it at the field would skip the pan entirely)
    if (map.width <= vw) camX = (map.width - vw) / 2; // center small maps
    else camX = Math.max(0, Math.min(map.width - vw, my.x - vw / 2));
    if (map.height <= vh) camY = (map.height - vh) / 2;
    else camY = Math.max(0, Math.min(map.height - vh, my.y - vh / 2));
    // spectate glide: pan between your seat and midfield (~1.2s each way)
    // instead of cutting. Re-sitting mid-glide just retargets it.
    const specK = Math.min(1, dt * 2.8);
    if (spectating) {
      if (!specCam) specCam = { x: camX, y: camY };
      const fcx = PLAZA_FIELD.x + PLAZA_FIELD.w / 2;
      const fcy = PLAZA_FIELD.y + PLAZA_FIELD.h / 2;
      const tx = map.width <= vw ? (map.width - vw) / 2 : Math.max(0, Math.min(map.width - vw, fcx - vw / 2));
      const ty = map.height <= vh ? (map.height - vh) / 2 : Math.max(0, Math.min(map.height - vh, fcy - vh / 2));
      specCam.x += (tx - specCam.x) * specK;
      specCam.y += (ty - specCam.y) * specK;
      camX = specCam.x; camY = specCam.y;
    } else if (specCam) {
      // standing up (or final whistle): glide back to you, then let go
      specCam.x += (camX - specCam.x) * specK;
      specCam.y += (camY - specCam.y) * specK;
      if (Math.hypot(camX - specCam.x, camY - specCam.y) < 2) specCam = null;
      else { camX = specCam.x; camY = specCam.y; }
    }
    snapView.camX = camX; snapView.camY = camY;
    snapView.scale = scale; snapView.dpr = dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, cw, ch);
    ctx.scale(scale, scale);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, vw, vh);
    ctx.clip();

    // depth pass: ground first, then props + ball + travelers back-to-front
    // by ground-contact y — walk behind a tree and it hides you.
    const props: Prop[] = [];
    const snakeBusy = !!state?.players?.some((p) => (p as Player).snakeLock);
    const pongBusy = !!state?.players?.some((p) => (p as Player).pongLock);
    drawMap(ctx, effMapId, camX, camY, vw, vh, t, props, !!state?.tv, state?.board || null, snakeBusy, pongBusy, state?.ah ?? null);
    type Drawable = { y: number; draw: () => void };
    const drawables: Drawable[] = [...props];
    const overheads: { p: Player; sx: number; sy: number; isMe: boolean; isFriend: boolean }[] = [];

    // Ball smoothing state: server snapshots arrive at 15hz, so a free ball
    // glides from a short prediction instead of snapping per snapshot (that
    // was the old "snappy/laggy" feel). Carried balls skip this entirely —
    // they're rendered from the holder's live position below, so movement
    // can never make them lag, trail or flicker.
    const ball = state?.ball;
    const ballHeld = !!ball?.holder;
    // The ball lives outside: café guests never see the plaza ball.
    const showBall = !!ball && effMapId !== "cafe";
    if (showBall && !ballHeld) {
      if (!ballSmInit) {
        ballSm = { x: ball.x, y: ball.y };
        ballSrv = { x: ball.x, y: ball.y };
        ballSrvT = t;
        ballSmInit = true;
      } else if (Math.hypot(ball.x - ballSrv.x, ball.y - ballSrv.y) > 0.5) {
        ballSrv = { x: ball.x, y: ball.y };
        ballSrvT = t;
      }
      // predict forward from the latest snapshot (max 120ms), then glide
      const age = Math.max(0, Math.min(0.12, (t - ballSrvT) / 1000));
      const tx = ballSrv.x + ball.vx * age;
      const ty = ballSrv.y + ball.vy * age;
      if (Math.hypot(tx - ballSm.x, ty - ballSm.y) > 220) {
        ballSm.x = tx; ballSm.y = ty; // genuine teleport (new room) — snap
      } else {
        const k = Math.min(1, dt * 12);
        ballSm.x += (tx - ballSm.x) * k;
        ballSm.y += (ty - ballSm.y) * k;
      }
      const bsx = ballSm.x, bsy = ballSm.y;
      const bfl = floatFor(effMapId, bsy, t, 3.7);
      drawables.push({
        y: bsy,
        draw: () => drawBall(ctx, bsx - camX, bsy - camY, ball.vx, ball.vy, dt, effMapId, false, bfl, t, 3.7),
      });
    } else if (ball) {
      ballSmInit = false;
    }

    // Only travelers on your side of the café door share your room view.
    const players = [...(state?.players || [])].filter(
      (p) => ((p as any).area || null) === myArea
    );
    // live owner lookup for the stateless trail below
    const present = new Map<string, { x: number; y: number; dir: string; mvx: number; mvy: number; z: number }>();
    for (const p of players) {
      const isMe = p.id === cb.getMyId();
      let px = p.x, py = p.y;
      let pzSm = p.z || 0;
      if (isMe) { px = my.x; py = my.y; pzSm = my.z; p.moving = my.moving; p.dir = my.dir; }
      else {
        // Frame-rate independent smoothing tuned for ~20Hz snapshots:
        // k matches the old 0.2-at-60fps feel but behaves the same at any
        // fps, so others glide instead of stuttering on slow/fast monitors.
        // Large jumps (spawns, football kickoff warps) snap instantly.
        // z (jump height) gets the same treatment with a faster time
        // constant: raw snapshots arrive stair-stepped at 20Hz (a ~0.5s hop
        // is only ~10 samples), which read as laggy next to the smoothed
        // x/y. The faster k keeps takeoff snappy while turning the steps
        // into a fluid arc; landings snap so nobody hovers.
        const cur = interp.get(p.id) || { x: p.x, y: p.y, z: p.z || 0 };
        const tz = p.z || 0;
        if (Math.hypot(p.x - cur.x, p.y - cur.y) > 220) {
          cur.x = p.x; cur.y = p.y; cur.z = tz;
        } else {
          const k = 1 - Math.exp(-dt * 12);
          cur.x += (p.x - cur.x) * k;
          cur.y += (p.y - cur.y) * k;
          if (tz === 0 && cur.z < 6) cur.z = 0;
          else {
            const kz = 1 - Math.exp(-dt * 18);
            cur.z += (tz - cur.z) * kz;
            if (tz === 0 && cur.z < 0.6) cur.z = 0;
          }
        }
        interp.set(p.id, cur);
        px = cur.x; py = cur.y; pzSm = cur.z;
      }
      const snap = { ...p, x: px, y: py };
      const psx = px - camX, psy = py - camY;
      // stride follows real displacement: sprinting animates faster, for all.
      // The true motion vector (diagonals included) is retained while idle so
      // the trail combs behind the last heading instead of snapping to axes.
      const prev = stride.get(p.id) || { x: px, y: py, ph: 0, mvx: 0, mvy: 1 };
      const stepDist = Math.hypot(px - prev.x, py - prev.y);
      const ph = prev.ph + stepDist * 0.045;
      let mvx = prev.mvx, mvy = prev.mvy;
      if (stepDist > 0.5) {
        mvx = (px - prev.x) / stepDist;
        mvy = (py - prev.y) / stepDist;
      }
      stride.set(p.id, { x: px, y: py, ph, mvx, mvy });
      present.set(p.id, { x: px, y: py, dir: p.dir, mvx, mvy, z: pzSm });
      const pz = pzSm;
      const pcrouch = isMe ? my.crouch : !!p.crouch;
      const psitting = !!p.sitting;
      // sit-down hop: a quick up-and-settle the moment someone sits
      const wasSit = sitWas.get(p.id) ?? false;
      // any sit-state flip — plopping down AND hopping back up — pops a
      // little jump, for everyone watching
      if (psitting !== wasSit) sitHopStart.set(p.id, t);
      sitWas.set(p.id, psitting);
      let hopLift = 0;
      {
        const st = sitHopStart.get(p.id);
        if (st !== undefined) {
          const age = t - st;
          if (age < 380) hopLift = Math.sin((age / 380) * Math.PI) * 12;
          else sitHopStart.delete(p.id);
        }
      }
      // our own sit-down already arcs via the glide — don't stack the hops
      if (isMe && glideActive) hopLift = 0;
      const anim = { step: Math.sin(ph), z: pz + hopLift, crouch: pcrouch, sitting: psitting };
      // run dust for fast grounded movers (anyone sprinting)
      const spd = dt > 0 ? stepDist / dt : 0;
      const zoneP = effMapId === "beach" ? beachZone(py) : "sand";
      const inWater = zoneP === "shallow" || zoneP === "deep";
      const grounded = pz < 0.5;
      const sprintNow = isMe ? (sprinting && !!p.moving) : (!!(p as any).sprint && !!p.moving);
      if (p.moving && grounded && !pcrouch && spd > 210 && !inWater && t - lastPuff > 110) {
        lastPuff = t;
        pushDots(1, p.id);
      }
      // wading spray: drops kicked up from the waterline (where the legs
      // vanish), arcing up and back down. Sprinting sprays harder.
      // Sprint timestamps power the stop-splash below.
      const surfY = surfYFor(zoneP, py);
      if (p.moving && grounded && !psitting && inWater) {
        const fast = sprintNow && !pcrouch;
        if (fast) lastFastWater.set(p.id, t);
        const interval = fast ? 80 : 150;
        const lastW = lastWater.get(p.id) ?? -9999;
        if (t - lastW > interval) {
          lastWater.set(p.id, t);
          pushSpray(fast ? 2 : 1, p.id, px, surfY, {
            dx: -mvx * (fast ? 60 : 30), dy: -mvy * (fast ? 60 : 30),
            up: fast ? 120 : 85, spread: 50,
          });
        }
      }
      // stop-after-sprint: halting within ~0.6s of sprinting in water
      // hurls a burst ahead of you (plus a dribble behind)
      if (!p.moving && grounded && !psitting) {
        const lf = lastFastWater.get(p.id) ?? -9999;
        if (lf > 0 && t - lf < 600) {
          lastFastWater.set(p.id, -9999);
          const nearWater = inWater || (effMapId === "beach" && Math.abs(py - BEACH_WATER_Y) < 70);
          if (nearWater) {
            pushSpray(4, p.id, px, surfY, {
              dx: mvx * 110, dy: mvy * 110 - 20, up: 150, spread: 75, big: true,
            });
            pushSpray(2, p.id, px, surfY, { dx: -mvx * 35, up: 95, spread: 50 });
          }
        }
      }
      // dunk + wading look: the surface stays pinned while the BODY slides
      // down through it. Waders get a low fixed cover over the boots (it
      // stays put when they jump — the sprite rises out of it); dunkers
      // sink through the same fixed surface until nothing shows.
      // Locals use the dunk state machine above; remote swimmers sink at
      // their frozen entry point, then walk out wherever the owner's
      // teleport glided them to.
      // NOTE: cover ignores airborne height on purpose — py is ground pos,
      // the clip stays at the ground waterline while the jump arc rises.
      const SINK_DROP = 52; // full sink slides the sprite this far down
      let coverPx = !psitting ? wadeCoverFor(zoneP, py) : 0;
      let sinkY = 0;
      let sinkK01 = 0; // 0 dry → 1 fully under (ramps the churn, no popping)
      let resurfA = 1; // resurface fade-in (remote swimmers glide home)
      // where the traveler + its surface draw this frame (remotes freeze at
      // the dunk entry while going under)
      let drawPx = px, drawPy = py;
      let drawSnap = snap;
      if (isMe && dunkActive && dunkAge >= 0) {
        if (!dunkDone) {
          // going under: surface frozen at the entry waterline, ease-in drop
          const k = Math.min(1, dunkAge / DUNK_SINK_MS);
          coverPx = dunkEntryCover;
          sinkY = k * k * SINK_DROP;
          sinkK01 = k;
        } else {
          // teleported home under the dark fade: normal shallow cover
          coverPx = !psitting ? wadeCoverFor(zoneP, py) : 0;
        }
      } else if (!isMe && effMapId === "beach" && !psitting) {
        const deepNow = beachZone(py) === "deep" && grounded;
        let entry = dunkRemote.get(p.id);
        if (deepNow && !entry) {
          entry = { t0: t, x: px, y: py, cover: wadeCoverFor("shallow", Math.min(py, BEACH_DEEP_Y - 1)) };
          dunkRemote.set(p.id, entry);
          pushSpray(6, p.id, px, entry.y + 14 - entry.cover, { up: 145, spread: 120, big: true });
        }
        if (entry) {
          const age = t - entry.t0;
          if (age > 1200 || (!deepNow && age > DUNK_SINK_MS + 300)) {
            dunkRemote.delete(p.id);
          } else if (age < DUNK_SINK_MS) {
            const k = age / DUNK_SINK_MS;
            coverPx = entry.cover;
            sinkY = k * k * SINK_DROP;
            sinkK01 = k;
            if (t - (lastChurn.get(p.id) ?? -9999) > 90) {
              lastChurn.set(p.id, t);
              pushSpray(1, p.id, entry.x, entry.y + 14 - entry.cover, { up: 110, spread: 70 });
            }
            // frozen at the entry point while going under
            drawPx = entry.x; drawPy = entry.y;
            drawSnap = { ...snap, x: entry.x, y: entry.y };
          } else {
            // resurfacing where the owner swam back to: body fades back in
            coverPx = wadeCoverFor(zoneP, py);
            sinkY = 0;
            resurfA = Math.min(1, (age - DUNK_SINK_MS) / 300);
          }
        }
      }
      {
        // Submerged rendering: everything below the fixed surface line is
        // clipped away so the painted sea shows through — seamless with any
        // backdrop, and it swallows boots, shadow, tails and wings alike.
        // Fully sunk (mid-dunk) draws nothing but the churned surface.
        const dx0 = drawPx - camX, dy0 = drawPy - camY;
        const snap0 = drawSnap, yo = sinkY, cv = coverPx;
        const seed0 = seedOf(p.id);
        const fade = resurfA, ramp = sinkK01;
        // sprite top (tallest hat) clears the surface only once sunk deep:
        // hidden when even the hat tip sits below the fixed surface line
        const gone = cv > 0.5 && yo > 60 - cv;
        // fixed surface: pinned to the ground pos, NOT riding the sink
        const surfaceY = dy0 + 14 - cv;
        if (!gone) {
          drawables.push({
            y: drawPy,
            draw: () => {
              ctx.save();
              if (fade < 1) ctx.globalAlpha = Math.max(0, fade);
              // wavy clip edge tracing the exact foam crest below
              if (cv > 0.5) clipAboveWaterline(ctx, dx0, dy0 - 90, surfaceY, t, seed0);
              drawTraveler(ctx, snap0, dx0, dy0 + yo, t, isMe, anim);
              ctx.restore();
              // unclipped so the soft under-glow survives the cut
              if (cv > 0.5) {
                ctx.save();
                if (fade < 1) ctx.globalAlpha = Math.max(0, fade);
                drawWaterline(ctx, dx0, surfaceY, t, seed0);
                ctx.restore();
              }
            },
          });
        } else {
          // all the way under: churned water ramping in with the sink —
          // never a hard white pop
          drawables.push({
            y: drawPy,
            draw: () => {
              const a = 0.5 * ramp;
              if (a > 0.01) {
                ctx.globalAlpha = a;
                ctx.fillStyle = "#e8f6fd";
                ctx.beginPath();
                ctx.ellipse(dx0, surfaceY + 4, 12 + 8 * ramp, 5 + 3 * ramp, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
              }
              drawWaterline(ctx, dx0, surfaceY, t, seed0);
            },
          });
        }
        // resurface crossfade: churn settles as the body reforms
        if (fade < 1 && cv > 0.5) {
          drawables.push({
            y: drawPy + 1,
            draw: () => {
              ctx.globalAlpha = 0.5 * (1 - fade);
              ctx.fillStyle = "#e8f6fd";
              ctx.beginPath();
              ctx.ellipse(dx0, surfaceY + 4, 20, 8, 0, 0, Math.PI * 2);
              ctx.fill();
              ctx.globalAlpha = 1;
            },
          });
        }
      }
      // fully submerged (or still reforming): no name tag over empty water
      {
        const goneTag = coverPx > 0.5 && sinkY > 60 - coverPx;
        if (!goneTag && resurfA >= 0.5) overheads.push({ p: snap, sx: psx, sy: psy, isMe, isFriend: !isMe && cb.friendIds().includes((p as Player & { userId?: string | null }).userId || "") });
      }

      // mini-you pet: trails behind its owner's heading. The motion vector
      // is retained while idle, so the pet settles in behind you when you
      // stop instead of snapping to a fixed side — and parks once close.
      const pet = getAvatar(snap).pet;
      if (pet && pet.kind !== "none") {
        let h = 0;
        for (let ci = 0; ci < p.id.length; ci++) h = (h * 31 + p.id.charCodeAt(ci)) | 0;
        const side = h % 2 === 0 ? 1 : -1;
        const flying = isFlyingPet(pet.kind);
        const backDist = flying ? 18 : 32;
        // perpendicular nudge so it never sits directly inside your boots
        let tx = px - mvx * backDist + -mvy * side * 9;
        let ty = py - mvy * backDist + mvx * side * 9 + (flying ? -28 : 4);
        // ground pets won't swim: while the owner wades, they wait on the
        // shore tracking alongside, and fall back in behind on dry land
        if (!flying && effMapId === "beach" && beachZone(py) !== "sand") {
          tx = Math.max(40, Math.min(1560, px));
          ty = BEACH_WATER_Y - 26;
        }
        const cur = pets.get(p.id);
        if (!cur) {
          pets.set(p.id, { x: tx, y: ty });
        } else {
          const dx = tx - cur.x, dy = ty - cur.y;
          if (Math.hypot(dx, dy) < 2.5) {
            cur.x = tx;
            cur.y = ty;
          } else {
            const k = Math.min(1, dt * 4.5);
            cur.x += dx * k;
            cur.y += dy * k;
          }
        }
        const pp = pets.get(p.id)!;
        const petSnap = { ...pet };
        const ppx = pp.x, ppy = pp.y;
        drawables.push({
          y: flying ? py - 1 : ppy,
          draw: () => drawPet(ctx, petSnap, ppx - camX, ppy - camY, t, p.dir),
        });
      } else {
        pets.delete(p.id);
      }
    }
    // Carried ball: drawn from the holder's LIVE rendered position (same
    // frame, same coordinates as their cloak), floating overhead at a fixed
    // height whatever way they face — riding their jump arc up and down.
    // Ground-contact y sorts just above the holder so it always paints over
    // them — never hidden, never trailing.
    if (showBall && ballHeld && ball.holder) {
      const o = present.get(ball.holder);
      if (o) {
        const hx = o.x, hy = o.y, hz = o.z || 0;
        drawables.push({
          y: hy + 2,
          draw: () => drawBall(ctx, hx - camX, hy - 32 - camY - hz, 0, 0, dt, effMapId, true, DRY, t),
        });
      } else {
        // holder left / not rendered yet — fall back to the server spot
        const bsx = ball.x, bsy = ball.y;
        drawables.push({
          y: bsy,
          draw: () => drawBall(ctx, bsx - camX, bsy - camY, 0, 0, dt, effMapId, true),
        });
      }
    }
    // World coins: little spinning pickups, y-sorted like everything else.
    // Plaza pickups only — the café floor stays clear.
    const coins = effMapId === "cafe" ? [] : (state as any)?.coins || [];
    for (const c of coins) {
      const fx = c.x, fy = c.y;
      const csd = coinSeed(String(c.id));
      const cfl = floatFor(effMapId, fy, t, csd);
      drawables.push({
        y: fy,
        draw: () => drawCoin(ctx, fx - camX, fy - camY, t, csd, cfl),
      });
    }
    // Shared polaroids: little blank cards lying on the ground (y-sorted
    // like everything else) or riding overhead in their holder's hands —
    // same head-spot as a carried ball. The picture itself only ever shows
    // in the viewer popup, never on the object.
    const photos = (state?.photos || []).filter(
      (ph) => ph.holder || ((ph as any).area || null) === myArea
    );
    for (const ph of photos) {
      if (!ph.holder) {
        const fx = ph.x, fy = ph.y;
        const psd = coinSeed(String(ph.id));
        const pfl = floatFor(effMapId, fy, t, psd);
        drawables.push({
          y: fy,
          draw: () => drawPhoto(ctx, fx - camX, fy - camY, false, pfl, t, psd),
        });
      } else {
        const o = present.get(ph.holder);
        if (o) {
          const hx = o.x, hy = o.y, hz = o.z || 0;
          drawables.push({
            y: hy + 2,
            draw: () => drawPhoto(ctx, hx - camX, hy - 32 - camY - hz, true, DRY, t),
          });
        }
        // holder on the other side of the café door: their photo stays
        // with them — don't leave a stray copy on our floor
      }
    }
    // Beach shells: loose ones lie y-sorted (floating in the swash), carried
    // ones ride beside the holder's head — jumps included, like the ball.
    const shells = effMapId === "beach" ? (state?.shells || []) : [];
    for (const s of shells) {
      if (s.holder) continue;
      const fx = s.x, fy = s.y;
      const sd = coinSeed(String(s.id));
      const sfl = floatFor(effMapId, fy, t, sd);
      const tint = s.tint || "#f4a7c3";
      drawables.push({
        y: fy,
        draw: () => drawShell(ctx, fx - camX, fy - camY, t, sd, tint, false, sfl),
      });
    }
    for (const s of shells) {
      if (!s.holder) continue;
      const o = present.get(s.holder);
      if (!o) continue;
      const hx = o.x, hy = o.y, hz = o.z || 0;
      const sd = coinSeed(String(s.id));
      const tint = s.tint || "#f4a7c3";
      drawables.push({
        y: hy + 2,
        draw: () => drawShell(ctx, hx + 16 - camX, hy - 20 - camY - hz, t, sd, tint, true),
      });
    }
    // Toy-car race (plaza only): loose sticks lie by the track, held sticks
    // ride mid-torso (never above the head), cars sit y-sorted on the loop.
    if (effMapId === "plaza") {
      const sticks = (state as any)?.raceSticks || [];
      for (const st of sticks) {
        if (st.holder) continue;
        const fx = st.x, fy = st.y;
        const col = st.color || RACE_COLORS[st.id % RACE_COLORS.length];
        const seed = (st.id ?? 0) * 2.1 + fx * 0.05;
        drawables.push({
          y: fy,
          draw: () => drawJoystick(ctx, fx - camX, fy - camY, col, false, t, seed),
        });
      }
      const cars = (state as any)?.raceCars || [];
      // per-car smoothing (server ticks at 20Hz like the ball): glide
      // position + shortest-path angle toward each snapshot; snap only on
      // genuine teleports (race resets).
      for (const c of cars) {
        const col = c.color || RACE_COLORS[c.id % RACE_COLORS.length];
        const cur = carSm.get(c.id);
        if (!cur) {
          carSm.set(c.id, { x: c.x, y: c.y, angle: c.angle || 0 });
        } else {
          if (Math.hypot(c.x - cur.x, c.y - cur.y) > 220) {
            cur.x = c.x; cur.y = c.y; cur.angle = c.angle || 0;
          } else {
            const k = Math.min(1, dt * 10);
            cur.x += (c.x - cur.x) * k;
            cur.y += (c.y - cur.y) * k;
            let da = (c.angle || 0) - cur.angle;
            while (da > Math.PI) da -= Math.PI * 2;
            while (da < -Math.PI) da += Math.PI * 2;
            cur.angle += da * Math.min(1, dt * 12);
          }
        }
        const sm = carSm.get(c.id)!;
        const fx = sm.x, fy = sm.y, ang = sm.angle;
        drawables.push({
          y: fy + 1,
          draw: () => drawRaceCar(ctx, fx - camX, fy - camY, ang, col, t),
        });
      }
      for (const st of sticks) {
        if (!st.holder) continue;
        const o = present.get(st.holder);
        if (!o) continue;
        const col = st.color || RACE_COLORS[st.id % RACE_COLORS.length];
        const hx = o.x, hy = o.y, hz = o.z || 0;
        drawables.push({
          y: hy + 2,
          draw: () => drawJoystick(ctx, hx + 13 - camX, hy - 4 - camY - hz, col, true, t),
        });
      }
    }
    // fountain tosses (plaza only): land flights into splash + ripple,
    // then draw live ripples as ground-sorted world drawables
    if (effMapId === "plaza") {
      for (let i = fountainTosses.length - 1; i >= 0; i--) {
        if (t - fountainTosses[i].t0 >= FOUNTAIN_TOSS_MS) {
          const done = fountainTosses.splice(i, 1)[0];
          fountainRipples.push({ t0: t });
          if (fountainRipples.length > 8) fountainRipples.shift();
          pushSpray(8, done.by, FOUNTAIN_WATER.x, FOUNTAIN_WATER.y, { up: 170, spread: 110, big: true });
        }
      }
      for (let i = fountainRipples.length - 1; i >= 0; i--) {
        const age = t - fountainRipples[i].t0;
        if (age > FOUNTAIN_RIPPLE_MS) { fountainRipples.splice(i, 1); continue; }
        const k = age / FOUNTAIN_RIPPLE_MS;
        const rx = 12 + k * 46, ry = 6 + k * 20;
        drawables.push({
          y: FOUNTAIN_WATER.y + 2,
          draw: () => {
            ctx.globalAlpha = 0.7 * (1 - k);
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.ellipse(FOUNTAIN_WATER.x - camX, FOUNTAIN_WATER.y - camY, rx, ry, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
          },
        });
      }
    }
    // drop pets + tail + interp memories whose owners left (stale interp /
    // stride entries would make a rejoining player glide in from nowhere)
    if (pets.size > players.length || tailSide.size > players.length || sitWas.size > players.length || interp.size > players.length || stride.size > players.length || dunkRemote.size > 0 || lastWater.size > players.length || lastFastWater.size > players.length || lastChurn.size > players.length) {
      const here = new Set(players.map((p) => p.id));
      for (const id of [...pets.keys()]) if (!here.has(id)) pets.delete(id);
      for (const id of [...tailSide.keys()]) if (!here.has(id)) tailSide.delete(id);
      for (const id of [...sitWas.keys()]) if (!here.has(id)) sitWas.delete(id);
      for (const id of [...sitHopStart.keys()]) if (!here.has(id)) sitHopStart.delete(id);
      for (const id of [...interp.keys()]) if (!here.has(id)) interp.delete(id);
      for (const id of [...stride.keys()]) if (!here.has(id)) stride.delete(id);
      for (const id of [...dunkRemote.keys()]) if (!here.has(id)) dunkRemote.delete(id);
      for (const id of [...lastWater.keys()]) if (!here.has(id)) lastWater.delete(id);
      for (const id of [...lastFastWater.keys()]) if (!here.has(id)) lastFastWater.delete(id);
      for (const id of [...lastChurn.keys()]) if (!here.has(id)) lastChurn.delete(id);
    }

    // dust trail: every dot is combed from its owner's CURRENT feet +
    // heading + its own age, then fades. Nothing is stored, nothing drifts.
    // Yours renders full strength, others' dimmer so they never confuse.
    for (let i = trail.length - 1; i >= 0; i--) {
      const d = trail[i];
      d.age += dt;
      const maxAge = 0.3;
      if (d.age > maxAge) { trail.splice(i, 1); continue; }
      const o = present.get(d.owner);
      if (!o) { trail.splice(i, 1); continue; }
      const own = d.owner === cb.getMyId();
      const life = d.age / maxAge;
      // comb opposite the true motion vector (diagonals included)
      const back = 6 + d.age * 200;
      const side = (d.seed - 0.5) * 12;
      const wx = o.x - o.mvx * back + o.mvy * side;
      const wy = o.y + 14 - o.mvy * back - o.mvx * side - d.age * 30;
      ctx.globalAlpha = (own ? 0.38 : 0.2) * (1 - life);
      ctx.fillStyle = "#e8dcc0";
      ctx.beginPath();
      ctx.arc(wx - camX, wy - camY, Math.max(0.5, 4.5 - life * 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // water spray: ballistic drops — fired up from the waterline, arcing
    // over and falling back in. World-space, so they hang behind correctly
    // even as you keep wading forward.
    for (let i = spray.length - 1; i >= 0; i--) {
      const s = spray[i];
      s.age += dt;
      s.vy += SPRAY_GRAV * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.age > s.life || (s.vy > 0 && s.y >= s.floorY)) { spray.splice(i, 1); continue; }
      if (!present.get(s.owner)) { spray.splice(i, 1); continue; }
      const own = s.owner === cb.getMyId();
      const life = Math.min(1, s.age / s.life);
      ctx.globalAlpha = (own ? 0.65 : 0.38) * (1 - life * 0.7);
      ctx.fillStyle = "#e8f6fd";
      ctx.beginPath();
      ctx.arc(s.x - camX, s.y - camY, Math.max(0.6, s.r * (1 - life * 0.5)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.draw();
    // football: while a pitch match is live (play/celebration/full-time),
    // players on the pitch — plus seated spectators in the stands — see the
    // world around the field darkened. Screen space here is world-minus-
    // camera, so the hole tracks the pitch.
    const fb = fbState;
    const fbActive = fbMatchOn && fb;
    const fbMe = fbMeMatch || spectating;
    if (fbActive && fbMe) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, vw, vh);
      ctx.rect(
        PLAZA_FIELD.x - 8 - camX, PLAZA_FIELD.y - 8 - camY,
        PLAZA_FIELD.w + 16, PLAZA_FIELD.h + 16
      );
      ctx.fillStyle = "rgba(12,10,24,0.52)";
      ctx.fill("evenodd");
      ctx.restore();
    }
    // collider highlight (debug): exact map walls + ball + player radii
    if (cb.showColliders()) {
      ctx.fillStyle = "rgba(217,95,75,0.22)";
      ctx.strokeStyle = "#d95f4b";
      ctx.lineWidth = 2;
      for (const c of map.colliders) {
        ctx.fillRect(c.x - camX, c.y - camY, c.w, c.h);
        ctx.strokeRect(c.x - camX, c.y - camY, c.w, c.h);
      }
      if (ball) {
        ctx.strokeStyle = "#4e8d7c";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(ball.x - camX, ball.y - camY, ballRadius(effMapId), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = "#58a05c";
      ctx.lineWidth = 2;
      for (const [, o] of present) {
        ctx.beginPath();
        ctx.arc(o.x - camX, o.y - camY, 16, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // name tags + bubbles stay readable above everything
    for (const o of overheads) drawTravelerOverhead(ctx, o.p, o.sx, o.sy, o.isMe, o.isFriend);
    // flying fountain coins (screen space, above the world): quadratic arc
    // from the tosser's hands up and into the water, spinning fast
    if (effMapId === "plaza") {
      for (const ft of fountainTosses) {
        const age = t - ft.t0;
        if (age < 0 || age >= FOUNTAIN_TOSS_MS) continue;
        const o = present.get(ft.by);
        if (!o) continue;
        const e = age / FOUNTAIN_TOSS_MS;
        const x0 = o.x, y0 = o.y - 12;
        const x1 = FOUNTAIN_WATER.x, y1 = FOUNTAIN_WATER.y - 6;
        const mx = (x0 + x1) / 2, my = Math.min(y0, y1) - 90;
        const q = 1 - e;
        const ix = q * q * x0 + 2 * q * e * mx + e * e * x1;
        const iy = q * q * y0 + 2 * q * e * my + e * e * y1;
        drawCoin(ctx, ix - camX, iy - camY, t, seedOf(ft.by) + age * 0.01);
      }
    }
    // deep-water dunk fade: swallows the screen while you go under, hides
    // the hop back to your last dry-side spot, then lets go
    if (dunkAlpha > 0.01) {
      ctx.fillStyle = `rgba(8,18,36,${Math.min(0.85, dunkAlpha).toFixed(3)})`;
      ctx.fillRect(0, 0, vw, vh);
      // faint sinking bubbles on the way down
      if (dunkActive && dunkAge >= 0 && dunkAge < DUNK_SINK_MS) {
        const k = dunkAge / DUNK_SINK_MS;
        ctx.fillStyle = `rgba(215,240,250,${(0.7 * (1 - k)).toFixed(3)})`;
        for (let i = 0; i < 6; i++) {
          const bx = vw / 2 + (hash2(i, 77) - 0.5) * 120;
          const by = vh / 2 + 20 - k * (60 + hash2(i, 78) * 60) + hash2(i, 79) * 20;
          ctx.beginPath();
          ctx.arc(bx, by, 2 + hash2(i, 80) * 3 * (1 - k * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // football counter above the field + goal / full-time banners,
    // screen-centred. Only for players and seated spectators — deciding to
    // spectate is what unlocks the match UI.
    if (fbActive && fbMe) {
      const F = PLAZA_FIELD;
      const teamName = (t: string) => (t === "A" ? "WEST" : "EAST");
      const cx = F.x + F.w / 2 - camX;
      const cy = F.y - 40 - camY;
      const label = `WEST ${fb.scoreA} – ${fb.scoreB} EAST`;
      ctx.textAlign = "center";
      ctx.font = "900 15px Nunito, 'Trebuchet MS', system-ui, sans-serif";
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(43,31,22,0.62)";
      ctx.beginPath();
      ctx.roundRect(cx - tw / 2 - 14, cy - 20, tw + 28, 46, 14);
      ctx.fill();
      ctx.fillStyle = "#faf3df";
      ctx.fillText(label, cx, cy);
      ctx.font = "800 10px Nunito, 'Trebuchet MS', system-ui, sans-serif";
      ctx.fillStyle = "rgba(250,243,223,0.85)";
      ctx.fillText("FIRST TO 5", cx, cy + 15);
      const banner = (big: string, small: string | null) => {
        const bx = vw / 2, by = vh * 0.3;
        ctx.textAlign = "center";
        ctx.font = "900 46px Nunito, 'Trebuchet MS', system-ui, sans-serif";
        ctx.lineWidth = 8;
        ctx.strokeStyle = INK;
        ctx.strokeText(big, bx, by);
        ctx.fillStyle = "#f2c14e";
        ctx.fillText(big, bx, by);
        if (small) {
          ctx.font = "900 17px Nunito, 'Trebuchet MS', system-ui, sans-serif";
          const sw = ctx.measureText(small).width;
          ctx.fillStyle = "rgba(43,31,22,0.62)";
          ctx.beginPath();
          ctx.roundRect(bx - sw / 2 - 14, by + 12, sw + 28, 30, 15);
          ctx.fill();
          ctx.fillStyle = "#faf3df";
          ctx.fillText(small, bx, by + 33);
        }
      };
      if (fb.state === "goal") {
        const scorer = fb.goalBy ? `${fb.goalBy} scores for ${teamName(fb.goalTeam)}!` : `${teamName(fb.goalTeam)} scores!`;
        banner("GOAL!", scorer);
      } else if (fb.state === "end") {
        banner(`${teamName(fb.winner)} WINS!`, `${fb.scoreA} – ${fb.scoreB}`);
      }
    }

    // race HUD: live stopwatch above the arena + countdown / finish banners.
    // Only for drivers (holders) and only while a race is on — free driving
    // stays quiet.
    {
      const race = (state as any)?.race;
      const sticks = (state as any)?.raceSticks || [];
      const meDriving = sticks.some((s: any) => s.holder === cb.getMyId());
      const amRacing = !!race && race.parts?.some((e: any) => e.sid === cb.getMyId());
      if (effMapId === "plaza" && race && (meDriving || amRacing)) {
        const fmt = (ms: number | null | undefined) => {
          if (ms == null) return "--:--.-";
          const s = Math.max(0, ms / 1000);
          const m = Math.floor(s / 60);
          return `${m}:${(s % 60).toFixed(1).padStart(4, "0")}`;
        };
        const A = RACE_AREA;
        const cx = A.x + A.w / 2 - camX;
        const cy = A.y - 34 - camY;
        const now = Date.now();
        // live board: one row per driver, your row highlighted
        const rows = [...(race.parts || [])].sort((a: any, b: any) =>
          (a.finishMs ?? Infinity) - (b.finishMs ?? Infinity));
        ctx.textAlign = "center";
        ctx.font = "900 14px Nunito, 'Trebuchet MS', system-ui, sans-serif";
        const lines = rows.map((e: any) => {
          const live = e.finishMs != null ? fmt(e.finishMs)
            : race.state === "racing" ? fmt(now - race.startAt) : "waiting";
          return `${e.name}: ${live}`;
        });
        const title = race.state === "countdown" ? "GET READY…"
          : race.state === "racing" ? (rows.length > 1 ? "RACE!" : "SOLO RUN")
          : "FINISH!";
        const label = `${title}  ${rows.length > 1 ? "" : ""}`;
        ctx.font = "900 15px Nunito, 'Trebuchet MS', system-ui, sans-serif";
        const tw = Math.max(
          ctx.measureText(label).width,
          ...lines.map((L: string) => ctx.measureText(L).width)
        );
        const bh = 30 + lines.length * 18;
        ctx.fillStyle = "rgba(43,31,22,0.62)";
        ctx.beginPath();
        ctx.roundRect(cx - tw / 2 - 14, cy - 22, tw + 28, bh, 14);
        ctx.fill();
        ctx.fillStyle = "#faf3df";
        ctx.fillText(label, cx, cy);
        ctx.font = "800 13px Nunito, 'Trebuchet MS', system-ui, sans-serif";
        lines.forEach((L: string, i: number) => {
          const isMe = rows[i]?.sid === cb.getMyId();
          ctx.fillStyle = rows[i]?.finishMs != null ? "#f2c14e" : isMe ? "#7fc6a4" : "#faf3df";
          ctx.fillText(L, cx, cy + 18 + i * 18);
        });
        if (race.state === "countdown") {
          const left = Math.max(0, 3000 - (now - race.countdownAt));
          const n = Math.ceil(left / 1000);
          ctx.textAlign = "center";
          ctx.font = "900 52px Nunito, 'Trebuchet MS', system-ui, sans-serif";
          ctx.lineWidth = 8;
          ctx.strokeStyle = INK;
          ctx.strokeText(String(n), vw / 2, vh * 0.32);
          ctx.fillStyle = "#f2c14e";
          ctx.fillText(String(n), vw / 2, vh * 0.32);
        } else if (race.state === "finished") {
          const win = rows.find((e: any) => e.finishMs != null);
          const big = rows.length > 1 && win ? `${win.name} WINS!` : "FINISH!";
          const small = rows.map((e: any) => `${e.name} ${fmt(e.finishMs)}`).join("   ") || null;
          ctx.textAlign = "center";
          ctx.font = "900 42px Nunito, 'Trebuchet MS', system-ui, sans-serif";
          ctx.lineWidth = 8;
          ctx.strokeStyle = INK;
          ctx.strokeText(big, vw / 2, vh * 0.3);
          ctx.fillStyle = "#f2c14e";
          ctx.fillText(big, vw / 2, vh * 0.3);
          if (small) {
            ctx.font = "900 15px Nunito, 'Trebuchet MS', system-ui, sans-serif";
            const sw = ctx.measureText(small).width;
            ctx.fillStyle = "rgba(43,31,22,0.62)";
            ctx.beginPath();
            ctx.roundRect(vw / 2 - sw / 2 - 14, vh * 0.3 + 12, sw + 28, 30, 15);
            ctx.fill();
            ctx.fillStyle = "#faf3df";
            ctx.fillText(small, vw / 2, vh * 0.3 + 33);
          }
        }
      }
    }

    ctx.restore();

    // debug overlay: positions, fps, ball, plus app-supplied lines (voice…)
    if (cb.isDebug()) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const gait = sitting ? "sit" : my.crouch ? "crouch" : mySpd > 210 ? "sprint" : mySpd > 10 ? "walk" : "idle";
      const waterTag = effMapId === "beach" ? ` ${beachZone(my.y)}` : "";
      const dunkTag = dunkActive ? ` dunk${Math.round(dunkAge)}` : "";
      const lines = [
        `xy ${my.x | 0},${my.y | 0} z ${Math.round(my.z)} ${my.dir}${my.moving ? " moving" : ""}${my.crouch ? " crouch" : ""}${sitting ? " sit" : ""}${waterTag}${dunkTag}`,
        `spd ${Math.round(mySpd)}px/s (${gait}) keys:${[...keys].join("+") || "-"}`,
        `cam ${camX | 0},${camY | 0} view ${vw | 0}x${vh | 0} ${Math.round(fps)}fps draw${drawables.length}`,
        `${state?.code || "?"} ${effMapId} players${(state?.players || []).length} stride${stride.size} trail${trail.length}`,
        state?.ball
          ? `ball ${state.ball.x | 0},${state.ball.y | 0} v${Math.hypot(state.ball.vx, state.ball.vy) | 0}`
          : "ball -",
        ...cb.debugLines(),
      ];
      ctx.fillStyle = "rgba(0,0,0,0.68)";
      ctx.fillRect(8, 64, 400, 12 + lines.length * 16 + 6);
      ctx.fillStyle = "#7CFC00";
      ctx.font = "12px monospace";
      ctx.textAlign = "left";
      lines.forEach((L, i) => ctx.fillText(L.slice(0, 60), 16, 84 + i * 16));
    }
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  return {
    /** Queue a fountain coin-toss flight from a player (server broadcast). */
    fountainToss(byId: string) {
      if (typeof byId !== "string") return;
      if (fountainTosses.length > 8) fountainTosses.shift();
      fountainTosses.push({ by: byId, t0: performance.now() });
    },
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", resize);
    },
    /** Pixel copy of the current frame plus the player's position in it
     *  (device pixels) — the camera modal crops its square around that. */
    snapshot(): { frame: HTMLCanvasElement; px: number; py: number } | null {
      try {
        if (!canvas.width || !canvas.height) return null;
        const copy = document.createElement("canvas");
        copy.width = canvas.width;
        copy.height = canvas.height;
        const c2 = copy.getContext("2d");
        if (!c2) return null;
        c2.drawImage(canvas, 0, 0);
        const k = snapView.scale * snapView.dpr;
        return {
          frame: copy,
          px: (my.x - snapView.camX) * k,
          py: (my.y - snapView.camY) * k,
        };
      } catch {
        return null;
      }
    },
  };
}

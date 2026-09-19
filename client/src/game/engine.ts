import { MAPS, TREES_POS, PALMS_POS, BENCHES, PLAZA_FIELD, PLAZA_STANDS, collide } from "./maps";
import { drawEmoteIcon } from "./emotes";
import { DEFAULT_AVATAR, sanitizeAvatar, type Avatar, type Pet } from "./avatar";
import type { Player, RoomState } from "../net/socket";
import type { Binds } from "./binds";

/** Merge a player's optional avatar blob over defaults (color stays canonical). */
export function getAvatar(p: Pick<Player, "color" | "avatar">): Avatar {
  const base = sanitizeAvatar({ ...(p.avatar || {}), color: p.color });
  return { ...DEFAULT_AVATAR, ...base, color: p.color || base.color };
}

export type EngineCallbacks = {
  getState: () => RoomState | null;
  getMyId: () => string;
  sendMove: (x: number, y: number, dir: string, moving: boolean, z: number, crouch: boolean) => void;
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
  const sitting = !!anim.sitting || !!(p as any).sitting;
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

  // emote performance: which reaction is playing, if any
  const EMOTE_DUR: Record<string, number> = {
    heart: 3000, laugh: 2500, wow: 2000, huh: 3000,
    dance: 2500, sleep: 3500, angry: 3000, star: 2500,
  };
  const nowMs = Date.now();
  const eAge = p.emote && p.emoteAt ? nowMs - p.emoteAt : Infinity;
  const em = p.emote && eAge < (EMOTE_DUR[p.emote] || 3000) ? p.emote : null;

  // per-emote body motion: tilt (radians), liftY (px, up positive), shake, boot spread
  let tilt = 0, liftY = 0, shakeX = 0, bootSpread = 0;
  if (em === "heart") tilt = Math.sin(eAge / 150) * 0.06;
  if (em === "dance") tilt = Math.sin(eAge / 200) * 0.08;
  if (em === "angry") shakeX = Math.sin(eAge / 45) * 1.5;
  if (em === "wow") {
    const W = 2000;
    liftY = eAge < 150 ? 14 * (eAge / 150) : eAge > W - 400 ? Math.max(0, 14 * ((W - eAge) / 400)) : 14;
    bootSpread = 4;
  }
  // per-emote breathing (overrides the idle bob)
  let bobs = bob;
  if (em === "laugh") bobs += Math.abs(Math.sin(eAge / 160)) * -3.5;
  if (em === "dance") bobs += Math.abs(Math.sin(eAge / 190)) * -3;
  if (em === "sleep") bobs = Math.sin(eAge / 650) * 2.8;

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
    const f1 = p.moving ? Math.max(0, step) * 3.5 : 0;
    const f2 = p.moving ? Math.max(0, -step) * 3.5 : 0;
    ctx.fillStyle = av.boots;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    for (const [fx, fh] of [[cx - 11 - bootSpread, f1], [cx + 1 + bootSpread, f2]] as const) {
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
    const pid = em === "heart" ? "heart" : em === "dance" ? "dance" : "huh";
    for (let k = 0; k < 3; k++) {
      const ph = (nowMs / 1300 + k / 3) % 1;
      ctx.globalAlpha = 0.95 * (1 - ph);
      drawEmoteIcon(ctx, pid, sx - 22 + k * 22 + Math.sin(ph * 5 + k) * 4, sy - 46 - ph * 30, 10 - ph * 3);
    }
    ctx.globalAlpha = 1;
  } else if (em === "wow") {
    // popping "!" beside the head
    const pop = eAge < 200 ? 0.3 + 0.7 * (eAge / 200) : 1;
    ctx.globalAlpha = eAge > 1600 ? Math.max(0, 1 - (eAge - 1600) / 400) : 1;
    drawEmoteIcon(ctx, "wow", sx + 24, sy - 42, 11 * pop);
    ctx.globalAlpha = 1;
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
function drawTravelerOverhead(
  ctx: CanvasRenderingContext2D,
  p: Player,
  sx: number, sy: number,
  isMe: boolean
) {
  // name tag pill (everyone but you — yours lives in the sidebar)
  if (!isMe) {
    ctx.font = "800 12px Nunito, 'Trebuchet MS', system-ui, sans-serif";
    ctx.textAlign = "center";
    const label = p.name;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(43,31,22,0.62)";
    ctx.beginPath();
    ctx.roundRect(sx - tw / 2 - 8, sy - 60, tw + 16, 21, 10);
    ctx.fill();
    ctx.fillStyle = "#faf3df";
    ctx.fillText(label, sx, sy - 45);
  }

  // coin earn popup: floating gold "+n" for ~1.2s after a pickup, game
  // win or tip (server stamps player.coinPop + coinPopAmt, no chat needed)
  const coinAge = (p as any).coinPop ? Date.now() - (p as any).coinPop : Infinity;
  if (coinAge < 1200) {
    const k = coinAge / 1200;
    const rise = k * 26;
    ctx.globalAlpha = 1 - k * k;
    ctx.font = "900 15px Nunito, 'Trebuchet MS', system-ui, sans-serif";
    ctx.textAlign = "center";
    const label = `+${(p as any).coinPopAmt || 1}`;
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

// Wooden post fence along the world edge. Every post and rail registers its
// own depth so the fence correctly covers you when you hug the bottom edge.
function drawFence(
  ctx: CanvasRenderingContext2D,
  X: (n: number) => number, Y: (n: number) => number,
  w: number, h: number, skipBottom: boolean, props: Prop[]
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
  // side runs: posts plus per-gap rail segments
  for (let y = m + step; y <= h - m - step; y += step) {
    const py = y;
    props.push({ y: py + 2, draw: () => { post(m, py); post(w - m, py); } });
  }
  for (let y = m + step; y + step <= h - m; y += step) {
    const y1 = y, y2 = y + step, mid = y + step / 2 + 8;
    props.push({ y: mid, draw: () => rail(m + 2, y1 + 8, m + 2, y2 + 8) });
    props.push({ y: mid, draw: () => rail(w - m + 2, y1 + 8, w - m + 2, y2 + 8) });
  }
}

// ---------------------------------------------------------------------- maps
function drawMap(ctx: CanvasRenderingContext2D, mapId: string, camX: number, camY: number, vw: number, vh: number, t: number, props: Prop[], tvOn: boolean) {
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
    // shells + starfish
    for (let i = 0; i < 10; i++) {
      const px = X(hash2(i, 31) * map.width), py = Y(hash2(i, 32) * 850);
      if (i % 3 === 0) {
        ctx.fillStyle = "#e8919c";
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 + 0.4;
          ctx.beginPath();
          ctx.ellipse(px + Math.cos(a) * 5, py + Math.sin(a) * 5, 4.6, 2.6, a, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#f6c453";
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = "#f7ead0";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(px, py, 2.2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // sea (matches collider y 900..1200)
    const sea = ctx.createLinearGradient(0, Y(900), 0, Y(1200));
    sea.addColorStop(0, "#7ad9f5");
    sea.addColorStop(0.35, "#3fb2e5");
    sea.addColorStop(1, "#2478b5");
    ctx.fillStyle = sea;
    ctx.fillRect(X(0), Y(900), map.width, 300);
    // foam scallops
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    for (let x = 0; x < map.width; x += 34) {
      const bobY = Math.sin(t / 700 + x / 90) * 4;
      ctx.beginPath();
      ctx.arc(X(x + 17), Y(900) + bobY, 17, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillRect(X(0), Y(894), map.width, 10);
    // travelling wave streaks
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (let i = 0; i < 12; i++) {
      const wy = 950 + hash2(i, 41) * 200;
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
    drawFence(ctx, X, Y, map.width, map.height, true, props);
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
    // arcade machines (match colliders)
    const machine = (mx: number, screen: string, label: string) => {
      ctx.fillStyle = "rgba(43,31,22,0.3)";
      ctx.beginPath();
      ctx.roundRect(X(mx) + 5, Y(124), 200, 94, 12);
      ctx.fill();
      ctx.fillStyle = "#5d3a1e";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(X(mx), Y(120), 200, 90, 12);
      ctx.fill();
      ctx.stroke();
      // marquee
      ctx.fillStyle = "#f2c14e";
      ctx.beginPath();
      ctx.roundRect(X(mx) + 14, Y(128), 172, 22, 6);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.font = "900 13px Nunito, 'Trebuchet MS', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, X(mx) + 100, Y(144));
      // screen with animated shine
      const sg = ctx.createLinearGradient(0, Y(154), 0, Y(196));
      sg.addColorStop(0, screen);
      sg.addColorStop(1, shade(screen, -40));
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.roundRect(X(mx) + 52, Y(154), 96, 42, 6);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // shine sweep, masked inside the screen
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(X(mx) + 52, Y(154), 96, 42, 6);
      ctx.clip();
      const shx = X(mx) + 52 + ((t / 14) % 130) - 17;
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.beginPath();
      ctx.moveTo(shx, Y(154));
      ctx.lineTo(shx + 16, Y(154));
      ctx.lineTo(shx + 4, Y(196));
      ctx.lineTo(shx - 12, Y(196));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // buttons
      for (const [bx, bc] of [[70, "#d95f4b"], [92, "#f2c14e"]] as const) {
        ctx.fillStyle = bc;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(X(mx) + bx, Y(203), 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    };
    props.push({ y: 210, draw: () => machine(100, "#4e8d7c", "★ PLAY ★") });
    props.push({ y: 210, draw: () => machine(660, "#7c5cd6", "HI-SCORE") });
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
  } else {
    // --- sunny plaza ---
    ctx.fillStyle = "#7cc46a";
    ctx.fillRect(X(0), Y(0), map.width, map.height);
    blob(ctx, X, Y, 350, 700, 280, 190, "#8fd27a", 0.8);
    blob(ctx, X, Y, 1250, 500, 300, 200, "#8fd27a", 0.8);
    blob(ctx, X, Y, 800, 1050, 340, 150, "#6aaf55", 0.7);
    blob(ctx, X, Y, 200, 300, 220, 150, "#6aaf55", 0.6);
    speckle(ctx, X, Y, map.width, map.height, 260, ["#6aaf55", "#5d9c4c", "#8fd27a"], 2.2, 5);
    // grass tufts + flowers (kept off the mowed pitch)
    const onPitch = (px: number, py: number) =>
      px > PLAZA_FIELD.x - 20 && px < PLAZA_FIELD.x + PLAZA_FIELD.w + 20 &&
      py > PLAZA_FIELD.y - 20 && py < PLAZA_FIELD.y + PLAZA_FIELD.h + 20;
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
    // cabins (depth-sorted so you can slip behind them)
    for (const [x, y, w, h, roof, sign] of [
      [180, 180, 260, 150, "#cf6b4a", "CAFÉ"],
      [1180, 180, 240, 140, "#7fb3d9", "SHOP"],
      [180, 900, 300, 120, "#a3c46b", "HUT"],
    ] as const) {
      props.push({ y: y + h, draw: () => drawCabin(ctx, X, Y, x, y, w, h, roof, sign) });
    }
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
  return 14;
}
let ballRot = 0;
// A shared polaroid: a small blank white card with a photo slot —
// deliberately NOT the picture itself (that lives in the viewer popup).
// Same size class as the ball so it reads as a little held object.
function drawPhoto(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  held: boolean
) {
  const W = 24, H = 30;
  if (!held) {
    ctx.fillStyle = "rgba(43,31,22,0.28)";
    ctx.beginPath();
    ctx.ellipse(x, y + H / 2 + 1, W * 0.45, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(x, y);
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
}

function drawBall(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, vx: number, vy: number, dt: number,
  mapId: string,
  held = false
) {
  const r = ballRadius(mapId);
  const spd = Math.hypot(vx, vy);
  ballRot += spd * dt * 0.02;
  if (!held) {
  ctx.fillStyle = "rgba(43,31,22,0.25)";
  ctx.beginPath();
  ctx.ellipse(x, y + r + 1, r * 0.93, r * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  }
  ctx.save();
  ctx.translate(x, y);
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
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.arc(x - r * 0.36, y - r * 0.43, Math.max(2, r * 0.2), 0, Math.PI * 2);
  ctx.fill();
}

// World coins: always worth 1. Spinning gold dot with a soft bob so they
// read as pickups next to the ball/photos. t is engine clock (ms).
function drawCoin(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, t: number, seed: number
) {
  const bob = Math.sin(t / 500 + seed) * 3;
  const yy = y + bob;
  const squash = Math.abs(Math.cos(t / 500 + seed));
  const rx = 4 + squash * 8;
  ctx.fillStyle = "rgba(43,31,22,0.25)";
  ctx.beginPath();
  ctx.ellipse(x, y + 12, 10, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
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
}

function coinSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (h % 1000) / 100;
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
  type TrailDot = { age: number; seed: number; owner: string };
  const trail: TrailDot[] = [];
  let lastPuff = -999;
  const pushDots = (n: number, owner: string) => {
    if (!cb.dustEnabled()) return;
    for (let i = 0; i < n; i++) {
      if (trail.length > 24) trail.shift();
      trail.push({ age: Math.random() * 0.06, owner, seed: Math.random() });
    }
  };
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
    const map = MAPS[mapId] || MAPS.plaza;

    const me = state?.players.find((p) => p.id === cb.getMyId());
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
    const fbMatchOn = mapId === "plaza" && fbState &&
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
    const inputMove = !cb.isFrozen() && !cb.isTvOpen() && !cb.isViewerOpen() && !cb.isCamOpen() && (dx !== 0 || dy !== 0);
    // sitters broadcast their wiggle (pushing a direction stands you up) but
    // don't steer until the server actually stands them
    const moving = !sitting && inputMove;
    // run / crouch modifiers. "<" is the crouch key; Ctrl is not bound to
    // anything anymore (its chords belong to the browser).
    const crouchHeld = !sitting && keys.has(B.crouch);
    const running = !sitting && keys.has(B.run);
    const baseSpeed = crouchHeld ? (running ? 130 : 90) : running ? 240 : 175;
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
        pushDots(2, cb.getMyId()); // landing poof
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
    // no steering mid-glide — the leap owns your feet until it lands
    if (moving && !glideActive) {
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
    my.moving = sitting ? inputMove : moving;
    // measured speed (EMA of real displacement — walls slow you for real)
    if (dt > 0) {
      const inst = Math.hypot(my.x - px0, my.y - py0) / dt;
      mySpd += (inst - mySpd) * 0.15;
    }
    // jump: snappy little hop (strong gravity, no float), full air control —
    // steering mid-air is a feature. Hold jump to bunny-hop. No jumping
    // seats, and no hopping behind the TV panel.
    if (!sitting && !cb.isFrozen() && !cb.isTvOpen() && !cb.isViewerOpen() && !cb.isCamOpen() && keys.has(B.jump) && my.z === 0 && my.vz === 0) my.vz = 270;
    // gravity stays out of the sit-glide's way (it brings its own arc)
    if (!glideActive && (my.vz !== 0 || my.z > 0)) {
      my.vz -= 1000 * dt;
      my.z += my.vz * dt;
      if (my.z <= 0) {
        my.z = 0;
        my.vz = 0;
        pushDots(3, cb.getMyId()); // landing poof
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
        lastSent.z === my.z && lastSent.crouch === my.crouch;
      if (!samePos || !sameFlags || t - lastSend > 500) {
        lastSend = t;
        lastSent = { x: my.x, y: my.y, dir: my.dir, moving: my.moving, z: my.z, crouch: my.crouch };
        cb.sendMove(my.x, my.y, my.dir, my.moving, my.z, my.crouch);
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
    drawMap(ctx, mapId, camX, camY, vw, vh, t, props, !!state?.tv);
    type Drawable = { y: number; draw: () => void };
    const drawables: Drawable[] = [...props];
    const overheads: { p: Player; sx: number; sy: number; isMe: boolean }[] = [];

    // Ball smoothing state: server snapshots arrive at 15hz, so a free ball
    // glides from a short prediction instead of snapping per snapshot (that
    // was the old "snappy/laggy" feel). Carried balls skip this entirely —
    // they're rendered from the holder's live position below, so movement
    // can never make them lag, trail or flicker.
    const ball = state?.ball;
    const ballHeld = !!ball?.holder;
    if (ball && !ballHeld) {
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
      drawables.push({
        y: bsy,
        draw: () => drawBall(ctx, bsx - camX, bsy - camY, ball.vx, ball.vy, dt, mapId),
      });
    } else if (ball) {
      ballSmInit = false;
    }

    const players = [...(state?.players || [])];
    // live owner lookup for the stateless trail below
    const present = new Map<string, { x: number; y: number; dir: string; mvx: number; mvy: number }>();
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
      present.set(p.id, { x: px, y: py, dir: p.dir, mvx, mvy });
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
      if (p.moving && pz < 0.5 && !pcrouch && spd > 210 && t - lastPuff > 110) {
        lastPuff = t;
        pushDots(1, p.id);
      }
      drawables.push({ y: py, draw: () => drawTraveler(ctx, snap, psx, psy, t, isMe, anim) });
      overheads.push({ p: snap, sx: psx, sy: psy, isMe });

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
        const tx = px - mvx * backDist + -mvy * side * 9;
        const ty = py - mvy * backDist + mvx * side * 9 + (flying ? -28 : 4);
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
    // height whatever way they face. Ground-contact y sorts just above the
    // holder so it always paints over them — never hidden, never trailing.
    if (ball && ballHeld && ball.holder) {
      const o = present.get(ball.holder);
      if (o) {
        const hx = o.x, hy = o.y;
        drawables.push({
          y: hy + 2,
          draw: () => drawBall(ctx, hx - camX, hy - 32 - camY, 0, 0, dt, mapId, true),
        });
      } else {
        // holder left / not rendered yet — fall back to the server spot
        const bsx = ball.x, bsy = ball.y;
        drawables.push({
          y: bsy,
          draw: () => drawBall(ctx, bsx - camX, bsy - camY, 0, 0, dt, mapId, true),
        });
      }
    }
    // World coins: little spinning pickups, y-sorted like everything else.
    const coins = (state as any)?.coins || [];
    for (const c of coins) {
      const fx = c.x, fy = c.y;
      drawables.push({
        y: fy,
        draw: () => drawCoin(ctx, fx - camX, fy - camY, t, coinSeed(String(c.id))),
      });
    }
    // Shared polaroids: little blank cards lying on the ground (y-sorted
    // like everything else) or riding overhead in their holder's hands —
    // same head-spot as a carried ball. The picture itself only ever shows
    // in the viewer popup, never on the object.
    const photos = state?.photos || [];
    for (const ph of photos) {
      if (!ph.holder) {
        const fx = ph.x, fy = ph.y;
        drawables.push({
          y: fy,
          draw: () => drawPhoto(ctx, fx - camX, fy - camY, false),
        });
      } else {
        const o = present.get(ph.holder);
        if (o) {
          const hx = o.x, hy = o.y;
          drawables.push({
            y: hy + 2,
            draw: () => drawPhoto(ctx, hx - camX, hy - 32 - camY, true),
          });
        } else {
          // holder left / not rendered yet — fall back to the server spot
          const fx = ph.x, fy = ph.y;
          drawables.push({
            y: fy,
            draw: () => drawPhoto(ctx, fx - camX, fy - camY, true),
          });
        }
      }
    }
    // drop pets + tail + interp memories whose owners left (stale interp /
    // stride entries would make a rejoining player glide in from nowhere)
    if (pets.size > players.length || tailSide.size > players.length || sitWas.size > players.length || interp.size > players.length || stride.size > players.length) {
      const here = new Set(players.map((p) => p.id));
      for (const id of [...pets.keys()]) if (!here.has(id)) pets.delete(id);
      for (const id of [...tailSide.keys()]) if (!here.has(id)) tailSide.delete(id);
      for (const id of [...sitWas.keys()]) if (!here.has(id)) sitWas.delete(id);
      for (const id of [...sitHopStart.keys()]) if (!here.has(id)) sitHopStart.delete(id);
      for (const id of [...interp.keys()]) if (!here.has(id)) interp.delete(id);
      for (const id of [...stride.keys()]) if (!here.has(id)) stride.delete(id);
    }

    // dust trail: every dot is combed from its owner's CURRENT feet +
    // facing + its own age, then fades. Nothing is stored, nothing can drift.
    // Yours renders full strength, others' dimmer so they never confuse.
    for (let i = trail.length - 1; i >= 0; i--) {
      const d = trail[i];
      d.age += dt;
      if (d.age > 0.3) { trail.splice(i, 1); continue; }
      const o = present.get(d.owner);
      if (!o) { trail.splice(i, 1); continue; }
      const own = d.owner === cb.getMyId();
      // comb opposite the true motion vector (diagonals included)
      const back = 6 + d.age * 200;
      const side = (d.seed - 0.5) * 12;
      const wx = o.x - o.mvx * back + o.mvy * side;
      const wy = o.y + 14 - o.mvy * back - o.mvx * side - d.age * 30;
      const life = d.age / 0.3;
      ctx.globalAlpha = (own ? 0.38 : 0.2) * (1 - life);
      ctx.fillStyle = "#e8dcc0";
      ctx.beginPath();
      ctx.arc(wx - camX, wy - camY, Math.max(0.5, 4.5 - life * 3), 0, Math.PI * 2);
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
        ctx.arc(ball.x - camX, ball.y - camY, ballRadius(mapId), 0, Math.PI * 2);
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
    for (const o of overheads) drawTravelerOverhead(ctx, o.p, o.sx, o.sy, o.isMe);

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

    ctx.restore();

    // debug overlay: positions, fps, ball, plus app-supplied lines (voice…)
    if (cb.isDebug()) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const gait = sitting ? "sit" : my.crouch ? "crouch" : mySpd > 210 ? "sprint" : mySpd > 10 ? "walk" : "idle";
      const lines = [
        `xy ${my.x | 0},${my.y | 0} z ${Math.round(my.z)} ${my.dir}${my.moving ? " moving" : ""}${my.crouch ? " crouch" : ""}${sitting ? " sit" : ""}`,
        `spd ${Math.round(mySpd)}px/s (${gait}) keys:${[...keys].join("+") || "-"}`,
        `cam ${camX | 0},${camY | 0} view ${vw | 0}x${vh | 0} ${Math.round(fps)}fps draw${drawables.length}`,
        `${state?.code || "?"} ${mapId} players${(state?.players || []).length} stride${stride.size} trail${trail.length}`,
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

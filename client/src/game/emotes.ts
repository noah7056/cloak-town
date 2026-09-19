// Shared emote set: overhead reactions + tiny avatar actions.
// Server validates ids against EMOTES; engine draws the icons.
//
// Layout: two pages of 8 (EMOTES_PER_PAGE). The picker shows one page at a
// time so the 1-8 keybinds always fire the visible row — Tab (or the pager
// arrows) flips pages. Tell me which animations you want tweaked and I'll
// tune the engine side; the ids + icons below are the contract.

export const EMOTES = [
  // page 1 — the originals
  { id: "heart", label: "Love" },
  { id: "laugh", label: "Laugh" },
  { id: "wow", label: "Wow" },
  { id: "huh", label: "Huh?" },
  { id: "dance", label: "Dance" },
  { id: "sleep", label: "Sleepy" },
  { id: "angry", label: "Grumpy" },
  { id: "star", label: "Yay" },
  // page 2 — new batch (last one is the persistent ground-sit)
  { id: "march", label: "March" },
  { id: "cry", label: "Sob" },
  { id: "idea", label: "Idea" },
  { id: "sweat", label: "Phew" },
  { id: "dizzy", label: "Dizzy" },
  { id: "no", label: "Nope" },
  { id: "yes", label: "Yes" },
  { id: "sit", label: "Sit" },
] as const;

export type EmoteId = (typeof EMOTES)[number]["id"];

export function isEmoteId(x: unknown): x is EmoteId {
  return typeof x === "string" && (EMOTES as readonly { id: string }[]).some((e) => e.id === x);
}

/** How many emotes fit one picker row (keybinds 1..N always hit the page). */
export const EMOTES_PER_PAGE = 8;

/** Surprise jump waits this long so lag / clock skew never eats the hop. */
export const WOW_DELAY_MS = 500;

/**
 * Looping reactions survive brief steps: only SUSTAINED marching (moving
 * continuously longer than this) cancels them. Ground-sit ("sit") is the
 * exception — any step stands you straight back up.
 */
export const EMOTE_MOVE_CANCEL_MS = 1200;

/**
 * How long each reaction plays (ms). Deliberately long — the player (or a
 * good march) cuts them short. "sit" is static: it lasts until you move or
 * fire it again, so it gets Infinity here (server treats it as persistent).
 */
export const EMOTE_DUR: Record<string, number> = {
  heart: 8000, laugh: 8000, wow: 8000, huh: 9000,
  dance: 12000, sleep: 12000, angry: 8000, star: 8000,
  march: 8000, cry: 9000, idea: 9000, sweat: 8000,
  dizzy: 9000, no: 8000, yes: 8000,
  sit: Infinity,
};

/** True for emotes with no expiry (ground-sit). */
export function emoteIsPersistent(id: string): boolean {
  return id === "sit" || !Number.isFinite(EMOTE_DUR[id] ?? NaN);
}

/** True while `age` ms after firing still counts as performing. */
export function emoteIsActive(id: string, ageMs: number): boolean {
  const d = EMOTE_DUR[id];
  if (d === undefined) return false;
  if (!Number.isFinite(d)) return true;
  return ageMs < d;
}

const INK = "#4a3728";

/** Vector emote icon centered at (x, y), ~2s wide. Cozy palette, ink outlines. */
export function drawEmoteIcon(
  ctx: CanvasRenderingContext2D,
  id: string,
  x: number, y: number, s: number
) {
  ctx.save();
  ctx.lineWidth = Math.max(1.6, s * 0.14);
  ctx.strokeStyle = INK;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  switch (id) {
    case "heart": {
      ctx.fillStyle = "#d95f4b";
      ctx.beginPath();
      ctx.moveTo(x, y + s * 0.75);
      ctx.bezierCurveTo(x - s * 1.15, y - s * 0.1, x - s * 0.62, y - s * 0.95, x, y - s * 0.3);
      ctx.bezierCurveTo(x + s * 0.62, y - s * 0.95, x + s * 1.15, y - s * 0.1, x, y + s * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.arc(x - s * 0.38, y - s * 0.32, s * 0.16, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "laugh": {
      ctx.fillStyle = "#f2c14e";
      ctx.beginPath();
      ctx.arc(x, y, s * 0.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // closed happy eyes
      ctx.beginPath();
      ctx.arc(x - s * 0.34, y - s * 0.12, s * 0.2, Math.PI * 1.1, Math.PI * 1.9);
      ctx.arc(x + s * 0.34, y - s * 0.12, s * 0.2, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      // open smile
      ctx.fillStyle = "#7a2f26";
      ctx.beginPath();
      ctx.arc(x, y + s * 0.22, s * 0.34, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "wow": {
      ctx.fillStyle = "#d95f4b";
      ctx.beginPath();
      ctx.roundRect(x - s * 0.22, y - s * 0.8, s * 0.44, s * 0.9, s * 0.22);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y + s * 0.55, s * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "huh": {
      ctx.fillStyle = "#4e8d7c";
      ctx.font = `900 ${s * 1.7}px Nunito, 'Trebuchet MS', sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("?", x, y + s * 0.6);
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1.2, s * 0.06);
      ctx.strokeText("?", x, y + s * 0.6);
      break;
    }
    case "dance": {
      ctx.fillStyle = "#4e8d7c";
      ctx.beginPath();
      ctx.ellipse(x - s * 0.25, y + s * 0.5, s * 0.32, s * 0.24, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = Math.max(1.8, s * 0.16);
      ctx.beginPath();
      ctx.moveTo(x + s * 0.05, y + s * 0.45);
      ctx.lineTo(x + s * 0.05, y - s * 0.6);
      ctx.quadraticCurveTo(x + s * 0.7, y - s * 0.5, x + s * 0.62, y + s * 0.05);
      ctx.stroke();
      break;
    }
    case "sleep": {
      ctx.fillStyle = "#7c9cc4";
      ctx.font = `900 ${s * 1.6}px Nunito, 'Trebuchet MS', sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("Z", x, y + s * 0.55);
      break;
    }
    case "angry": {
      // anger vein: four thick curved strokes
      ctx.strokeStyle = "#d95f4b";
      ctx.lineWidth = Math.max(2, s * 0.22);
      for (const [dx, dy, r0, r1] of [
        [-0.3, -0.3, 0.6, 1.8], [0.3, -0.3, 1.3, 2.5],
        [-0.3, 0.3, 4.4, 5.6], [0.3, 0.3, 3.7, 4.9],
      ] as const) {
        ctx.beginPath();
        ctx.arc(x + dx * s, y + dy * s, s * 0.34, r0, r1);
        ctx.stroke();
      }
      break;
    }
    case "march": {
      // marching boots: one up, one down + motion ticks
      ctx.fillStyle = "#7a4a26";
      ctx.beginPath();
      ctx.roundRect(x - s * 0.58, y - s * 0.75, s * 0.5, s * 0.68, s * 0.16);
      ctx.roundRect(x + s * 0.08, y + s * 0.07, s * 0.5, s * 0.68, s * 0.16);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#4e8d7c";
      ctx.lineWidth = Math.max(1.6, s * 0.12);
      ctx.beginPath();
      ctx.moveTo(x - s * 0.85, y - s * 0.3);
      ctx.lineTo(x - s * 0.65, y - s * 0.3);
      ctx.moveTo(x - s * 0.9, y + s * 0.05);
      ctx.lineTo(x - s * 0.62, y + s * 0.05);
      ctx.stroke();
      break;
    }
    case "cry": {
      // big sad tear
      ctx.fillStyle = "#7c9cc4";
      ctx.beginPath();
      ctx.moveTo(x, y - s * 0.85);
      ctx.bezierCurveTo(x + s * 0.62, y - s * 0.05, x + s * 0.5, y + s * 0.62, x, y + s * 0.62);
      ctx.bezierCurveTo(x - s * 0.5, y + s * 0.62, x - s * 0.62, y - s * 0.05, x, y - s * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.beginPath();
      ctx.arc(x - s * 0.16, y + s * 0.18, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "idea": {
      // lightbulb: glass + base + spark rays
      ctx.fillStyle = "#f2c14e";
      ctx.beginPath();
      ctx.arc(x, y - s * 0.12, s * 0.52, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#8a5a33";
      ctx.beginPath();
      ctx.roundRect(x - s * 0.24, y + s * 0.36, s * 0.48, s * 0.3, s * 0.08);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#f2c14e";
      ctx.lineWidth = Math.max(1.8, s * 0.14);
      for (const a of [-2.4, -1.57, -0.75]) {
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * s * 0.78, y - s * 0.12 + Math.sin(a) * s * 0.78);
        ctx.lineTo(x + Math.cos(a) * s * 1.02, y - s * 0.12 + Math.sin(a) * s * 1.02);
        ctx.stroke();
      }
      break;
    }
    case "sweat": {
      // nervous sweat drop (pale) + whisk lines
      ctx.fillStyle = "#bcd8e8";
      ctx.beginPath();
      ctx.moveTo(x - s * 0.1, y - s * 0.8);
      ctx.bezierCurveTo(x + s * 0.5, y - s * 0.05, x + s * 0.4, y + s * 0.6, x - s * 0.1, y + s * 0.6);
      ctx.bezierCurveTo(x - s * 0.6, y + s * 0.6, x - s * 0.6, y - s * 0.05, x - s * 0.1, y - s * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#4e8d7c";
      ctx.lineWidth = Math.max(1.6, s * 0.12);
      ctx.beginPath();
      ctx.moveTo(x + s * 0.55, y - s * 0.3);
      ctx.lineTo(x + s * 0.85, y - s * 0.5);
      ctx.moveTo(x + s * 0.55, y + s * 0.1);
      ctx.lineTo(x + s * 0.9, y + s * 0.05);
      ctx.stroke();
      break;
    }
    case "dizzy": {
      // woozy spiral
      ctx.strokeStyle = "#8a6fbf";
      ctx.lineWidth = Math.max(2, s * 0.17);
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 4.2; a += 0.25) {
        const r = (a / (Math.PI * 4.2)) * s * 0.8;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (a === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      break;
    }
    case "no": {
      // chunky red X
      ctx.strokeStyle = "#d95f4b";
      ctx.lineWidth = Math.max(2.4, s * 0.26);
      ctx.beginPath();
      ctx.moveTo(x - s * 0.55, y - s * 0.55);
      ctx.lineTo(x + s * 0.55, y + s * 0.55);
      ctx.moveTo(x + s * 0.55, y - s * 0.55);
      ctx.lineTo(x - s * 0.55, y + s * 0.55);
      ctx.stroke();
      break;
    }
    case "yes": {
      // chunky green checkmark (mirrors nope's cross)
      ctx.strokeStyle = "#4c9a52";
      ctx.lineWidth = Math.max(2.4, s * 0.28);
      ctx.beginPath();
      ctx.moveTo(x - s * 0.55, y + s * 0.02);
      ctx.lineTo(x - s * 0.1, y + s * 0.45);
      ctx.lineTo(x + s * 0.6, y - s * 0.5);
      ctx.stroke();
      break;
    }
    case "sit": {
      // ground-sit pictogram: seat block + dangling boots
      ctx.fillStyle = "#8a5a33";
      ctx.beginPath();
      ctx.roundRect(x - s * 0.7, y + s * 0.05, s * 1.1, s * 0.34, s * 0.12);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f7ead0";
      ctx.beginPath();
      ctx.arc(x - s * 0.15, y - s * 0.45, s * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1.8, s * 0.15);
      ctx.beginPath();
      ctx.moveTo(x - s * 0.15, y - s * 0.12);
      ctx.lineTo(x - s * 0.15, y + s * 0.08);
      ctx.lineTo(x + s * 0.3, y + s * 0.08);
      ctx.stroke();
      break;
    }
    case "star":
    default: {
      ctx.fillStyle = "#f2c14e";
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = k % 2 === 0 ? s * 0.85 : s * 0.38;
        const a = -Math.PI / 2 + (k / 10) * Math.PI * 2;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

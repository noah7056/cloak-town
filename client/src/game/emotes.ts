// Shared emote set: overhead reactions + tiny avatar actions.
// Server validates ids against EMOTES; engine draws the icons.

export const EMOTES = [
  { id: "heart", label: "Love" },
  { id: "laugh", label: "Laugh" },
  { id: "wow", label: "Wow" },
  { id: "huh", label: "Huh?" },
  { id: "dance", label: "Dance" },
  { id: "sleep", label: "Sleepy" },
  { id: "angry", label: "Grumpy" },
  { id: "star", label: "Yay" },
] as const;

export type EmoteId = (typeof EMOTES)[number]["id"];

export function isEmoteId(x: unknown): x is EmoteId {
  return typeof x === "string" && (EMOTES as readonly { id: string }[]).some((e) => e.id === x);
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

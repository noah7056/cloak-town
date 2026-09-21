import { useEffect, useRef, useState } from "react";
import type { BoardStroke } from "../net/socket";

/** Slate the café board is painted with — the eraser is just this color. */
export const BOARD_SLATE = "#2f2a26";

const CHALKS = [
  { id: "chalk", label: "Chalk", color: "#faf3df" },
  { id: "sun", label: "Sun", color: "#f2c14e" },
  { id: "rose", label: "Rose", color: "#e8919c" },
  { id: "mint", label: "Mint", color: "#7fc6a4" },
  { id: "sky", label: "Sky", color: "#7ec8f0" },
] as const;

// Internal canvas resolution (keeps the 100:64 slate aspect). Strokes travel
// normalized 0..1 so the menu and the little world board share them exactly.
const CW = 600, CH = 384;
const CHALK_SIZE = 5 / CW;
const ERASER_SIZE = 16 / CW;
const MAX_PTS = 120;

function paintSlate(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = BOARD_SLATE;
  ctx.fillRect(0, 0, CW, CH);
}

// The house menu, baked as pixels — mirrors the café wall exactly, so the
// modal opens on what you were just looking at. It's just paint: the eraser
// (slate-colored chalk) covers it like anything else you draw.
function paintMenu(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#faf3df";
  ctx.textAlign = "center";
  ctx.font = "900 78px Nunito, 'Trebuchet MS', sans-serif";
  ctx.fillText("MENU", CW / 2, 108);
  ctx.font = "800 60px Nunito, 'Trebuchet MS', sans-serif";
  ctx.fillStyle = "#f2c14e";
  ctx.fillText("latte · mocha", CW / 2, 204);
  ctx.fillText("cocoa · cake", CW / 2, 288);
}

function paintStroke(ctx: CanvasRenderingContext2D, st: BoardStroke) {
  const pts = st.pts;
  if (!pts || pts.length === 0) return;
  ctx.strokeStyle = st.color;
  ctx.fillStyle = st.color;
  ctx.lineWidth = Math.max(1.5, st.size * CW);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0] * CW, pts[0][1] * CH, Math.max(0.8, st.size * CW * 0.5), 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0][0] * CW, pts[0][1] * CH);
  for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0] * CW, pts[k][1] * CH);
  ctx.stroke();
}

export default function Blackboard({ strokes, menu, closing = false, onClose, onStroke, onClear }: {
  strokes: BoardStroke[];
  /** false once the printed house menu has been wiped off the slate */
  menu: boolean;
  closing?: boolean;
  onClose: () => void;
  onStroke: (s: BoardStroke) => void;
  onClear: () => void;
}) {
  const [tool, setTool] = useState<string>("chalk");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const live = useRef<[number, number][]>([]);
  const toolRef = useRef(tool);
  toolRef.current = tool;

  const menuRef = useRef(menu);
  menuRef.current = menu;
  const redraw = () => {
    const el = canvasRef.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    paintSlate(ctx);
    if (menuRef.current !== false) paintMenu(ctx);
    for (const st of strokes) paintStroke(ctx, st);
    if (live.current.length > 0) {
      const t = toolRef.current;
      const chalk = CHALKS.find((c) => c.id === t);
      paintStroke(ctx, {
        color: chalk ? chalk.color : BOARD_SLATE,
        size: t === "eraser" ? ERASER_SIZE : CHALK_SIZE,
        pts: live.current,
      });
    }
  };

  // committed strokes (ours echo back through room-state, everyone else's
  // arrive live) repaint under whatever we're currently drawing
  useEffect(() => {
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes]);

  useEffect(() => {
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const posOf = (e: React.PointerEvent) => {
    const el = canvasRef.current!;
    const r = el.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    ] as [number, number];
  };

  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drawing.current = true;
    live.current = [posOf(e)];
    redraw();
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    const last = live.current[live.current.length - 1];
    const p = posOf(e);
    // thin the stream: ignore sub-pixel jitter between events
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.004) return;
    live.current.push(p);
    redraw();
  };
  const up = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    drawing.current = false;
    const pts = live.current;
    live.current = [];
    if (pts.length === 0) {
      redraw();
      return;
    }
    // stride-sample long scribbles down to the socket cap
    let out = pts;
    if (out.length > MAX_PTS) {
      const step = out.length / MAX_PTS;
      out = Array.from({ length: MAX_PTS }, (_, i) => out[Math.floor(i * step)]);
    }
    const t = toolRef.current;
    const chalk = CHALKS.find((c) => c.id === t);
    onStroke({
      color: chalk ? chalk.color : BOARD_SLATE,
      size: t === "eraser" ? ERASER_SIZE : CHALK_SIZE,
      pts: out,
    });
    redraw();
  };

  return (
    <>
      <div className={closing ? "pp-anim-fade-out" : "pp-anim-fade-in"} style={s.backdrop} onClick={onClose} />
      <div className={"pp-panel pp-scroll " + (closing ? "pp-anim-center-out" : "pp-anim-center-in")} style={s.modal}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 21, fontWeight: 900 }}>Blackboard</h2>
          <button className="pp-iconbtn pp-iconbtn-off" style={{ width: 38, height: 38, fontSize: 15 }} onClick={onClose} title="Close">✕</button>
        </div>
        <div style={{ alignSelf: "center", background: "#4e3018", border: "3px solid #4a3728", borderRadius: 8, padding: 10, boxShadow: "0 4px 0 #4a3728", width: "100%", maxWidth: "100%", overflow: "hidden" }}>
          <canvas
            ref={canvasRef}
            width={CW}
            height={CH}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onPointerLeave={up}
            style={{ width: "100%", display: "block", borderRadius: 4, touchAction: "none", cursor: "crosshair", background: BOARD_SLATE }}
          />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "center" }}>
          {CHALKS.map((c) => (
            <button
              key={c.id}
              className={"pp-choice" + (tool === c.id ? " pp-choice-on" : "")}
              onClick={() => setTool(c.id)}
              title={`${c.label} chalk`}
              style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
            >
              <span style={{ width: 14, height: 14, borderRadius: "50%", background: c.color, border: "2px solid #4a3728", display: "inline-block" }} />
              {c.label}
            </button>
          ))}
          <button
            className={"pp-choice" + (tool === "eraser" ? " pp-choice-on" : "")}
            onClick={() => setTool("eraser")}
            title="Eraser"
          >
            Eraser
          </button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="pp-btn pp-btn-cream" style={{ flex: 1 }} onClick={onClear} title="Wipe the whole board for everyone">
            Wipe clean
          </button>
          <button className="pp-btn pp-btn-leaf" style={{ flex: 1 }} onClick={onClose} title="Back to the café — your chalk stays on the wall">
            Done
          </button>
        </div>
      </div>
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(43,26,18,0.62)", zIndex: 30 },
  modal: { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 700, maxWidth: "94%", maxHeight: "94%", overflowY: "auto", overflowX: "hidden", padding: 22, zIndex: 31, display: "flex", flexDirection: "column", gap: 12 },
};

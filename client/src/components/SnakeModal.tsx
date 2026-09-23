import { useEffect } from "react";
import type { SnakeState } from "../net/socket";

type Props = {
  snake: SnakeState;
  /** true for the read-only spectator mirror (no input, no start) */
  spectate?: boolean;
  holderName?: string;
  /** holder's token balance (for the start button) */
  tokens: number;
  /** personal best to show when no run is live (server only sends best with a run) */
  pb: number;
  closing?: boolean;
  onStart: () => void;
  onTurn: (dir: "up" | "down" | "left" | "right") => void;
  onClose: () => void;
};

export default function SnakeModal({
  snake, spectate = false, holderName, tokens, pb, closing = false,
  onStart, onTurn, onClose,
}: Props) {
  // Steer with arrows/WASD while your run is live (spectators: no input).
  useEffect(() => {
    if (spectate) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (!snake || snake.status !== "play") return;
      const k = e.key.toLowerCase();
      const dir =
        k === "arrowup" || k === "w" ? "up"
        : k === "arrowdown" || k === "s" ? "down"
        : k === "arrowleft" || k === "a" ? "left"
        : k === "arrowright" || k === "d" ? "right"
        : null;
      if (dir) {
        e.preventDefault();
        onTurn(dir);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spectate, snake?.status, onTurn]);

  const status = snake?.status ?? null;
  const score = snake?.score ?? 0;
  const best = snake ? snake.best : pb;
  const w = snake?.w ?? 17;
  const h = snake?.h ?? 17;
  const body = new Set((snake?.cells || []).map(([x, y]) => x + "," + y));
  const head = snake?.cells?.[0] ? snake.cells[0][0] + "," + snake.cells[0][1] : "";
  const food = snake?.food ? snake.food[0] + "," + snake.food[1] : "";

  return (
    <>
      <div
        className={closing ? "pp-anim-fade-out" : "pp-anim-fade-in"}
        style={s.backdrop}
        onClick={onClose}
      />
      <div className={"pp-panel " + (closing ? "pp-anim-center-out" : "pp-anim-center-in")} style={s.modal}>
        <div style={s.head}>
          <b style={s.title}>SNAKE</b>
          <span style={s.score}>SCORE {score} · PB {best}</span>
          <button className="pp-btn pp-btn-cream" style={s.x} onClick={onClose} title="Close (E)">✕</button>
        </div>
        <div style={s.screen}>
          <div style={{ ...s.grid, gridTemplateColumns: `repeat(${w}, 1fr)` }}>
            {Array.from({ length: w * h }, (_, i) => {
              const x = i % w, y = Math.floor(i / w);
              const k = x + "," + y;
              const isHead = k === head;
              const isBody = body.has(k);
              const isFood = k === food;
              return (
                <div
                  key={i}
                  style={{
                    ...s.cell,
                    background: isHead ? "#a3e635" : isBody ? "#7bc96f" : isFood ? "#d95f4b" : "transparent",
                    borderRadius: isHead || isBody || isFood ? 2 : 0,
                    boxShadow: isHead ? "0 0 0 1.5px #4a3728" : undefined,
                  }}
                />
              );
            })}
          </div>
          <div style={s.scan} />
        </div>
        {spectate ? (
          <div style={s.note}>
            Spectating <b>{holderName || snake?.holderName || "someone"}</b>
          </div>
        ) : status === "play" ? (
          <div style={s.note}>
            <b>WASD/arrows</b> to move
          </div>
        ) : status === "over" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={s.result}>
              GAME OVER
            </div>
            <button
              className="pp-btn pp-btn-leaf"
              style={s.start}
              disabled={tokens < 1}
              onClick={onStart}
              title={tokens < 1 ? "Need a token" : "Play again (1 token)"}
            >
              {tokens < 1 ? "Need a token" : "Play again (1 token)"}
            </button>
          </div>
        ) : (
          <button
            className="pp-btn pp-btn-leaf"
            style={s.start}
            disabled={tokens < 1}
            onClick={onStart}
            title={tokens < 1 ? "Need a token" : "Start (1 token)"}
          >
            {tokens < 1 ? "Need a token" : "Start (1 token)"}
          </button>
        )}
      </div>
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  backdrop: { position: "absolute", inset: 0, background: "rgba(43,26,18,0.62)", zIndex: 30 },
  modal: {
    position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
    width: 360, maxWidth: "94%", zIndex: 31, display: "flex", flexDirection: "column", gap: 10,
    padding: 16,
  },
  head: { display: "flex", alignItems: "center", gap: 10 },
  title: {
    fontFamily: "'Courier New', monospace", fontSize: 20, letterSpacing: 3,
    color: "#4a3728", background: "#a3e635", border: "3px solid #4a3728",
    borderRadius: 8, padding: "2px 10px",
  },
  score: { flex: 1, fontFamily: "'Courier New', monospace", fontWeight: 900, fontSize: 14, color: "#4a3728" },
  x: { padding: "4px 10px", fontSize: 14 },
  screen: {
    position: "relative", background: "#14301f", border: "4px solid #4a3728",
    borderRadius: 10, padding: 8, overflow: "hidden",
  },
  grid: { display: "grid", gap: 1, width: "100%", aspectRatio: "1 / 1" },
  cell: { width: "100%", aspectRatio: "1 / 1" },
  scan: {
    position: "absolute", inset: 0, pointerEvents: "none",
    background: "repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 4px)",
  },
  note: { fontSize: 13, fontWeight: 700, color: "#6b543f", textAlign: "center" },
  result: {
    fontFamily: "'Courier New', monospace", fontWeight: 900, fontSize: 16,
    color: "#4a3728", textAlign: "center",
  },
  pb: { color: "#6b543f" },
  start: { padding: "10px 14px", fontSize: 15 },
};

import { useMemo } from "react";
import MatchFooter from "./MatchFooter";
import CoinReward from "./CoinReward";
import { myMark as markOf, oppName as oppOf, type DotsMatch, type Mark } from "../game/match";

const ROWS = 3;
const COLS = 3;
const DOT_W = 64;
const DOT_H = 64;
const PAD = 8;

type Props = {
  game: DotsMatch;
  myId: string;
  closing?: boolean;
  queued: boolean;
  offerFromName: string | null;
  onMove: (edge: { type: "h" | "v"; r: number; c: number }) => void;
  onQuit: () => void;
  onRematch: () => void;
  onCancelRematch: () => void;
};

export default function DotsBoard({ game, myId, closing = false, queued, offerFromName, onMove, onQuit, onRematch, onCancelRematch }: Props) {
  const myMark = markOf(game, myId);
  const myTurn = game.status === "play" && game.turn === myMark;
  const opp = oppOf(game, myId);
  const finished = game.status !== "play";

  let headline: string;
  if (finished) {
    if (game.status === "xwin") headline = game.x === myId ? "🏆 You win!" : `🏆 ${game.xName} wins!`;
    else if (game.status === "owin") headline = game.o === myId ? "🏆 You win!" : `🏆 ${game.oName} wins!`;
    else headline = "It's a draw!";
  } else if (myTurn) {
    headline = `Your turn — you're ${myMark}`;
  } else {
    headline = `${opp}'s turn…`;
  }

  // Precompute boxes for rendering
  type BoxInfo = {
    r: number; c: number; owner: Mark | null;
    edges: { top: Mark | null; right: Mark | null; bottom: Mark | null; left: Mark | null };
  };
  const boxes = useMemo<BoxInfo[]>(() => {
    const b: BoxInfo[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        b.push({
          r, c,
          owner: game.boxes[idx],
          edges: {
            top: game.h[r * COLS + c],
            right: game.v[r * (COLS + 1) + c + 1],
            bottom: game.h[(r + 1) * COLS + c],
            left: game.v[r * (COLS + 1) + c],
          },
        });
      }
    }
    return b;
  }, [game.h, game.v, game.boxes]);

  // Check if an edge is playable
  const isEdgePlayable = (type: "h" | "v", r: number, c: number) => {
    if (!myTurn) return false;
    if (type === "h") return !game.h[r * COLS + c];
    return !game.v[r * (COLS + 1) + c];
  };

  const handleEdge = (type: "h" | "v", r: number, c: number) => {
    if (isEdgePlayable(type, r, c)) onMove({ type, r, c });
  };

  return (
    <>
      <div className={closing ? "pp-anim-fade-out" : "pp-anim-fade-in"} style={s.backdrop} />
      <div className={"pp-panel " + (closing ? "pp-anim-center-out" : "pp-anim-center-in")} style={s.modal}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="pp-iconbtn pp-iconbtn-off" style={{ width: 44, height: 44, fontSize: 22 }} onClick={onQuit} title="Quit match (no result)">←</button>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>Dots & Boxes</h2>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#6b543f" }}>
              {game.xName} (X) vs {game.oName} (O)
            </div>
          </div>
        </div>
        <div style={{ textAlign: "center", fontWeight: 900, fontSize: 16, minHeight: 24 }}>{headline}</div>
        <CoinReward game={game} myId={myId} />
        <div style={{ textAlign: "center", fontSize: 14, fontWeight: 800, color: "#6b543f", marginBottom: 8 }}>
          {game.xName} <b>{game.scoreX}</b> – <b>{game.scoreO}</b> {game.oName}
        </div>

        <div style={s.gridWrapper}>
          <svg viewBox={VIEW_BOX} style={s.svg} xmlns="http://www.w3.org/2000/svg">
            {/* Dots */}
            <g stroke="#4a3728" strokeWidth="0.5" fill="#4a3728">
              {Array.from({ length: ROWS + 1 }).map((_, r) =>
                Array.from({ length: COLS + 1 }).map((_, c) => (
                  <circle key={`${r}-${c}`} cx={c * DOT_W + PAD} cy={r * DOT_H + PAD} r={4} />
                ))
              )}
            </g>

            {/* Unclaimed edge guides (the overlay buttons take the clicks) */}
            <g stroke="#d9c193" strokeWidth="3" opacity="0.5" strokeLinecap="round">
              {game.h.map((claimed, i) => {
                if (claimed) return null;
                const r = Math.floor(i / COLS);
                const c = i % COLS;
                return (
                  <line
                    key={`gh-${r}-${c}`}
                    x1={c * DOT_W + PAD + 8}
                    y1={r * DOT_H + PAD}
                    x2={(c + 1) * DOT_W + PAD - 8}
                    y2={r * DOT_H + PAD}
                  />
                );
              })}
              {game.v.map((claimed, i) => {
                if (claimed) return null;
                const r = Math.floor(i / (COLS + 1));
                const c = i % (COLS + 1);
                return (
                  <line
                    key={`gv-${r}-${c}`}
                    x1={c * DOT_W + PAD}
                    y1={r * DOT_H + PAD + 8}
                    x2={c * DOT_W + PAD}
                    y2={(r + 1) * DOT_H + PAD - 8}
                  />
                );
              })}
            </g>

            {/* Horizontal edges (claimed) */}
            <g stroke="#d9c193" strokeWidth="5" strokeLinecap="round">
              {game.h.map((claimed, i) => {
                const r = Math.floor(i / COLS);
                const c = i % COLS;
                if (!claimed) return null;
                return (
                  <line
                    key={`h-${r}-${c}`}
                    x1={c * DOT_W + PAD + 6}
                    y1={r * DOT_H + PAD}
                    x2={(c + 1) * DOT_W + PAD - 6}
                    y2={r * DOT_H + PAD}
                    stroke={claimed === "X" ? "#d95f4b" : "#4e8d7c"}
                    strokeWidth={6}
                    onClick={() => handleEdge("h", r, c)}
                    style={{ cursor: "default" }}
                  />
                );
              })}
            </g>

            {/* Vertical edges */}
            <g stroke="#d9c193" strokeWidth="5" strokeLinecap="round">
              {game.v.map((claimed, i) => {
                const r = Math.floor(i / (COLS + 1));
                const c = i % (COLS + 1);
                if (!claimed) return null;
                return (
                  <line
                    key={`v-${r}-${c}`}
                    x1={c * DOT_W + PAD}
                    y1={r * DOT_H + PAD + 6}
                    x2={c * DOT_W + PAD}
                    y2={(r + 1) * DOT_H + PAD - 6}
                    stroke={claimed === "X" ? "#d95f4b" : "#4e8d7c"}
                    strokeWidth={6}
                    onClick={() => handleEdge("v", r, c)}
                    style={{ cursor: "default" }}
                  />
                );
              })}
            </g>

            {/* Filled boxes */}
            <g>
              {boxes.map((b) => {
                if (!b.owner) return null;
                const fill = b.owner === "X" ? "rgba(217,95,75,0.45)" : "rgba(78,141,124,0.45)";
                const stroke = b.owner === "X" ? "#d95f4b" : "#4e8d7c";
                const x = b.c * DOT_W + PAD + 6;
                const y = b.r * DOT_H + PAD + 6;
                const w = DOT_W - 12;
                const h = DOT_H - 12;
                return (
                  <rect key={`${b.r}-${b.c}`} x={x} y={y} width={w} height={h} fill={fill} stroke={stroke} strokeWidth="2" rx="6" />
                );
              })}
            </g>
          </svg>

          {/* Clickable transparent overlay for unclaimed edges (for touch) */}
          <div style={s.overlay}>
            {/* Horizontal unclaimed */}
            {game.h.map((claimed, i) => {
              if (claimed) return null;
              const r = Math.floor(i / COLS);
              const c = i % COLS;
              return (
                <button
                  key={`oh-${r}-${c}`}
                  style={{
                    ...s.edgeBtn,
                    left: c * DOT_W + PAD,
                    top: r * DOT_H + PAD - 10,
                    width: DOT_W,
                    height: 20,
                  }}
                  onClick={() => handleEdge("h", r, c)}
                  disabled={!myTurn}
                />
              );
            })}
            {/* Vertical unclaimed */}
            {game.v.map((claimed, i) => {
              if (claimed) return null;
              const r = Math.floor(i / (COLS + 1));
              const c = i % (COLS + 1);
              return (
                <button
                  key={`ov-${r}-${c}`}
                  style={{
                    ...s.edgeBtn,
                    left: c * DOT_W + PAD - 10,
                    top: r * DOT_H + PAD,
                    width: 20,
                    height: DOT_H,
                  }}
                  onClick={() => handleEdge("v", r, c)}
                  disabled={!myTurn}
                />
              );
            })}
          </div>
        </div>

        <div style={{ fontSize: 12, fontWeight: 800, color: "#6b543f", textAlign: "center" }}>
          {game.status === "play" ? "← quits any time (no result)" : "← to go back"}
        </div>
        <MatchFooter
          finished={finished}
          queued={queued}
          offerFromName={offerFromName}
          oppName={opp}
          onRematch={onRematch}
          onCancelRematch={onCancelRematch}
        />
      </div>
    </>
  );
}

const VIEW_BOX = `0 0 ${COLS * DOT_W + PAD * 2} ${ROWS * DOT_H + PAD * 2}`;

const s: Record<string, React.CSSProperties> = {
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(43,26,18,0.62)", zIndex: 32 },
  modal: { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 380, maxWidth: "92%", padding: 22, zIndex: 33, display: "flex", flexDirection: "column", gap: 12 },
  gridWrapper: { position: "relative", width: COLS * DOT_W + PAD * 2, height: ROWS * DOT_H + PAD * 2, margin: "0 auto" },
  svg: { width: "100%", height: "100%", display: "block" },
  overlay: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" },
  edgeBtn: { position: "absolute", background: "transparent", border: "none", padding: 0, pointerEvents: "auto" },
};
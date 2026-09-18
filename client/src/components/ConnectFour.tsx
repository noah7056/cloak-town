import MatchFooter from "./MatchFooter";
import CoinReward from "./CoinReward";
import { myMark as markOf, oppName as oppOf, type C4Match, type Mark } from "../game/match";

const ROWS = 6;
const COLS = 7;
const CELL = 46;

type Props = {
  game: C4Match;
  myId: string;
  queued: boolean;
  offerFromName: string | null;
  onMove: (col: number) => void;
  onQuit: () => void;
  onRematch: () => void;
  onCancelRematch: () => void;
};

export default function ConnectFour({ game, myId, queued, offerFromName, onMove, onQuit, onRematch, onCancelRematch }: Props) {
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

  // Check if a column is playable (top cell empty)
  const colPlayable = (c: number) => myTurn && !game.grid[c];

  const handleCol = (c: number) => {
    if (colPlayable(c)) onMove(c);
  };

  // Find the row a disc would land in
  const dropRow = (c: number) => {
    for (let r = ROWS - 1; r >= 0; r--) if (!game.grid[r * COLS + c]) return r;
    return -1;
  };

  return (
    <>
      <div style={s.backdrop} />
      <div className="pp-panel" style={s.modal}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="pp-iconbtn pp-iconbtn-off" style={{ width: 44, height: 44, fontSize: 22 }} onClick={onQuit} title="Quit match (no result)">←</button>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>Connect Four</h2>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#6b543f" }}>
              {game.xName} (X) vs {game.oName} (O)
            </div>
          </div>
        </div>
        <div style={{ textAlign: "center", fontWeight: 900, fontSize: 16, minHeight: 24 }}>{headline}</div>
        <CoinReward game={game} myId={myId} />

        <div style={s.gridWrapper}>
          <svg viewBox={VIEW_BOX} style={s.svg} xmlns="http://www.w3.org/2000/svg">
            {/* Board background */}
            <rect x="0" y="0" width={COLS * CELL} height={ROWS * CELL} fill="#3b82f6" rx="8" />
            {/* Disc slots (drawn first so they're underneath click targets) */}
            <g stroke="#2c5aa0" strokeWidth="2">
              {Array.from({ length: ROWS }).map((_, r) =>
                Array.from({ length: COLS }).map((_, c) => {
                  const cell = game.grid[r * COLS + c];
                  const cx = c * CELL + CELL / 2;
                  const cy = r * CELL + CELL / 2;
                  if (!cell) {
                    // empty slot - clickable when column is playable
                    return (
                      <circle
                        key={c}
                        cx={cx}
                        cy={cy}
                        r={CELL / 2 - 4}
                        fill="#1e3a8a"
                        style={{ cursor: colPlayable(c) ? "pointer" : "default" }}
                        onClick={() => handleCol(c)}
                      />
                    );
                  }
                  const fill = cell === "X" ? "#d95f4b" : "#4e8d7c";
                  const glow = cell === "X" ? "rgba(217,95,75,0.6)" : "rgba(78,141,124,0.6)";
                  return (
                    <g key={c}>
                      <circle cx={cx} cy={cy} r={CELL / 2 - 4} fill={fill} filter="drop-shadow(0 2px 0 #1e3a8a)" />
                      <circle cx={cx - 4} cy={cy - 4} r={4} fill={glow} opacity="0.5" />
                    </g>
                  );
                })
              )}
            </g>
            {/* Clickable column targets + hover highlight (drawn on top) */}
            <g>
              {Array.from({ length: COLS }).map((_, c) => (
                <rect
                  key={c}
                  x={c * CELL}
                  y={0}
                  width={CELL}
                  height={ROWS * CELL}
                  fill={colPlayable(c) ? "rgba(255,255,255,0.08)" : "transparent"}
                  style={{ cursor: colPlayable(c) ? "pointer" : "default" }}
                  onClick={() => handleCol(c)}
                />
              ))}
            </g>
            {/* Column hover preview disc (clickable, on top) */}
            {myTurn && (
              <g>
                {Array.from({ length: COLS }).map((_, c) => {
                  if (!colPlayable(c)) return null;
                  const r = dropRow(c);
                  if (r === -1) return null;
                  const cx = c * CELL + CELL / 2;
                  const cy = r * CELL + CELL / 2;
                  const fill = myMark === "X" ? "rgba(217,95,75,0.7)" : "rgba(78,141,124,0.7)";
                  return (
                    <circle
                      key={c}
                      cx={cx}
                      cy={cy}
                      r={CELL / 2 - 4}
                      fill={fill}
                      stroke="#fff"
                      strokeWidth="2"
                      style={{ cursor: "pointer" }}
                      onClick={() => handleCol(c)}
                    />
                  );
                })}
              </g>
            )}
          </svg>
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

const s: Record<string, React.CSSProperties> = {
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(43,26,18,0.62)", zIndex: 25 },
  modal: { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 380, maxWidth: "92%", padding: 22, zIndex: 26, display: "flex", flexDirection: "column", gap: 12 },
  gridWrapper: { width: COLS * CELL, height: ROWS * CELL, margin: "0 auto" },
  svg: { width: "100%", height: "100%", display: "block" },
};

const VIEW_BOX = `0 0 ${COLS * CELL} ${ROWS * CELL}`;
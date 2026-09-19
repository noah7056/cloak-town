import MatchFooter from "./MatchFooter";
import CoinReward from "./CoinReward";
import { myMark as markOf, oppName as oppOf, type TttMatch } from "../game/match";

type Props = {
  game: TttMatch;
  myId: string;
  closing?: boolean;
  /** we queued a rematch and wait for the other side */
  queued: boolean;
  /** incoming rematch offer waiting on our answer (null when none) */
  offerFromName: string | null;
  onMove: (idx: number) => void;
  onQuit: () => void;
  onRematch: () => void;
  onCancelRematch: () => void;
};

/** Center-screen tic-tac-toe board. Darkens the game like the pause menu;
 *  the arrow quits any time (mid-game quits count as no result). */
export default function TicTacToe({ game, myId, closing = false, queued, offerFromName, onMove, onQuit, onRematch, onCancelRematch }: Props) {
  const myMark = markOf(game, myId);
  const myTurn = game.status === "play" && game.turn === myMark;
  const turnName = game.turn === "X" ? game.xName : game.oName;
  const opp = oppOf(game, myId);
  const finished = game.status !== "play";

  let headline: string;
  if (game.status === "xwin") headline = game.x === myId ? "🏆 You win!" : `🏆 ${game.xName} wins!`;
  else if (game.status === "owin") headline = game.o === myId ? "🏆 You win!" : `🏆 ${game.oName} wins!`;
  else if (game.status === "draw") headline = "It's a draw!";
  else headline = myTurn ? `Your turn — you're ${myMark}` : `${turnName}'s turn…`;

  return (
    <>
      <div className={closing ? "pp-anim-fade-out" : "pp-anim-fade-in"} style={s.backdrop} />
      <div className={"pp-panel " + (closing ? "pp-anim-center-out" : "pp-anim-center-in")} style={s.modal}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="pp-iconbtn pp-iconbtn-off" style={{ width: 44, height: 44, fontSize: 22 }} onClick={onQuit} title="Quit game (no result)">←</button>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>Tic-tac-toe</h2>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#6b543f" }}>
              {game.xName} (X) vs {game.oName} (O)
            </div>
          </div>
        </div>
        <div style={{ textAlign: "center", fontWeight: 900, fontSize: 16, minHeight: 24 }}>{headline}</div>
        <CoinReward game={game} myId={myId} />
        <div style={s.grid}>
          {game.board.map((cell, i) => {
            const playable = game.status === "play" && myTurn && !cell;
            return (
              <button
                key={i}
                onClick={() => playable && onMove(i)}
                disabled={!playable}
                style={{
                  ...s.cell,
                  cursor: playable ? "pointer" : "default",
                  background: cell ? "#fff8e7" : playable ? "#e8f3d8" : "#f1e4c3",
                }}
                aria-label={`cell ${i + 1}${cell ? `, ${cell}` : ""}`}
              >
                {cell === "X" ? <span style={{ color: "#d95f4b" }}>✕</span>
                  : cell === "O" ? <span style={{ color: "#4e8d7c" }}>○</span>
                  : null}
              </button>
            );
          })}
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
  modal: { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 320, maxWidth: "92%", padding: 22, zIndex: 26, display: "flex", flexDirection: "column", gap: 12 },
  grid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, justifyItems: "center" },
  cell: {
    width: 72, height: 72, borderRadius: 14, border: "3px solid #4a3728",
    boxShadow: "0 3px 0 #4a3728", fontSize: 34, fontWeight: 900, fontFamily: "inherit",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
  },
};

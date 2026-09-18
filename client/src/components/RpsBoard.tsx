import { useMemo } from "react";
import MatchFooter from "./MatchFooter";
import CoinReward from "./CoinReward";
import { myMark as markOf, oppName as oppOf, type RpsMatch, type RpsChoice } from "../game/match";

const CHOICES: { id: RpsChoice; label: string; beats: RpsChoice }[] = [
  { id: "rock", label: "Rock", beats: "scissors" },
  { id: "paper", label: "Paper", beats: "rock" },
  { id: "scissors", label: "Scissors", beats: "paper" },
];

function choiceResult(a: RpsChoice, b: RpsChoice): "win" | "lose" | "draw" {
  if (a === b) return "draw";
  return CHOICES.find((c) => c.id === a)?.beats === b ? "win" : "lose";
}

function choiceIcon(c: RpsChoice): string {
  return c === "rock" ? "✊" : c === "paper" ? "✋" : "✌️";
}

type Props = {
  game: RpsMatch;
  myId: string;
  /** we queued a rematch and wait for the other side */
  queued: boolean;
  /** incoming rematch offer waiting on our answer (null when none) */
  offerFromName: string | null;
  onMove: (choice: RpsChoice) => void;
  onQuit: () => void;
  onRematch: () => void;
  onCancelRematch: () => void;
}

export default function RpsBoard({ game, myId, queued, offerFromName, onMove, onQuit, onRematch, onCancelRematch }: Props) {
  const myMark = markOf(game, myId);
  const myTurn = game.status === "play" && myMark && !game.picked[myMark.toLowerCase() as "x" | "o"];
  const opp = oppOf(game, myId);
  const finished = game.status !== "play";
  const round = game.round;
  const scoreX = game.scoreX;
  const scoreO = game.scoreO;

  let headline: string;
  if (finished) {
    if (game.status === "xwin") headline = game.x === myId ? "🏆 You win the match!" : `🏆 ${game.xName} wins the match!`;
    else if (game.status === "owin") headline = game.o === myId ? "🏆 You win the match!" : `🏆 ${game.oName} wins the match!`;
    else headline = "Match drawn!";
  } else if (myTurn) {
    headline = `Round ${round} — pick one`;
  } else {
    headline = `${opp} is choosing…`;
  }

  // reveal both choices if round is over
  const showChoices = game.last !== null;

  return (
    <>
      <div style={s.backdrop} />
      <div className="pp-panel" style={s.modal}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="pp-iconbtn pp-iconbtn-off" style={{ width: 44, height: 44, fontSize: 22 }} onClick={onQuit} title="Quit match (no result)">←</button>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>Rock-paper-scissors</h2>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#6b543f" }}>
              {game.xName} (X) vs {game.oName} (O)
            </div>
          </div>
        </div>
        <div style={{ textAlign: "center", fontWeight: 900, fontSize: 16, minHeight: 24 }}>{headline}</div>
        <CoinReward game={game} myId={myId} />
        <div style={{ textAlign: "center", fontSize: 14, fontWeight: 800, color: "#6b543f", marginBottom: 8 }}>
          {game.xName} <b>{scoreX}</b> – <b>{scoreO}</b> {game.oName} &nbsp;|&nbsp; first to 3
        </div>

        {!finished && (
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 8 }}>
            {CHOICES.map((c) => (
              <button
                key={c.id}
                onClick={() => myTurn && onMove(c.id)}
                disabled={!myTurn}
                style={{
                  ...s.cell,
                  cursor: myTurn ? "pointer" : "default",
                  background: myTurn ? "#e8f3d8" : "#f1e4c3",
                  fontSize: 36,
                  width: 96,
                  height: 96,
                }}
                aria-label={c.label}
              >
                {choiceIcon(c.id)}
              </button>
            ))}
          </div>
        )}

        {finished && (
          <div style={s.grid}>
            {CHOICES.map((c) => (
              <button key={c.id} disabled style={s.cell}>
                {choiceIcon(c.id)}
              </button>
            ))}
          </div>
        )}

        {showChoices && game.last && (
          <div style={{ textAlign: "center", fontSize: 14, fontWeight: 800, color: "#4e8d7c", marginTop: 8 }}>
            <b>{game.x === myId ? "You" : game.xName}</b> chose {choiceIcon(game.last.x)} &nbsp;
            <b>{game.o === myId ? "You" : game.oName}</b> chose {choiceIcon(game.last.o)}
            {game.last.winner === "draw" ? (
              <span> — Draw!</span>
            ) : game.last.winner === "X" ? (
              <span> — {game.x === myId ? "You win" : game.xName + " wins"}</span>
            ) : (
              <span> — {game.o === myId ? "You win" : game.oName + " wins"}</span>
            )}
          </div>
        )}

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
  modal: { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 340, maxWidth: "92%", padding: 22, zIndex: 26, display: "flex", flexDirection: "column", gap: 12 },
  grid: { display: "flex", gap: 10, justifyContent: "center" },
  cell: {
    width: 72, height: 72, borderRadius: 14, border: "3px solid #4a3728",
    boxShadow: "0 3px 0 #4a3728", fontSize: 34, fontWeight: 900, fontFamily: "inherit",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
  },
};
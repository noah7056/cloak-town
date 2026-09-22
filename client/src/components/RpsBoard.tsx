import { useEffect, useState } from "react";
import MatchFooter from "./MatchFooter";
import CoinReward from "./CoinReward";
import { myMark as markOf, oppName as oppOf, type RpsMatch, type RpsChoice } from "../game/match";

const CHOICES: { id: RpsChoice; label: string }[] = [
  { id: "rock", label: "Rock" },
  { id: "paper", label: "Paper" },
  { id: "scissors", label: "Scissors" },
];

/** Hand gestures in game colors (no emoji): fist, open palm, blades. */
function RpsGlyph({ c, size = 44 }: { c: RpsChoice; size?: number }) {
  const ink = "#4a3728";
  if (c === "rock") {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48">
        <rect x="11" y="15" width="26" height="23" rx="10" fill="#e0a870" stroke={ink} strokeWidth="3" />
        <path d="M18 15v-4M24 15v-5M30 15v-4" stroke={ink} strokeWidth="3" strokeLinecap="round" />
        <path d="M15 25h18" stroke={ink} strokeWidth="2" opacity="0.45" />
      </svg>
    );
  }
  if (c === "paper") {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48">
        <rect x="13" y="8" width="22" height="31" rx="8" fill="#fff8e7" stroke={ink} strokeWidth="3" />
        <path d="M19 8v11M24.5 8v13M30 8v11" stroke={ink} strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <path d="M16 32 31 13M32 32 17 13" stroke={ink} strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="13" cy="37" r="4.5" fill="none" stroke={ink} strokeWidth="3" />
      <circle cx="35" cy="37" r="4.5" fill="none" stroke={ink} strokeWidth="3" />
    </svg>
  );
}

function MysteryGlyph({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <text x="24" y="35" textAnchor="middle" fontSize="32" fontWeight="900" fontFamily="Nunito, sans-serif" fill="#6b543f">?</text>
    </svg>
  );
}

type RoundEntry = { round: number; x: RpsChoice; o: RpsChoice; winner: string };

/** How long a finished round's showdown lingers before the next picks. */
const SHOWDOWN_MS = 2600;

type Props = {
  game: RpsMatch;
  myId: string;
  closing?: boolean;
  /** we queued a rematch and wait for the other side */
  queued: boolean;
  /** incoming rematch offer waiting on our answer (null when none) */
  offerFromName: string | null;
  onMove: (choice: RpsChoice) => void;
  onQuit: () => void;
  onRematch: () => void;
  onCancelRematch: () => void;
}

export default function RpsBoard({ game, myId, closing = false, queued, offerFromName, onMove, onQuit, onRematch, onCancelRematch }: Props) {
  const myMark = markOf(game, myId);
  const myIsX = myMark !== "O";
  const myTurn = game.status === "play" && !!myMark && !(myIsX ? game.picked.x : game.picked.o);
  const pickedMe = game.status === "play" && !!myMark && !myTurn;
  const opp = oppOf(game, myId);
  const finished = game.status !== "play";
  const round = game.round;
  const scoreX = game.scoreX;
  const scoreO = game.scoreO;

  // Rounds history: the server resolves instantly and never clears `last`,
  // so each round's result is pinned to `game.round - 1` exactly once.
  const [hist, setHist] = useState<RoundEntry[]>([]);
  // My locked pick (the server only reveals it on resolve): shown statically
  // while waiting — never animated, never a placeholder fist.
  const [myPick, setMyPick] = useState<RpsChoice | null>(null);
  useEffect(() => {
    setHist([]);
  }, [game.gameId]);
  useEffect(() => {
    if (!game.last) return;
    const r = game.round - 1;
    if (r < 1) return;
    setHist((h) => {
      if (h.some((e) => e.round === r)) return h;
      return [...h, { round: r, x: game.last!.x, o: game.last!.o, winner: game.last!.winner }];
    });
  }, [game.gameId, game.round, game.last]);

  // Showdown linger: the server is already on the next round the moment a
  // round resolves, so the finished VS holds for a few seconds client-side
  // before the picks return. Final round included — it lingers over the end
  // screen, then yields to the history.
  const [showdown, setShowdown] = useState<(RoundEntry & { key: string }) | null>(null);
  useEffect(() => {
    if (!game.last) {
      setShowdown(null);
      return;
    }
    const r = game.round - 1;
    if (r < 1) {
      setShowdown(null);
      return;
    }
    const key = `${game.gameId}:${r}:${game.last.x}:${game.last.o}`;
    setShowdown((s) => (s && s.key === key ? s : {
      key, round: r, x: game.last!.x, o: game.last!.o, winner: game.last!.winner,
    }));
    const t = setTimeout(() => setShowdown(null), SHOWDOWN_MS);
    return () => clearTimeout(t);
  }, [game.gameId, game.round, game.last, finished]);

  // The linger timer is only a backstop for slow rounds: the moment anyone
  // locks the next round, the old fight yields immediately instead of
  // sitting over fresh picks. Finished matches hold their final fight
  // until the timer releases the history.
  const activeShowdown = showdown && !game.picked.x && !game.picked.o ? showdown : null;
  // Independent failsafe: whatever the animation state does, the end screen
  // (history + payout + rematch) force-appears a beat after the match ends.
  const [endGrace, setEndGrace] = useState(false);
  useEffect(() => {
    if (!finished) {
      setEndGrace(false);
      return;
    }
    const t = setTimeout(() => setEndGrace(true), 3500);
    return () => clearTimeout(t);
  }, [finished, game.gameId]);
  const showFight = !endGrace ? activeShowdown : null;

  const myChoice: RpsChoice | null = !showFight ? null : (myIsX ? showFight.x : showFight.o);
  const oppChoice: RpsChoice | null = !showFight ? null : (myIsX ? showFight.o : showFight.x);
  const iWonRound = !!showFight && showFight.winner !== "draw" && (
    (showFight.winner === "X") === myIsX
  );

  const youLabel = game.x === myId ? "You" : game.xName;
  const themLabel = game.o === myId ? "You" : game.oName;

  let headline: string;
  if (showFight) {
    headline = showFight.winner === "draw"
      ? `Round ${showFight.round} — draw!`
      : iWonRound ? `Round ${showFight.round} — you take it!` : `Round ${showFight.round} — ${myIsX ? themLabel : youLabel} takes it.`;
  } else if (finished) {
    if (game.status === "xwin") headline = game.x === myId ? "You win the match!" : `${game.xName} wins the match!`;
    else if (game.status === "owin") headline = game.o === myId ? "You win the match!" : `${game.oName} wins the match!`;
    else headline = "Match drawn!";
  } else if (!pickedMe) {
    headline = `Round ${round} — pick one`;
  } else {
    headline = `${opp} is choosing…`;
  }

  // My pick clears the moment I'm no longer locked (new round / quit).
  useEffect(() => {
    if (!pickedMe) setMyPick(null);
  }, [pickedMe, game.gameId]);

  const pick = (c: RpsChoice) => {
    setMyPick(c);
    onMove(c);
  };

  const clashFor = (side: "mine" | "theirs"): string => {
    if (!activeShowdown) return "";
    const won = activeShowdown.winner !== "draw" && (
      (activeShowdown.winner === "X") === ((side === "mine") === myIsX)
    );
    const dir = side === "mine" ? "l" : "r";
    if (activeShowdown.winner === "draw") return `pp-anim-fight-draw-${dir}`;
    return won ? `pp-anim-fight-win-${dir}` : `pp-anim-fight-lose-${dir}`;
  };

  return (
    <>
      <div className={closing ? "pp-anim-fade-out" : "pp-anim-fade-in"} style={s.backdrop} />
      <div className={"pp-panel " + (closing ? "pp-anim-center-out" : "pp-anim-center-in")} style={s.modal}>
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
        {/* payout waits for the final fight to finish */}
        {(!finished || !activeShowdown || endGrace) && <CoinReward game={game} myId={myId} />}
        <div style={{ textAlign: "center", fontSize: 14, fontWeight: 800, color: "#6b543f", marginBottom: 8 }}>
          {game.xName} <b>{scoreX}</b> – <b>{scoreO}</b> {game.oName} &nbsp;|&nbsp; first to 3
        </div>

        {!finished && !!myTurn && !activeShowdown && (
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 8 }}>
            {CHOICES.map((c) => (
              <button
                key={c.id}
                onClick={() => pick(c.id)}
                className="pp-rps-pick"
                style={{ ...s.cell, background: "#e8f3d8", width: 96, height: 104, flexDirection: "column", gap: 2 }}
                aria-label={c.label}
              >
                <RpsGlyph c={c.id} size={44} />
                <span style={{ fontSize: 12, fontWeight: 900, color: "#4a3728" }}>{c.label}</span>
              </button>
            ))}
          </div>
        )}

        {!finished && pickedMe && !activeShowdown && (
          <div style={{ display: "flex", gap: 18, justifyContent: "center", alignItems: "center", marginBottom: 8, minHeight: 96 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{ ...s.cell, width: 88, height: 88, borderColor: "#58a05c" }}>
                {myPick ? <RpsGlyph c={myPick} size={44} /> : (
                  <div className="pp-anim-pump">
                    <RpsGlyph c="rock" size={44} />
                  </div>
                )}
              </div>
              <b style={{ fontSize: 13 }}>You</b>
            </div>
            <div style={{
              width: 40, height: 40, borderRadius: "50%", background: "#4a3728", color: "#f2c14e",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: 900, flexShrink: 0,
            }}>
              VS
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{ ...s.cell, width: 88, height: 88 }}>
                <div className="pp-anim-pump">
                  <MysteryGlyph size={44} />
                </div>
              </div>
              <b style={{ fontSize: 13 }}>{opp}</b>
            </div>
          </div>
        )}

        {showFight && myChoice && oppChoice && (
          <div key={showFight.key} style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center", marginBottom: 4 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div className={clashFor("mine")} style={{ ...s.cell, width: 88, height: 88 }}>
                <RpsGlyph c={myChoice} size={44} />
              </div>
              <b style={{ fontSize: 13 }}>You</b>
            </div>
            <div style={{
              width: 40, height: 40, borderRadius: "50%", background: "#4a3728", color: "#f2c14e",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: 900, flexShrink: 0,
            }}>
              VS
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div className={clashFor("theirs")} style={{ ...s.cell, width: 88, height: 88 }}>
                <RpsGlyph c={oppChoice} size={44} />
              </div>
              <b style={{ fontSize: 13 }}>{opp}</b>
            </div>
          </div>
        )}

        {finished && (!activeShowdown || endGrace) && (
          <div className="pp-scroll" style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 300, overflowY: "auto", paddingRight: 2 }}>
            {hist.map((h) => {
              const xWon = h.winner === "X";
              const oWon = h.winner === "O";
              return (
                <div key={h.round} className="pp-card" style={{ padding: "8px 12px", display: "flex", gap: 10, alignItems: "center" }}>
                  <b style={{ fontSize: 13, minWidth: 30 }}>R{h.round}</b>
                  <span style={{ opacity: xWon || h.winner === "draw" ? 1 : 0.45, display: "inline-flex" }}>
                    <RpsGlyph c={h.x} size={30} />
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 900, color: "#6b543f" }}>vs</span>
                  <span style={{ opacity: oWon || h.winner === "draw" ? 1 : 0.45, display: "inline-flex" }}>
                    <RpsGlyph c={h.o} size={30} />
                  </span>
                  <span style={{ flex: 1, textAlign: "right", fontSize: 13, fontWeight: 900, color: h.winner === "draw" ? "#6b543f" : "#3e7d46" }}>
                    {h.winner === "draw" ? "Draw" : h.winner === "X" ? game.xName : game.oName}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {game.status === "play" && (
          <div style={{ fontSize: 12, fontWeight: 800, color: "#6b543f", textAlign: "center" }}>
            ← quits any time (no result)
          </div>
        )}
        {(!finished || !activeShowdown || endGrace) && (
          <MatchFooter
            finished={finished}
            queued={queued}
            offerFromName={offerFromName}
            oppName={opp}
            onRematch={onRematch}
            onCancelRematch={onCancelRematch}
          />
        )}
      </div>
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(43,26,18,0.62)", zIndex: 32 },
  modal: { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 340, maxWidth: "92%", padding: 22, zIndex: 33, display: "flex", flexDirection: "column", gap: 12 },
  cell: {
    width: 72, height: 72, borderRadius: 14, border: "3px solid #4a3728",
    boxShadow: "0 3px 0 #4a3728", fontSize: 34, fontWeight: 900, fontFamily: "inherit",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
    background: "#f1e4c3", cursor: "default",
  },
};

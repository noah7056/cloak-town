import { coinRewardText, type MatchState } from "../game/match";

type Props = {
  game: MatchState;
  myId: string;
};

/** Coin payout banner for minigame boards. Only renders for someone who
 *  actually got paid (winner, or both sides on a draw) — losers see nothing. */
export default function CoinReward({ game, myId }: Props) {
  if (game.status === "play") return null;
  const text = coinRewardText(game, myId);
  if (!text) return null;
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          background: "#f2c14e",
          border: "3px solid #4a3728",
          boxShadow: "0 3px 0 #4a3728",
          borderRadius: 999,
          padding: "5px 14px",
          fontSize: 14,
          fontWeight: 900,
          color: "#4a3728",
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#fff8e7",
            border: "2.5px solid #4a3728",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#c9952f" }} />
        </span>
        {text}
      </div>
    </div>
  );
}

// Shared minigame types: every challenge (tic-tac-toe, RPS, dots, connect
// four) rides the same server-arbitrated invite → board → rematch flow.
// Boards only differ in their `data` payload and move shape.

export type GameKind = "ttt" | "rps" | "dots" | "c4";
export type GameStatus = "play" | "xwin" | "owin" | "draw";
export type Mark = "X" | "O";

export const GAME_LIST: { id: GameKind; label: string; icon: string }[] = [
  { id: "ttt", label: "Tic-tac-toe", icon: "⭘" },
  { id: "rps", label: "Rock-paper-scissors", icon: "✊" },
  { id: "dots", label: "Dots & Boxes", icon: "▦" },
  { id: "c4", label: "Connect Four", icon: "●" },
];

export function gameLabel(kind: string): string {
  return GAME_LIST.find((g) => g.id === kind)?.label || "a game";
}

type Base = {
  gameId: string;
  kind: GameKind;
  x: string;
  o: string;
  xName: string;
  oName: string;
  status: GameStatus;
};

export type TttMatch = Base & {
  kind: "ttt";
  board: (null | Mark)[];
  turn: Mark;
};

export type RpsChoice = "rock" | "paper" | "scissors";

export type RpsMatch = Base & {
  kind: "rps";
  round: number;
  scoreX: number;
  scoreO: number;
  /** has-locked-in flags only — picks stay secret until the round resolves */
  picked: { x: boolean; o: boolean };
  last: null | { x: RpsChoice; o: RpsChoice; winner: Mark | "draw" };
};

export type DotsMatch = Base & {
  kind: "dots";
  /** 4 rows x 3 cols of horizontal edges, 3 rows x 4 cols of verticals.
   *  Each claimed edge stores its claimer's mark (null = free). */
  h: (null | Mark)[];
  v: (null | Mark)[];
  boxes: (null | Mark)[];
  scoreX: number;
  scoreO: number;
  turn: Mark;
  /** true when the mover closed a box and goes again */
  goAgain: boolean;
};

export type C4Match = Base & {
  kind: "c4";
  /** 6 rows x 7 cols, row 0 at the top */
  grid: (null | Mark)[];
  turn: Mark;
};

export type MatchState = TttMatch | RpsMatch | DotsMatch | C4Match;

/** Display name of the other seat from your perspective. */
export function oppName(g: MatchState, myId: string): string {
  return myId === g.x ? g.oName : g.xName;
}

/** Your mark, if you're seated (null for spectators — shouldn't happen). */
export function myMark(g: MatchState, myId: string): Mark | null {
  if (myId === g.x) return "X";
  if (myId === g.o) return "O";
  return null;
}

/** Coin payout line for a finished board (always +1, mirrors the server).
 *  Only returns text for someone who actually got paid: the winner, or
 *  both sides on a draw. Null while playing and from the loser's view. */
export function coinRewardText(
  g: Pick<Base, "status" | "x" | "o" | "xName" | "oName">,
  myId: string
): string | null {
  if (g.status === "xwin") return g.x === myId ? "You earned +1 coin!" : null;
  if (g.status === "owin") return g.o === myId ? "You earned +1 coin!" : null;
  if (g.status === "draw") return "Draw — +1 coin each!";
  return null;
}

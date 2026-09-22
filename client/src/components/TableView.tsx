import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { TableItem } from "../net/socket";
import { GAME_LIST, type GameKind } from "../game/match";

export type DealItem = {
  kind: "card" | "chip" | "die" | "coin" | "board" | "piece";
  deck?: string; rank?: string; suit?: string; color?: string; ptype?: string;
  pset?: string; variant?: string;
  faceUp?: boolean; value?: number; x: number; y: number;
};

type Props = {
  tableIndex: number;
  items: TableItem[];
  closing?: boolean;
  /** right-side sitters see the board rotated 180° — upside down, like
   *  sitting across a real table */
  flipped?: boolean;
  onClose: () => void;
  onAddCard: (opts: { deck: string; rank: string; suit: string; faceUp: boolean }) => void;
  onDeal: (items: DealItem[], stack?: boolean, faceSpawner?: boolean) => void;
  onAddChip: (color: string) => void;
  onAddPiece: (pset: string, ptype: string, color: string) => void;
  onSpawn: (kind: "die" | "coin") => void;
  onMove: (id: string, x: number, y: number) => void;
  onFlip: (id: string) => void;
  onRoll: (id: string) => void;
  onRotate: (id: string, dir: 1 | -1) => void;
  onShuffle: (stackId: string) => void;
  onAlign: (stackId: string) => void;
  onFace: (stackId: string, faceUp: boolean) => void;
  onGroup: (ids: string[]) => void;
  onTake: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  /** other sitters at this table — minigame opponents */
  opponents: { id: string; name: string }[];
  onChallenge: (id: string, kind: GameKind) => void;
};

// ---- card systems ----
type DeckId = "french" | "italian" | "uno";
const DECK_OPTIONS: { id: DeckId; label: string }[] = [
  { id: "french", label: "International" },
  { id: "italian", label: "Italian" },
  { id: "uno", label: "Uno" },
];
const FRENCH_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const FRENCH_SUITS = [
  { id: "spades", glyph: "♠", red: false },
  { id: "hearts", glyph: "♥", red: true },
  { id: "diamonds", glyph: "♦", red: true },
  { id: "clubs", glyph: "♣", red: false },
];
const ITALIAN_RANKS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "F", "C", "R", "Q"];
const ITALIAN_SUITS = [
  { id: "coppe", code: "C", color: "#3b82f6", name: "Coppe" },
  { id: "denari", code: "D", color: "#a97b1f", name: "Denari" },
  { id: "spade", code: "S", color: "#2b1f16", name: "Spade" },
  { id: "bastoni", code: "B", color: "#4c9a52", name: "Bastoni" },
];
const ITALIAN_RANK_NAMES: Record<string, string> = { "1": "Asso", F: "Fante", C: "Cavallo", R: "Re", Q: "Regina" };
// Face art lives in client/public/cards/italian/<suit>/<file> — R + Q are
// photos (.jpg), the rest SVGs. Filenames were normalized on import.
function italianFace(suit?: string, rank?: string): string | null {
  if (!suit || !rank) return null;
  if (!ITALIAN_SUITS.some((s) => s.id === suit)) return null;
  if (!ITALIAN_RANKS.includes(rank)) return null;
  const file = rank === "R" ? "R.jpg" : rank === "Q" ? "Q.jpg" : `${rank}.svg`;
  return `/cards/italian/${suit}/${file}`;
}
const UNO_COLORS = [
  { id: "red", color: "#d95f4b" },
  { id: "yellow", color: "#e0a92e" },
  { id: "green", color: "#4c9a52" },
  { id: "blue", color: "#3b82f6" },
];
const UNO_RANKS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "reverse", "+2"];
const UNO_SINGLE_RANKS = [...UNO_RANKS, "wild", "+4"];
const UNO_LABELS: Record<string, string> = { skip: "⊘", reverse: "⇄", "+2": "+2", wild: "W", "+4": "+4" };

const CHIP_PRESETS = ["#d95f4b", "#3b82f6", "#4c9a52", "#f2c14e", "#8a6fbf", "#faf3df"];

// Chessboard furniture: big square in table space (squares land at about
// card scale). Pieces are free objects — no rules, just toys.
const BOARD_SIZE = 0.62;
export type PieceColor = "white" | "black" | "red";
export type PieceDef = { id: string; label: string; colors: PieceColor[] };
const CHESS_PIECES: PieceDef[] = [
  { id: "pawn", label: "Pawn", colors: ["white", "black", "red"] },
  { id: "rook", label: "Rook", colors: ["white", "black", "red"] },
  { id: "knight", label: "Knight", colors: ["white", "black", "red"] },
  { id: "bishop", label: "Bishop", colors: ["white", "black", "red"] },
  { id: "queen", label: "Queen", colors: ["white", "black", "red"] },
  { id: "king", label: "King", colors: ["white", "black", "red"] },
];
// fairy pieces (no reds; the lonely ones are white-only)
const OTHERS_PIECES: PieceDef[] = [
  { id: "amazon", label: "Amazon", colors: ["white", "black"] },
  { id: "archbishop", label: "Archbishop", colors: ["white", "black"] },
  { id: "bird", label: "Bird", colors: ["white"] },
  { id: "boat", label: "Boat", colors: ["white", "black"] },
  { id: "camel", label: "Camel", colors: ["white"] },
  { id: "centaur", label: "Centaur", colors: ["white", "black"] },
  { id: "champion", label: "Champion", colors: ["white", "black"] },
  { id: "chancellor", label: "Chancellor", colors: ["white", "black"] },
  { id: "commoner", label: "Commoner", colors: ["white", "black"] },
  { id: "dabbaba", label: "Dabbaba", colors: ["white", "black"] },
  { id: "dozer", label: "Dozer", colors: ["white"] },
  { id: "dragon", label: "Dragon", colors: ["white", "black"] },
  { id: "elephant", label: "Elephant", colors: ["white", "black"] },
  { id: "ferz", label: "Ferz", colors: ["white", "black"] },
  { id: "fool", label: "Fool", colors: ["white", "black"] },
  { id: "general", label: "General", colors: ["white"] },
  { id: "giraffe", label: "Giraffe", colors: ["white", "black"] },
  { id: "guard", label: "Guard", colors: ["white"] },
  { id: "hydra", label: "Hydra", colors: ["white"] },
  { id: "mann", label: "Mann", colors: ["white", "black"] },
  { id: "nightrider", label: "Nightrider", colors: ["white", "black"] },
  { id: "scorpion", label: "Scorpion", colors: ["white"] },
  { id: "short-rook", label: "Short Rook", colors: ["white", "black"] },
  { id: "siege-engine", label: "Siege Engine", colors: ["white"] },
  { id: "snake", label: "Snake", colors: ["white"] },
  { id: "spider", label: "Spider", colors: ["white"] },
  { id: "squirrel", label: "Squirrel", colors: ["white"] },
  { id: "tank", label: "Tank", colors: ["white"] },
  { id: "unicorn", label: "Unicorn", colors: ["white", "black"] },
  { id: "wazir", label: "Wazir", colors: ["white", "black"] },
  { id: "wilde-beest", label: "Wilde Beest", colors: ["white"] },
  { id: "wizard", label: "Wizard", colors: ["white", "black"] },
  { id: "zebra", label: "Zebra", colors: ["white", "black"] },
];
const PIECE_SETS: Record<string, PieceDef[]> = { chess: CHESS_PIECES, others: OTHERS_PIECES };
export const PIECE_COLOR_LABELS: Record<PieceColor, string> = {
  white: "White",
  black: "Black",
  red: "Red",
};
function pieceDef(pset: string | undefined, ptype: string | undefined): PieceDef | null {
  const list = PIECE_SETS[pset === "others" ? "others" : "chess"];
  return list.find((p) => p.id === ptype) || null;
}
// filled glyphs for black/red, outline glyphs for white
const PIECE_GLYPHS: Record<string, { dark: string; light: string }> = {
  pawn: { dark: "♟", light: "♙" },
  rook: { dark: "♜", light: "♖" },
  knight: { dark: "♞", light: "♘" },
  bishop: { dark: "♝", light: "♗" },
  queen: { dark: "♛", light: "♕" },
  king: { dark: "♚", light: "♔" },
};
const PIECE_PAINT: Record<string, string> = {
  black: "#2b1f16",
  white: "#faf3df",
  red: "#d95f4b",
};
// Face art lives in client/public/pieces/<set>/<color>-<ptype>.svg.
function pieceFace(pset: string | undefined, color: string | undefined, ptype: string | undefined): string | null {
  const set = pset === "others" ? "others" : "chess";
  const c = color === "black" || color === "red" ? color : "white";
  if (!pieceDef(set, ptype)) return null;
  return `/pieces/${set}/${c}-${ptype}.svg`;
}
const BACK_RANK = ["rook", "knight", "bishop", "queen", "king", "bishop", "knight", "rook"];

// Board kinds (the boards dropdown grows here) + morabaraba geometry: 25
// points on three concentric squares, cross + diagonals. Unit u is a third
// of the board's half-size, in table space.
const BOARD_VARIANTS = [
  { id: "chess", label: "Chessboard" },
  { id: "morabaraba", label: "Morabaraba" },
] as const;
function morabarabaPoints(cx: number, cy: number): { x: number; y: number }[] {
  // the drawn art insets the outer square (8% margins), so the rings sit
  // at 0.42 board-widths out — NOT at the div edges
  const u = BOARD_SIZE * 0.14;
  const pts: { x: number; y: number }[] = [];
  for (const k of [3, 2, 1]) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      pts.push({ x: cx + sx * k * u, y: cy + sy * k * u });
    }
    for (const s of [-1, 1]) {
      pts.push({ x: cx, y: cy + s * k * u });
      pts.push({ x: cx + s * k * u, y: cy });
    }
  }
  pts.push({ x: cx, y: cy });
  return pts.map((p) => ({
    x: Math.max(0.02, Math.min(0.98, p.x)),
    y: Math.max(0.02, Math.min(0.98, p.y)),
  }));
}

function pieceName(item: TableItem): string {
  const def = pieceDef(item.pset, item.ptype);
  const t = def?.label || "Pawn";
  const c = item.color === "black" ? "Black" : item.color === "red" ? "Red" : "White";
  return `${c} ${t}`;
}

function deckOf(item: TableItem): DeckId {
  const d = item.deck;
  return d === "italian" || d === "uno" ? d : "french";
}

function frenchSuit(suit?: string) {
  return FRENCH_SUITS.find((s) => s.id === suit);
}

function namedSuit(deck: DeckId, suit?: string) {
  return ITALIAN_SUITS.find((s) => s.id === suit);
}

function unoColor(suit?: string): string {
  if (suit === "wild") return "#2b1f16";
  return UNO_COLORS.find((c) => c.id === suit)?.color || "#d95f4b";
}

function cardTitle(item: TableItem): string {
  if (item.kind === "die") return `Die (${item.value || "?"})`;
  if (item.kind === "coin") return item.faceUp === false ? "Coin (tails)" : "Coin (heads)";
  if (item.kind === "chip") return "Chip";
  if (item.kind === "board") return "Chessboard";
  if (item.kind === "piece") return pieceName(item);
  const deck = deckOf(item);
  if (deck === "french") return `${item.rank} of ${item.suit}`;
  if (deck === "uno") {
    if (item.rank === "wild") return "Wild";
    if (item.rank === "+4") return "Wild +4";
    return `${item.rank} (${item.suit})`;
  }
  const rn = ITALIAN_RANK_NAMES[item.rank || ""] || item.rank;
  const sn = namedSuit(deck, item.suit)?.name || item.suit;
  return `${rn} of ${sn}`;
}

function unoFullDeck(): { rank: string; suit: string }[] {
  const out: { rank: string; suit: string }[] = [];
  for (const c of UNO_COLORS) {
    out.push({ rank: "0", suit: c.id });
    for (const r of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "reverse", "+2"]) {
      out.push({ rank: r, suit: c.id });
      out.push({ rank: r, suit: c.id });
    }
  }
  for (let k = 0; k < 4; k++) {
    out.push({ rank: "wild", suit: "wild" });
    out.push({ rank: "+4", suit: "wild" });
  }
  return out;
}

// Custom dropdown in the profile menu's recipe (AccountPanel CozySelect):
// a pp-select button with the shared chevron + a pp-card popup list where
// the picked row is highlighted. Native <select> can't be styled to match.
function CozyDropdown({ id, value, options, onPick, disabled, label }: {
  id: string;
  value: string;
  options: { v: string; l: string }[];
  onPick: (v: string) => void;
  disabled?: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.v === value);
  return (
    <span className="pp-select-wrap" style={{ display: "flex", width: "100%" }}>
      <button
        type="button"
        id={id}
        className="pp-select"
        style={{
          display: "flex", alignItems: "center", gap: 6, textAlign: "left",
          overflow: "hidden", whiteSpace: "nowrap", fontSize: 13,
        }}
        disabled={disabled}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
          {cur?.l || value}
        </span>
      </button>
      {open && (
        <>
          <span
            style={{ position: "fixed", inset: 0, zIndex: 15 }}
            onClick={() => setOpen(false)}
          />
          <span
            className="pp-card pp-scroll"
            style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 16,
              maxHeight: 180, overflowY: "auto", padding: 6,
              display: "flex", flexDirection: "column", gap: 2,
            }}
          >
            {options.map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => { onPick(o.v); setOpen(false); }}
                style={{
                  background: o.v === value ? "#f2c14e" : "none",
                  border: "none", borderRadius: 8, padding: "7px 10px", cursor: "pointer",
                  font: "inherit", fontSize: 14, fontWeight: 800, color: "#4a3728", textAlign: "left",
                }}
              >
                {o.l}
              </button>
            ))}
          </span>
        </>
      )}
    </span>
  );
}

// Custom checkbox in the UI's language: cream box, ink border, leaf fill +
// cream tick when on. The UI has no native checkboxes, so toggles were
// pp-choice buttons before — this reads as an actual checkbox instead.
function CozyCheck({ checked, onToggle, label, title }: {
  checked: boolean;
  onToggle: () => void;
  label: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      title={title}
      onClick={onToggle}
      style={{
        display: "flex", alignItems: "center", gap: 8, background: "none",
        border: "none", padding: "3px 0", cursor: "pointer",
        font: "inherit", fontSize: 13, fontWeight: 800, color: "#6b543f", textAlign: "left",
      }}
    >
      <span
        style={{
          width: 22, height: 22, borderRadius: 7, flexShrink: 0,
          background: checked ? "#58a05c" : "#fff8e7",
          border: "3px solid #4a3728",
          boxShadow: "inset 0 2px 0 rgba(74,55,40,0.12)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}
      >
        {checked && (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 6.5 5 9.5 10 2.5" fill="none" stroke="#fff8e7" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span>{label}</span>
    </button>
  );
}

function BinGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h16" stroke="#fff8e7" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2" stroke="#fff8e7" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M6.5 7l1 12a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-12" stroke="#fff8e7" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 11v6M14 11v6" stroke="#fff8e7" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ---- memoized pieces (room-state ticks at 20Hz — only the piece whose
// fields actually changed re-renders) ----
type ItemProps = {
  item: TableItem;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent, dragId: string, isStack: boolean, selRef: string) => void;
  onDoubleClick: (id: string) => void;
};

function itemEqual(a: ItemProps, b: ItemProps): boolean {
  const x = a.item, y = b.item;
  return (
    x.id === y.id && x.kind === y.kind && x.x === y.x && x.y === y.y &&
    x.z === y.z && x.stack === y.stack && x.rot === y.rot &&
    x.deck === y.deck && x.rank === y.rank && x.suit === y.suit &&
    x.faceUp === y.faceUp && x.color === y.color && x.value === y.value &&
    x.ptype === y.ptype && x.pset === y.pset && x.variant === y.variant &&
    a.selected === b.selected
  );
}

const ChipView = memo(function ChipView({ item, selected, onPointerDown }: ItemProps) {
  return (
    <div
      onPointerDown={(e) => onPointerDown(e, item.id, false, item.id)}
      title="Chip — drag to move"
      style={{
        ...s.chip,
        left: `${item.x * 100}%`, top: `${item.y * 100}%`, zIndex: item.z || 0,
        background: item.color || "#d95f4b",
        outline: selected ? "3px solid #faf3df" : "none",
      }}
    />
  );
}, itemEqual);

// Thin + tall for Italian art (1:2), standard 46x64 for the rest — same
// footprint class so piles stay tidy.
function cardDims(item: TableItem): { w: number; h: number } {
  return deckOf(item) === "italian" ? { w: 40, h: 70 } : { w: 46, h: 64 };
}

function cardBoxBg(item: TableItem): string {
  const deck = deckOf(item);
  return deck === "uno" && item.faceUp !== false ? unoColor(item.suit) : "#fff8e7";
}

// The face of a card on its own (no position, no handlers) — shared by the
// single-card view and the top of a stack.
function CardFaceContent({ item }: { item: TableItem }) {
  const deck = deckOf(item);
  const faceUp = item.faceUp !== false;
  if (!faceUp) return <div style={s.cardBack} />;
  if (deck === "uno") {
    const label = UNO_LABELS[item.rank || ""] || item.rank;
    return (
      <>
        <div style={{ ...s.unoCorner }}>{label}</div>
        <div style={s.unoPip}>{label}</div>
      </>
    );
  }
  if (deck === "french") {
    const fs = frenchSuit(item.suit);
    const col = fs?.red ? "#d95f4b" : "#2b1f16";
    return (
      <>
        <div style={{ ...s.corner, color: col }}>
          <div>{item.rank}</div>
          <div>{fs?.glyph || "?"}</div>
        </div>
        <div style={{ ...s.pip, color: col }}>{fs?.glyph || "?"}</div>
      </>
    );
  }
  // Italian faces are real card art (taller + thinner than the standard
  // card, same footprint class so piles stay tidy)
  const src = italianFace(item.suit, item.rank);
  if (src) {
    return (
      <img
        src={src}
        alt={cardTitle(item)}
        draggable={false}
        style={s.italianFace}
      />
    );
  }
  return (
    <>
      <div style={{ ...s.corner, color: "#2b1f16" }}>
        <div>{item.rank}</div>
        <div>?</div>
      </div>
      <div style={{ ...s.pip, color: "#2b1f16" }}>?</div>
    </>
  );
}

function pieceTransform(item: TableItem): string {
  const r = ((item.rot || 0) % 4 + 4) % 4;
  return r === 0 ? "translate(-50%,-50%)" : `translate(-50%,-50%) rotate(${r * 90}deg)`;
}

// Pile count badge: bottom-right corner of the pile, counter-rotated so
// the number always reads upright — including for the mirrored viewer,
// whose whole board is turned 180°.
function stackCountStyle(rot: number | undefined, flipped: boolean): React.CSSProperties {
  const r = (((rot || 0) % 4) + 4) % 4;
  return {
    position: "absolute", right: -12, bottom: -12,
    transform: `rotate(${-r * 90 - (flipped ? 180 : 0)}deg)`,
    minWidth: 24, height: 24, padding: "0 5px", borderRadius: 999,
    background: "#d95f4b", border: "3px solid #4a3728",
    color: "#faf3df", fontSize: 12, fontWeight: 900,
    display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 2px 0 rgba(43,31,22,0.6)", pointerEvents: "none",
  };
}

const CardView = memo(function CardView({ item, selected, onPointerDown, onDoubleClick }: ItemProps) {
  const { w, h } = cardDims(item);
  const faceUp = item.faceUp !== false;
  return (
    <div
      onPointerDown={(e) => onPointerDown(e, item.id, false, item.id)}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(item.id); }}
      title={faceUp ? `${cardTitle(item)} — drag to move, double-click to flip` : "Face-down card — double-click to flip"}
      style={{
        ...s.card,
        width: w, height: h,
        left: `${item.x * 100}%`, top: `${item.y * 100}%`, zIndex: item.z || 0,
        transform: pieceTransform(item),
        background: cardBoxBg(item),
        outline: selected ? "3px solid #f2c14e" : "none",
      }}
    >
      <CardFaceContent item={item} />
    </div>
  );
}, itemEqual);

// A pile: the top card's face over offset shadow layers, with the pile
// count riding on its side. One grab moves the whole thing.
function StackView({ members, top, selected, flipped, onPointerDown, onDoubleClick }: {
  members: TableItem[];
  top: TableItem;
  selected: boolean;
  flipped: boolean;
  onPointerDown: (e: React.PointerEvent, dragId: string, isStack: boolean, selRef: string) => void;
  onDoubleClick: (id: string) => void;
}) {
  const stackId = top.stack || "";
  const { w, h } = cardDims(top);
  return (
    <div
      onPointerDown={(e) => onPointerDown(e, top.id, true, stackId)}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(top.id); }}
      title={`${members.length} cards — drag to move, click to flip the top, double-click to take one`}
      style={{
        position: "absolute", width: w, height: h,
        left: `${top.x * 100}%`, top: `${top.y * 100}%`,
        zIndex: Math.max(...members.map((m) => m.z || 0)),
        transform: pieceTransform(top),
        cursor: "grab", touchAction: "none",
        outline: selected ? "3px solid #f2c14e" : "none", borderRadius: 8,
      }}
    >
      {/* thickness: two sheets peeking out behind the top card */}
      <div style={{ position: "absolute", inset: 0, transform: "translate(-5px,-5px)", background: "#e8dcc2", border: "3px solid #4a3728", borderRadius: 8 }} />
      <div style={{ position: "absolute", inset: 0, transform: "translate(-2.5px,-2.5px)", background: "#f4ecd8", border: "3px solid #4a3728", borderRadius: 8 }} />
      <div style={{ position: "absolute", inset: 0, background: cardBoxBg(top), border: "3px solid #4a3728", borderRadius: 8, boxShadow: "0 3px 0 rgba(43,31,22,0.6)", overflow: "hidden" }}>
        <CardFaceContent item={top} />
      </div>
      <div style={stackCountStyle(top.rot, flipped)}>{members.length}</div>
    </div>
  );
}

const DIE_PIPS: Record<string, [number, number][]> = {
  TL: [[28, 28]], ML: [[28, 50]], BL: [[28, 72]],
  C: [[50, 50]],
  TR: [[72, 28]], MR: [[72, 50]], BR: [[72, 72]],
};
const DIE_FACES: Record<number, string[]> = {
  1: ["C"],
  2: ["TL", "BR"],
  3: ["TL", "C", "BR"],
  4: ["TL", "TR", "BL", "BR"],
  5: ["TL", "TR", "C", "BL", "BR"],
  6: ["TL", "ML", "BL", "TR", "MR", "BR"],
};

const DieView = memo(function DieView({ item, selected, onPointerDown, onDoubleClick }: ItemProps) {
  const v = item.value && item.value >= 1 && item.value <= 6 ? item.value : 1;
  return (
    <div
      onPointerDown={(e) => onPointerDown(e, item.id, false, item.id)}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(item.id); }}
      title={`Die (${v}) — drag to move, double-click to roll`}
      style={{
        ...s.card,
        width: 44, height: 44,
        left: `${item.x * 100}%`, top: `${item.y * 100}%`, zIndex: item.z || 0,
        transform: pieceTransform(item),
        outline: selected ? "3px solid #f2c14e" : "none",
      }}
    >
      {(DIE_FACES[v] || DIE_FACES[1]).flatMap((k) => DIE_PIPS[k]).map(([px, py], i) => (
        <span
          key={i}
          style={{
            position: "absolute", left: `${px}%`, top: `${py}%`,
            width: 8, height: 8, borderRadius: "50%", background: "#2b1f16",
            transform: "translate(-50%,-50%)",
          }}
        />
      ))}
    </div>
  );
}, itemEqual);

const CoinView = memo(function CoinView({ item, selected, onPointerDown, onDoubleClick }: ItemProps) {
  const heads = item.faceUp !== false;
  return (
    <div
      onPointerDown={(e) => onPointerDown(e, item.id, false, item.id)}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(item.id); }}
      title={heads ? "Coin (heads) — drag to move, double-click to flip" : "Coin (tails) — drag to move, double-click to flip"}
      style={{
        ...s.chip,
        width: 30, height: 30,
        left: `${item.x * 100}%`, top: `${item.y * 100}%`, zIndex: item.z || 0,
        background: "#f2c14e",
        outline: selected ? "3px solid #faf3df" : "none",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {heads ? (
        <span style={{ fontSize: 16, fontWeight: 900, color: "#8a5a33", lineHeight: 1 }}>★</span>
      ) : (
        <span style={{ width: 14, height: 14, borderRadius: "50%", border: "3px solid #8a5a33" }} />
      )}
    </div>
  );
}, itemEqual);

// Chessboard furniture: big 8x8 square, pinned under everything. Draggable,
// never piles up, never stacks.
const BoardView = memo(function BoardView({ item, selected, onPointerDown }: ItemProps) {
  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const variant = item.variant === "morabaraba" ? "morabaraba" : "chess";
  // morabaraba dots: 25 intersections in 0..100 board space
  const dots: [number, number][] = [];
  if (variant === "morabaraba") {
    for (const k of [42, 28, 14]) {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        dots.push([50 + sx * k, 50 + sy * k]);
      }
      for (const s of [-1, 1]) {
        dots.push([50, 50 + s * k]);
        dots.push([50 + s * k, 50]);
      }
    }
    dots.push([50, 50]);
  }
  return (
    <div
      onPointerDown={(e) => onPointerDown(e, item.id, false, item.id)}
      title={variant === "morabaraba" ? "Morabaraba — drag to move" : "Chessboard — drag to move"}
      style={{
        position: "absolute",
        width: `${BOARD_SIZE * 100}%`, aspectRatio: "1 / 1",
        left: `${item.x * 100}%`, top: `${item.y * 100}%`,
        transform: pieceTransform(item), zIndex: 0,
        background: "#ecdcb9",
        border: "4px solid #4a3728", borderRadius: 8,
        boxShadow: "0 4px 0 rgba(43,31,22,0.5)",
        outline: selected ? "3px solid #f2c14e" : "none",
        outlineOffset: 3,
        cursor: "grab", touchAction: "none", overflow: "hidden",
      }}
    >
      {variant === "morabaraba" ? (
        <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          {/* three concentric squares */}
          <rect x="8" y="8" width="84" height="84" fill="none" stroke="#4a3728" strokeWidth="2" />
          <rect x="22" y="22" width="56" height="56" fill="none" stroke="#4a3728" strokeWidth="2" />
          <rect x="36" y="36" width="28" height="28" fill="none" stroke="#4a3728" strokeWidth="2" />
          {/* cross + diagonals */}
          <line x1="50" y1="8" x2="50" y2="92" stroke="#4a3728" strokeWidth="2" />
          <line x1="8" y1="50" x2="92" y2="50" stroke="#4a3728" strokeWidth="2" />
          <line x1="8" y1="8" x2="92" y2="92" stroke="#4a3728" strokeWidth="2" />
          <line x1="8" y1="92" x2="92" y2="8" stroke="#4a3728" strokeWidth="2" />
          {dots.map(([dx, dy], i) => (
            <circle key={i} cx={dx} cy={dy} r="2.4" fill="#4a3728" />
          ))}
        </svg>
      ) : (
      <div style={{
        position: "absolute", inset: 0,
        display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gridTemplateRows: "repeat(8, 1fr)",
      }}>
        {Array.from({ length: 64 }).map((_, i) => {
          const f = i % 8, r = Math.floor(i / 8);
          const dark = (f + r) % 2 === 1;
          return (
            <div key={i} style={{ background: dark ? "#a5714f" : "transparent", position: "relative" }}>
              {f === 0 && (
                <span style={s.boardRank}>{8 - r}</span>
              )}
              {r === 7 && (
                <span style={s.boardFile}>{files[f]}</span>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}, itemEqual);

// Free chess piece: SVG face art, no rules attached (glyph fallback if an
// image is missing).
const PieceView = memo(function PieceView({ item, selected, onPointerDown, onDoubleClick }: ItemProps) {
  const g = PIECE_GLYPHS[item.ptype || ""];
  const color = item.color === "black" ? "black" : item.color === "red" ? "red" : "white";
  const [imgOk, setImgOk] = useState(true);
  const src = pieceFace(item.pset, item.color, item.ptype);
  return (
    <div
      onPointerDown={(e) => onPointerDown(e, item.id, false, item.id)}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(item.id); }}
      title={`${pieceName(item)} — drag to move`}
      style={{
        position: "absolute", width: 38, height: 38,
        left: `${item.x * 100}%`, top: `${item.y * 100}%`, zIndex: item.z || 0,
        transform: pieceTransform(item),
        display: "flex", alignItems: "center", justifyContent: "center",
        outline: selected ? "3px solid #f2c14e" : "none", borderRadius: 10,
        cursor: "grab", touchAction: "none", userSelect: "none",
      }}
    >
      {src && imgOk ? (
        <img
          src={src}
          alt={pieceName(item)}
          draggable={false}
          onError={() => setImgOk(false)}
          style={{ width: 34, height: 34, objectFit: "contain", pointerEvents: "none", userSelect: "none" }}
        />
      ) : (
        <span style={{
          fontSize: 30, lineHeight: 1, color: PIECE_PAINT[color],
          textShadow: color === "white"
            ? "0 0 3px #4a3728, 0 0 3px #4a3728, 0 2px 0 rgba(43,31,22,0.6)"
            : "0 2px 0 rgba(43,31,22,0.6)",
        }}>
          {g ? (color === "white" ? g.light : g.dark) : "?"}
        </span>
      )}
    </div>
  );
}, itemEqual);

/** Open tabletop: the table IS the menu — a big wooden square like the deck
 *  tables in game, one floating add-panel on the side, back / help / flip /
 *  bin floating up top. Cards + chips, free play, shared live. No turns yet. */
export default function TableView({
  tableIndex, items, closing = false, flipped = false,
  onClose, onAddCard, onDeal, onAddChip, onAddPiece, onSpawn, onMove, onFlip, onRoll, onRotate, onShuffle, onAlign, onFace, onGroup, onTake, onRemove, onClear, opponents, onChallenge,
}: Props) {
  const surfRef = useRef<HTMLDivElement>(null);
  const [objType, setObjType] = useState<"card" | "chip" | "die" | "coin" | "boards" | "pieces">("card");
  const [deck, setDeck] = useState<DeckId>("french");
  const [grouping, setGrouping] = useState("full");
  const [suits, setSuits] = useState<string[]>(["spades"]);
  const [rank, setRank] = useState("A");
  const [suit, setSuit] = useState("spades");
  const [faceDown, setFaceDown] = useState(false);
  const [chipColor, setChipColor] = useState(CHIP_PRESETS[0]);
  // boards panel: kind picker, full-setup toggle, army choice for
  // chessboards (chess pieces or checkers chips), dark-side color
  const [boardType, setBoardType] = useState<string>("chess");
  const [boardPieces, setBoardPieces] = useState(true);
  const [boardArmy, setBoardArmy] = useState<string>("chess");
  const [boardRed, setBoardRed] = useState(false);
  const [pieceSet, setPieceSet] = useState<string>("chess");
  const [pieceType, setPieceType] = useState<string>("pawn");
  const [pieceColor, setPieceColor] = useState<string>("white");
  const [pieceQuery, setPieceQuery] = useState("");
  const [pieceListOpen, setPieceListOpen] = useState(false);
  // everything pickable, both sets — the color menu follows the piece
  const pieceDefNow = pieceDef(pieceSet, pieceType) || CHESS_PIECES[0];
  const pieceSearch = pieceQuery.trim().toLowerCase();
  const pieceMatches: { def: PieceDef; set: string }[] = [];
  for (const [set, list] of [["chess", CHESS_PIECES], ["others", OTHERS_PIECES]] as const) {
    for (const def of list) {
      if (!pieceSearch || def.label.toLowerCase().includes(pieceSearch)) {
        pieceMatches.push({ def, set });
      }
      if (pieceMatches.length >= 40) break;
    }
    if (pieceMatches.length >= 40) break;
  }
  const pickPiece = (set: string, def: PieceDef) => {
    setPieceSet(set);
    setPieceType(def.id);
    setPieceColor(def.colors.includes(pieceColor as PieceColor) ? pieceColor : def.colors[0]);
    setPieceQuery("");
    setPieceListOpen(false);
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // shift-click multi-selection (free cards only — stacks select as one)
  const [multiSel, setMultiSel] = useState<Set<string>>(new Set());
  // local drag override: follows the cursor instantly, the server echo
  // (20Hz) takes over on release — this is what makes dragging feel live
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  const dragRef = useRef<{ id: string; pointerId: number; moved: boolean } | null>(null);
  const lastSentRef = useRef(0);

  // stable callbacks (refs, never re-created) so memoized pieces don't
  // re-render just because room-state ticked
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const flipRef = useRef(onFlip);
  flipRef.current = onFlip;
  const rollRef = useRef(onRoll);
  rollRef.current = onRoll;
  const rotateRef = useRef(onRotate);
  rotateRef.current = onRotate;
  const shuffleRef = useRef(onShuffle);
  shuffleRef.current = onShuffle;
  const groupRef = useRef(onGroup);
  groupRef.current = onGroup;
  const takeRef = useRef(onTake);
  takeRef.current = onTake;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const flippedRef = useRef(flipped);
  flippedRef.current = flipped;
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;
  const multiRef = useRef<Set<string>>(multiSel);
  multiRef.current = multiSel;

  const surfPos = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const el = surfRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    const x = Math.max(0.02, Math.min(0.98, (clientX - r.left) / r.width));
    const y = Math.max(0.02, Math.min(0.98, (clientY - r.top) / r.height));
    // rotated viewers map the same gesture to the mirrored spot, so both
    // sides drag in one shared coordinate space
    if (flippedRef.current) return { x: 1 - x, y: 1 - y };
    return { x, y };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent, dragId: string, isStack: boolean, selRef: string) => {
    e.stopPropagation();
    // no pointer capture — moves are tracked on the window, so a fast
    // cursor that leaves the piece keeps dragging it.
    // dragId is always an item id (the server moves by item); selRef is
    // what the click selects (a stack id for piles).
    dragRef.current = { id: dragId, pointerId: e.pointerId, moved: false };
    if (e.shiftKey) {
      // shift-click toggles into the group-pick set — free cards by id,
      // whole piles by stack id — carrying the lone single selection
      // along so click-then-shift-click grows the set
      const carry = selectedRef.current && selectedRef.current !== selRef
        ? [selectedRef.current]
        : [];
      setSelectedId(null);
      setMultiSel((prev) => {
        const next = new Set([...carry, ...prev]);
        if (next.has(selRef)) next.delete(selRef);
        else next.add(selRef);
        return next;
      });
    } else {
      setMultiSel(new Set());
      setSelectedId(selRef);
    }
  }, []);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    // mouse hover (no buttons) is never a drag — guards a missed pointerup
    if (e.pointerType === "mouse" && e.buttons === 0) return;
    const p = surfPos(e.clientX, e.clientY);
    if (!p) return;
    d.moved = true;
    setDragPos({ id: d.id, x: p.x, y: p.y });
    // throttled + min-delta: room-state echoes at 20Hz anyway, no point
    // flooding the socket with sub-pixel steps
    const now = performance.now();
    if (now - lastSentRef.current < 33) return;
    lastSentRef.current = now;
    moveRef.current(d.id, Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000);
  }, [surfPos]);

  const handlePointerUp = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (d.moved) {
      const p = surfPos(e.clientX, e.clientY);
      if (p) moveRef.current(d.id, Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000);
    }
    dragRef.current = null;
    setDragPos(null);
  }, [surfPos]);

  // Window-level tracking: moves/up fire even when the cursor outruns the
  // piece (or leaves the window mid-drag), so it never gets dropped.
  useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  const handleDoubleClick = useCallback((id: string) => {
    const it = itemsRef.current.find((e) => e.id === id);
    // a pile gives up its top card, dice roll, everything else flips
    if (it?.stack) takeRef.current(id);
    else if (it?.kind === "die") rollRef.current(id);
    else flipRef.current(id);
  }, []);

  // Rotate targets: cards, dice + pieces (single, pile top, or every
  // picked one — piles contribute their tops). Shared by the arrow/A/D
  // keys and the topbar buttons.
  const rotateTargets = useCallback((): string[] => {
    const list = itemsRef.current;
    const rotatable = (it: TableItem | undefined) =>
      it && (it.kind === "card" || it.kind === "die" || it.kind === "piece" || it.kind === "board") ? it.id : null;
    const topOf = (stackId: string): TableItem | null => {
      const ms = list.filter((x) => x.stack === stackId);
      return ms.length > 0
        ? ms.reduce((a, b) => ((b.z || 0) > (a.z || 0) ? b : a))
        : null;
    };
    const ids: string[] = [];
    if (multiRef.current.size > 0) {
      for (const id of multiRef.current) {
        const hit = id.startsWith("ts-")
          ? rotatable(topOf(id) || undefined)
          : rotatable(list.find((x) => x.id === id));
        if (hit) ids.push(hit);
      }
      return ids;
    }
    const sel = selectedRef.current;
    if (!sel) return ids;
    if (sel.startsWith("ts-")) {
      const hit = rotatable(topOf(sel) || undefined);
      if (hit) ids.push(hit);
      return ids;
    }
    const hit = rotatable(list.find((x) => x.id === sel));
    if (hit) ids.push(hit);
    return ids;
  }, []);

  // Shuffle target: the single selected pile (by stack, or by one of its
  // cards) — multi-pick shuffling stays out on purpose.
  const shuffleTarget = useCallback((): string | null => {
    if (multiRef.current.size > 0) return null;
    const sel = selectedRef.current;
    if (!sel) return null;
    const list = itemsRef.current;
    if (sel.startsWith("ts-")) {
      return list.some((x) => x.stack === sel) ? sel : null;
    }
    const it = list.find((x) => x.id === sel);
    return it?.stack || null;
  }, []);

  // Rotate the selection 90° — ←/A counter-clockwise, →/D clockwise —
  // and S shuffles the selected pile.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      // the game canvas eats arrows for movement — but a open table freezes
      // your feet, so they rotate here instead
      const k = e.key.toLowerCase();
      if (k === "s") {
        const sid = shuffleTarget();
        if (!sid) return;
        e.preventDefault();
        e.stopPropagation();
        shuffleRef.current(sid);
        return;
      }
      const dir = (k === "arrowright" || k === "d") ? 1 : (k === "arrowleft" || k === "a") ? -1 : 0;
      if (!dir) return;
      const ids = rotateTargets();
      if (ids.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      ids.forEach((id) => rotateRef.current(id, dir as 1 | -1));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [rotateTargets, shuffleTarget]);

  const pickDeck = (d: DeckId) => {
    setDeck(d);
    setGrouping("full");
    if (d === "french") { setSuits(["spades"]); setRank("A"); setSuit("spades"); }
    if (d === "italian") { setSuits(["coppe"]); setRank("1"); setSuit("coppe"); }
    if (d === "uno") { setSuits(["red"]); setRank("0"); setSuit("red"); }
  };

  const suitOptions: { id: string; label: string }[] =
    deck === "french" ? FRENCH_SUITS.map((su) => ({ id: su.id, label: `${su.glyph} ${su.id}` })) :
    deck === "italian" ? ITALIAN_SUITS.map((su) => ({ id: su.id, label: su.name })) :
    UNO_COLORS.map((c) => ({ id: c.id, label: c.id }));

  const rankOptions: string[] =
    deck === "french" ? FRENCH_RANKS :
    deck === "italian" ? ITALIAN_RANKS :
    UNO_SINGLE_RANKS;

  const groupCount = grouping === "full"
    ? deck === "french" ? 52 : deck === "uno" ? 108 : 56
    : grouping === "single" ? 1
    : deck === "uno" ? suits.length * 25
    : deck === "french" ? suits.length * 13 : suits.length * 14;

  const needSuits = grouping !== "full" && grouping !== "single"
    ? Number(grouping.slice(0, 1))
    : 0;
  const suitsOk = needSuits === 0 || suits.length === needSuits;

  const spawnGroup = () => {
    if (!suitsOk) return;
    let specs: { rank: string; suit: string }[] = [];
    if (grouping === "full") {
      if (deck === "french") {
        for (const su of FRENCH_SUITS) for (const r of FRENCH_RANKS) specs.push({ rank: r, suit: su.id });
      } else if (deck === "italian") {
        for (const su of ITALIAN_SUITS) for (const r of ITALIAN_RANKS) specs.push({ rank: r, suit: su.id });
      } else {
        specs = unoFullDeck();
      }
    } else {
      // 1/2/3 suits (or colors): every rank of each checked suit
      const ranks = deck === "french" ? FRENCH_RANKS
        : deck === "italian" ? ITALIAN_RANKS
        : [...UNO_RANKS];
      for (const su of suits) {
        if (deck === "uno" && !UNO_COLORS.some((c) => c.id === su)) continue;
        for (const r of ranks) {
          if (deck === "uno") {
            // uno color sets: 0 once, everything else twice
            specs.push({ rank: r, suit: su });
            if (r !== "0") specs.push({ rank: r, suit: su });
          } else {
            specs.push({ rank: r, suit: su });
          }
        }
      }
    }
    // group spawns land stacked: one shared center, the server piles them
    // in dealing order (last on top)
    const cx = 0.3 + Math.random() * 0.4;
    const cy = 0.3 + Math.random() * 0.4;
    onDeal(specs.map((sp) => ({
      kind: "card" as const, deck, rank: sp.rank, suit: sp.suit,
      faceUp: !faceDown, x: cx, y: cy,
    })), true);
  };

  const toggleSuit = (id: string) => {
    setSuits((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };

  const unoWildSingle = deck === "uno" && (rank === "wild" || rank === "+4");
  const spawnSingle = () => {
    onAddCard({ deck, rank, suit: unoWildSingle ? "wild" : suit, faceUp: !faceDown });
  };

  // Board spawn: big square near the middle + optional setup. Chess gets
  // white (bottom) vs dark (top), checkers gets chips on dark squares,
  // morabaraba gets cows on every point but the center. The server mirrors
  // the batch for right-side spawners so white stays on theirs.
  const spawnBoard = () => {
    const dark: string = boardRed ? "red" : "black";
    const darkHex = boardRed ? "#d95f4b" : "#2b1f16";
    const cx = 0.5 + (Math.random() - 0.5) * 0.06;
    const cy = 0.5 + (Math.random() - 0.5) * 0.06;
    const batch: DealItem[] = [{ kind: "board", variant: boardType, x: cx, y: cy }];
    if (boardPieces) {
      if (boardType === "morabaraba") {
        // cows on every point but the middle: white south + west row,
        // dark north + east row
        for (const p of morabarabaPoints(cx, cy)) {
          const dx = Math.round((p.x - cx) * 1000);
          const dy = Math.round((p.y - cy) * 1000);
          if (dx === 0 && dy === 0) continue;
          const white = dy > 0 || (dy === 0 && dx < 0);
          batch.push({
            kind: "chip", color: white ? "#faf3df" : darkHex, x: p.x, y: p.y,
          });
        }
      } else if (boardArmy === "checkers") {
        const sq = BOARD_SIZE / 8;
        for (let r = 0; r < 8; r++) {
          for (let f = 0; f < 8; f++) {
            if ((f + r) % 2 !== 1) continue;
            if (r > 2 && r < 5) continue;
            batch.push({
              kind: "chip",
              color: r < 3 ? darkHex : "#faf3df",
              x: Math.max(0.02, Math.min(0.98, cx + (f - 3.5) * sq)),
              y: Math.max(0.02, Math.min(0.98, cy + (r - 3.5) * sq)),
            });
          }
        }
      } else {
        const sq = BOARD_SIZE / 8;
        for (let f = 0; f < 8; f++) {
          const x = Math.max(0.02, Math.min(0.98, cx + (f - 3.5) * sq));
          batch.push(
            { kind: "piece", pset: "chess", ptype: BACK_RANK[f], color: dark, x, y: Math.max(0.02, Math.min(0.98, cy - 3.5 * sq)) },
            { kind: "piece", pset: "chess", ptype: "pawn", color: dark, x, y: Math.max(0.02, Math.min(0.98, cy - 2.5 * sq)) },
            { kind: "piece", pset: "chess", ptype: "pawn", color: "white", x, y: Math.max(0.02, Math.min(0.98, cy + 2.5 * sq)) },
            { kind: "piece", pset: "chess", ptype: BACK_RANK[f], color: "white", x, y: Math.max(0.02, Math.min(0.98, cy + 3.5 * sq)) },
          );
        }
      }
    }
    onDeal(batch, false, true);
  };

  // Selection: a single ref — an item id, a stack id ("ts-…"), or nothing —
  // plus the shift-click group-pick set (free cards only). A leftover stack
  // id (pile taken apart) selects nothing.
  const selStackMembers: TableItem[] = selectedId && selectedId.startsWith("ts-")
    ? items.filter((i) => i.stack === selectedId)
    : [];
  const selectedStack: TableItem[] | null = selStackMembers.length >= 2 ? selStackMembers : null;
  const selected: TableItem | null = selectedStack || !selectedId || selectedId.startsWith("ts-")
    ? null
    : items.find((i) => i.id === selectedId) || null;
  const selectedTop: TableItem | null = selectedStack
    ? selectedStack.reduce((a, b) => ((b.z || 0) > (a.z || 0) ? b : a))
    : null;
  const [helpOpen, setHelpOpen] = useState(false);
  // Left side panels — only one open at once (opening one closes the other)
  const [sidePanel, setSidePanel] = useState<"add" | "games" | null>("add");
  // Minigame picker: game choice only — the opponent is always the only
  // other person sitting at the table
  const [gameKind, setGameKind] = useState<GameKind>("ttt");
  const theOpponent = opponents[0] || null;
  // Bin: deletes the selection, or — with nothing selected — arms on first
  // press and clears the whole table on the confirming second press.
  const [binArmed, setBinArmed] = useState(false);
  const binTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressBin = () => {
    if (items.length === 0) return;
    // group-pick first, then the single selection (item or whole pile)
    if (multiSel.size > 0) {
      [...multiSel].forEach((id) => onRemove(id));
      setMultiSel(new Set());
      setBinArmed(false);
      return;
    }
    if (selected || selectedStack) {
      onRemove(selected ? selected.id : (selectedId as string));
      setSelectedId(null);
      setBinArmed(false);
      return;
    }
    if (!binArmed) {
      setBinArmed(true);
      if (binTimer.current) clearTimeout(binTimer.current);
      binTimer.current = setTimeout(() => setBinArmed(false), 3000);
      return;
    }
    if (binTimer.current) { clearTimeout(binTimer.current); binTimer.current = null; }
    setBinArmed(false);
    onClear();
  };

  return (
    <>
      <div className={closing ? "pp-anim-fade-out" : "pp-anim-fade-in"} style={s.backdrop} onClick={onClose} />
      <div className={closing ? "pp-anim-fade-out" : "pp-anim-fade-in"} style={s.stage}>
        {/* collapsed tabs on the board's left — + opens Add, dice opens
            Minigames. Only visible with no panel open. */}
        {sidePanel === null && (
        <div style={s.sideTabs}>
          <button
            className="pp-iconbtn"
            style={{ ...s.addTab, fontSize: 26, fontWeight: 900, color: "#fff8e7", lineHeight: 1 }}
            onClick={() => setSidePanel("add")}
            title="Add pieces"
          >
            +
          </button>
          <button
            className="pp-iconbtn"
            style={{ ...s.addTab, fontSize: 22, fontWeight: 900, color: "#fff8e7" }}
            onClick={() => setSidePanel("games")}
            title="Minigames"
          >
            ⚄
          </button>
        </div>
        )}
        {/* left floating panel with two tabs */}
        {sidePanel !== null && (
        <div className="pp-panel" style={s.panel}>
          <div style={s.panelHead}>
            <button
              type="button"
              className={"pp-choice" + (sidePanel === "add" ? " pp-choice-on" : "")}
              style={s.tabBtn}
              onClick={() => setSidePanel("add")}
            >
              Add
            </button>
            <button
              type="button"
              className={"pp-choice" + (sidePanel === "games" ? " pp-choice-on" : "")}
              style={s.tabBtn}
              onClick={() => setSidePanel("games")}
            >
              Minigames
            </button>
            <button
              className="pp-iconbtn pp-iconbtn-off"
              style={s.panelChevron}
              onClick={() => setSidePanel(null)}
              title="Hide the side panel"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M12.5 4 7 10l5.5 6" stroke="#fff8e7" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          {sidePanel === "add" ? (
          <>
          <CozyDropdown
            id="tbl-obj"
            label="Object type"
            value={objType}
            options={[
              { v: "card", l: "Cards" },
              { v: "chip", l: "Chips" },
              { v: "die", l: "Dice" },
              { v: "coin", l: "Coins" },
              { v: "boards", l: "Boards" },
              { v: "pieces", l: "Pieces" },
            ]}
            onPick={(v) => setObjType(v as "card" | "chip" | "die" | "coin" | "boards" | "pieces")}
          />

          {objType === "card" ? (
            <>
              <CozyDropdown
                id="tbl-deck"
                label="Card system"
                value={deck}
                options={DECK_OPTIONS.map((d) => ({ v: d.id, l: d.label }))}
                onPick={(v) => pickDeck(v as DeckId)}
              />
              <CozyDropdown
                id="tbl-group"
                label="How many"
                value={grouping}
                options={[
                  { v: "full", l: "Full deck" },
                  { v: "1", l: deck === "uno" ? "1 color" : "1 suit" },
                  { v: "2", l: deck === "uno" ? "2 colors" : "2 suits" },
                  { v: "3", l: deck === "uno" ? "3 colors" : "3 suits" },
                  { v: "single", l: "Single card" },
                ]}
                onPick={setGrouping}
              />

              {needSuits > 0 && (
                <div style={s.checkList}>
                  {suitOptions.map((o) => (
                    <CozyCheck
                      key={o.id}
                      checked={suits.includes(o.id)}
                      onToggle={() => toggleSuit(o.id)}
                      label={o.label}
                    />
                  ))}
                  {!suitsOk && (
                    <div style={s.warn}>Pick {needSuits} {deck === "uno" ? "colors" : "suits"}</div>
                  )}
                </div>
              )}

              {grouping === "single" && (
                <>
                  <CozyDropdown
                    id="tbl-rank"
                    label="Card rank"
                    value={rank}
                    options={rankOptions.map((r) => ({ v: r, l: r }))}
                    onPick={setRank}
                  />
                  <CozyDropdown
                    id="tbl-suit"
                    label="Card suit"
                    value={unoWildSingle ? "wild" : suit}
                    options={unoWildSingle
                      ? [{ v: "wild", l: "wild" }]
                      : suitOptions.map((o) => ({ v: o.id, l: o.label }))}
                    onPick={setSuit}
                    disabled={unoWildSingle}
                  />
                </>
              )}

              <CozyCheck
                checked={faceDown}
                onToggle={() => setFaceDown((v) => !v)}
                label="Face-down"
                title="Applies to everything spawned"
              />
              {grouping === "single" ? (
                <button className="pp-btn pp-btn-leaf" style={s.addBtn} onClick={spawnSingle}>
                  + Card
                </button>
              ) : (
                <button className="pp-btn pp-btn-leaf" style={s.addBtn} onClick={spawnGroup} disabled={!suitsOk}>
                  + {groupCount} cards
                </button>
              )}
            </>
          ) : objType === "chip" ? (
            <>
              <div style={s.swatches}>
                {CHIP_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setChipColor(c)}
                    title={c}
                    aria-label={`Chip color ${c}`}
                    style={{
                      width: 30, height: 30, borderRadius: "50%", cursor: "pointer", padding: 0,
                      background: c,
                      border: chipColor.toLowerCase() === c ? "3px solid #58a05c" : "3px solid #4a3728",
                      boxShadow: "0 2px 0 #4a3728",
                    }}
                  />
                ))}
                <label
                  title="Custom color"
                  style={{
                    width: 30, height: 30, borderRadius: "50%", cursor: "pointer",
                    border: "3px dashed #4a3728", boxShadow: "0 2px 0 #4a3728",
                    background: "conic-gradient(#ef4444,#facc15,#22c55e,#3b82f6,#a855f7,#ef4444)",
                    position: "relative", overflow: "hidden", display: "inline-block",
                  }}
                >
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(chipColor) ? chipColor : "#d95f4b"}
                    onChange={(e) => setChipColor(e.target.value)}
                    aria-label="Custom chip color"
                    style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}
                  />
                </label>
              </div>
                <button className="pp-btn pp-btn-cream" style={s.addBtn} onClick={() => onAddChip(chipColor)}>
                  + Chip
                </button>
              </>
          ) : objType === "die" ? (
            <>
              <div style={s.selHint}>
                Six-sided die — lands random, double-click to re-roll.
              </div>
              <button className="pp-btn pp-btn-cream" style={s.addBtn} onClick={() => onSpawn("die")}>
                + Die
              </button>
            </>
          ) : objType === "coin" ? (
            <>
              <div style={s.selHint}>
                Two-sided coin — double-click to flip heads / tails.
              </div>
              <button className="pp-btn pp-btn-cream" style={s.addBtn} onClick={() => onSpawn("coin")}>
                + Coin
              </button>
            </>
          ) : objType === "boards" ? (
            <>
              <CozyDropdown
                id="tbl-board-kind"
                label="Board"
                value={boardType}
                options={BOARD_VARIANTS.map((b) => ({ v: b.id, l: b.label }))}
                onPick={setBoardType}
              />
              <CozyCheck
                checked={boardPieces}
                onToggle={() => setBoardPieces((v) => !v)}
                label="With pieces on"
                title="Spawn a full setup arranged on the board"
              />
              {boardPieces && boardType === "chess" && (
                <CozyDropdown
                  id="tbl-board-army"
                  label="Army"
                  value={boardArmy}
                  options={[
                    { v: "chess", l: "Chess pieces" },
                    { v: "checkers", l: "Checkers (chips)" },
                  ]}
                  onPick={setBoardArmy}
                />
              )}
              {boardPieces && (
                <CozyCheck
                  checked={boardRed}
                  onToggle={() => setBoardRed((v) => !v)}
                  label="Red pieces"
                  title="Dark side in red instead of black"
                />
              )}
              <button className="pp-btn pp-btn-leaf" style={s.addBtn} onClick={spawnBoard}>
                {boardPieces ? "+ Board + pieces" : "+ Board"}
              </button>
            </>
          ) : (
            <>
              <div style={{ position: "relative" }}>
                <input
                  className="pp-input"
                  style={{ fontSize: 14, padding: "9px 12px" }}
                  value={pieceListOpen ? pieceQuery : pieceDefNow.label}
                  placeholder="Type to search pieces…"
                  aria-label="Piece — type to search"
                  onFocus={() => { setPieceQuery(""); setPieceListOpen(true); }}
                  onChange={(e) => { setPieceQuery(e.target.value); setPieceListOpen(true); }}
                />
                {pieceListOpen && (
                  <>
                    <span
                      style={{ position: "fixed", inset: 0, zIndex: 15 }}
                      onClick={() => setPieceListOpen(false)}
                    />
                    <span
                      className="pp-card pp-scroll"
                      style={{
                        position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 16,
                        maxHeight: 200, overflowY: "auto", padding: 6,
                        display: "flex", flexDirection: "column", gap: 2,
                      }}
                    >
                      {pieceMatches.length === 0 && (
                        <span style={{ padding: "7px 10px", fontSize: 13, fontWeight: 700, color: "#b39b72" }}>
                          No pieces match
                        </span>
                      )}
                      {pieceMatches.map(({ def, set }) => (
                        <button
                          key={`${set}:${def.id}`}
                          type="button"
                          onClick={() => pickPiece(set, def)}
                          style={{
                            background: def.id === pieceType && set === pieceSet ? "#f2c14e" : "none",
                            border: "none", borderRadius: 8, padding: "7px 10px", cursor: "pointer",
                            font: "inherit", fontSize: 14, fontWeight: 800, color: "#4a3728",
                            display: "flex", alignItems: "center", gap: 8, textAlign: "left",
                          }}
                        >
                          <span style={{ flex: 1 }}>{def.label}</span>
                          <span style={{ fontSize: 11, fontWeight: 800, color: "#b39b72" }}>
                            {set === "chess" ? "Chess" : "Fairy"}
                          </span>
                        </button>
                      ))}
                    </span>
                  </>
                )}
              </div>
              <CozyDropdown
                id="tbl-piece-color"
                label="Piece color"
                value={pieceColor}
                options={pieceDefNow.colors.map((c) => ({ v: c, l: PIECE_COLOR_LABELS[c] }))}
                onPick={setPieceColor}
              />
              <button className="pp-btn pp-btn-cream" style={s.addBtn} onClick={() => onAddPiece(pieceSet, pieceType, pieceColor)}>
                + Piece
              </button>
            </>
          )}
          </>
          ) : (
          <>
          <div style={s.selHint}>
            {theOpponent
              ? `Challenge ${theOpponent.name} — they get the usual request popup.`
              : "No one else is sitting at this table right now."}
          </div>
          <CozyDropdown
            id="tbl-game"
            label="Game"
            value={gameKind}
            options={GAME_LIST.map((g) => ({ v: g.id, l: g.label }))}
            onPick={(v) => setGameKind(v as GameKind)}
          />
          <button
            className="pp-btn pp-btn-leaf"
            style={s.addBtn}
            disabled={!theOpponent}
            onClick={() => theOpponent && onChallenge(theOpponent.id, gameKind)}
          >
            Challenge{theOpponent ? ` ${theOpponent.name}` : ""}
          </button>
          </>
        )}
        </div>
        )}

        {/* the board itself: big square, wooden like the deck tables */}
        <div style={s.boardCol}>
          <div style={s.topbar}>
            <button className="pp-iconbtn pp-iconbtn-off" style={{ width: 44, height: 44, fontSize: 22 }} onClick={onClose} title="Close table (stay seated)">←</button>
            <button
              className={"pp-iconbtn " + (helpOpen ? "pp-iconbtn-on" : "pp-iconbtn-off")}
              style={{ width: 44, height: 44, fontSize: 20, fontWeight: 900 }}
              onClick={() => setHelpOpen((o) => !o)}
              title="How this table works"
            >
              ?
            </button>
            <div style={s.titleChip}>Table {tableIndex + 1} · {items.length}</div>
            <button
              className="pp-iconbtn pp-iconbtn-off"
              style={{
                width: 44, height: 44,
                background: binArmed ? "#d95f4b" : undefined,
              }}
              onClick={pressBin}
              title={
                multiSel.size > 0 ? `Throw away the ${multiSel.size} picked cards`
                : selected ? `Throw away ${selected.kind === "card" ? cardTitle(selected) : selected.kind}`
                : selectedStack ? `Throw away the pile of ${selectedStack.length}`
                : binArmed ? "Press again to clear the whole table"
                : "Throw away the selection, or clear the whole table"
              }
            >
              <BinGlyph />
            </button>
          </div>
          <div style={s.boardWrap}>
            {binArmed && !selected && !selectedStack && multiSel.size === 0 && (
              <div style={s.armNote}>Nothing selected — press the bin again to clear the whole table</div>
            )}
            <div
              ref={surfRef}
              style={{ ...s.surface, ...(flipped ? { transform: "rotate(180deg)" } : null) }}
              onPointerDown={() => { setSelectedId(null); setMultiSel(new Set()); }}
            >
              {/* units: free pieces + piles (server z, higher on top — grabs
                  and fresh spawns land above everything else) */}
              {(() => {
                const seen = new Set<string>();
                const units: { key: string; z: number; node: React.ReactNode }[] = [];
                const piece = {
                  onPointerDown: handlePointerDown,
                  onDoubleClick: handleDoubleClick,
                };
                const lit = (id: string) =>
                  id === selectedId || multiSel.has(id) || dragPos?.id === id;
                for (const it of items) {
                  if (it.stack) {
                    if (seen.has(it.stack)) continue;
                    seen.add(it.stack);
                    const members = items.filter((e) => e.stack === it.stack);
                    // a pile of one renders as the lone card (the server
                    // frees it on the next touch — this covers the echo gap)
                    if (members.length < 2) continue;
                    const topm = members.reduce((a, b) => ((b.z || 0) > (a.z || 0) ? b : a));
                    const effTop = dragPos && members.some((m) => m.id === dragPos.id)
                      ? { ...topm, x: dragPos.x, y: dragPos.y }
                      : topm;
                    const sel = it.stack === selectedId || multiSel.has(it.stack as string) ||
                      members.some((m) => m.id === selectedId || multiSel.has(m.id));
                    units.push({
                      key: it.stack,
                      z: Math.max(...members.map((m) => m.z || 0)),
                      node: (
                        <StackView
                          members={members}
                          top={effTop}
                          selected={sel}
                          flipped={flipped}
                          onPointerDown={handlePointerDown}
                          onDoubleClick={handleDoubleClick}
                        />
                      ),
                    });
                    continue;
                  }
                  const eff = dragPos && dragPos.id === it.id
                    ? { ...it, x: dragPos.x, y: dragPos.y }
                    : it;
                  const sel = lit(it.id);
                  // boards pin under everything else
                  const sortZ = it.kind === "board" ? -1 : (it.z || 0);
                  if (it.kind === "chip") {
                    units.push({ key: it.id, z: sortZ, node: <ChipView item={eff} selected={sel} {...piece} /> });
                  } else if (it.kind === "die") {
                    units.push({ key: it.id, z: sortZ, node: <DieView item={eff} selected={sel} {...piece} /> });
                  } else if (it.kind === "coin") {
                    units.push({ key: it.id, z: sortZ, node: <CoinView item={eff} selected={sel} {...piece} /> });
                  } else if (it.kind === "board") {
                    units.push({ key: it.id, z: sortZ, node: <BoardView item={eff} selected={sel} {...piece} /> });
                  } else if (it.kind === "piece") {
                    units.push({ key: it.id, z: sortZ, node: <PieceView item={eff} selected={sel} {...piece} /> });
                  } else {
                    units.push({ key: it.id, z: sortZ, node: <CardView item={eff} selected={sel} {...piece} /> });
                  }
                }
                units.sort((a, b) => a.z - b.z);
                return units.map((u) => <span key={u.key} style={{ display: "contents" }}>{u.node}</span>);
              })()}
            </div>
            {helpOpen && (
              <div className="pp-panel" style={s.help}>
                <div style={s.helpTitle}>Around this table</div>
                <div className="pp-scroll" style={s.helpBody}>
                  <ul style={s.helpList}>
                    <li>Drag pieces to move them — everyone seated sees it live.</li>
                    <li>Click to select — actions appear in a row right under the board, the bin stays up top.</li>
                    <li>← / → or A / D — or the ⟲ ⟳ buttons below the board — rotates the selection 90°.</li>
                    <li>S shuffles the selected pile.</li>
                    <li>Shift-click cards and whole piles, then Group, to merge them in picked order.</li>
                    <li>Group spawns land stacked: drag the pile, click flips the top card, double-click takes one (it lands on top).</li>
                    <li>With a pile selected: Shuffle mixes it, Align faces every card the top card's way, Up / Down faces the whole pile.</li>
                    <li>Shift-click several cards, then Group, to stack them yourself.</li>
                    <li>Double-click a free card or coin to flip it, a die to roll it.</li>
                    <li>The other side sees the table upside down — same table, mirrored.</li>
                    <li>Boards live under everything — drag them around, pile on top freely. Chess or morabaraba, no rules attached.</li>
                    <li>The pieces menu holds chess + fairy pieces — type to search, colors follow the piece (fairy pieces never come in red).</li>
                    <li>A board with pieces spawns white on your side (red instead of black if you tick it), dark facing your opponent. Chessboards take chess pieces or checkers chips; morabaraba gets cows on every point but the middle.</li>
                    <li>The + tab opens minigames — challenge someone at this table, same as the interaction menu.</li>
                    <li>← closes the table (you stay seated) · Shift + E gets you up.</li>
                  </ul>
                </div>
                <button className="pp-btn pp-btn-cream" style={{ width: "100%", flexShrink: 0 }} onClick={() => setHelpOpen(false)}>Got it</button>
              </div>
            )}
          </div>

          {/* under-board actions — overlay row inside the board column */}
          {(() => {
          const rotatable = (it: TableItem | undefined) =>
            !!it && (it.kind === "card" || it.kind === "die" || it.kind === "piece" || it.kind === "board");
          const pickedCards = [...multiSel].reduce((n, ref) => {
            if (ref.startsWith("ts-")) {
              return n + items.filter((i) => i.stack === ref && i.kind === "card").length;
            }
            const it = items.find((i) => i.id === ref);
            return n + (it && !it.stack && it.kind === "card" ? 1 : 0);
          }, 0);
          const multiHasRotatable = [...multiSel].some((id) => {
            if (id.startsWith("ts-")) {
              return items.some((x) => x.stack === id && (x.kind === "card" || x.kind === "die" || x.kind === "piece"));
            }
            return rotatable(items.find((x) => x.id === id));
          });
          const canRotate = multiSel.size > 0
            ? multiHasRotatable
            : !!selectedStack || rotatable(selected || undefined);
          const spin = (dir: 1 | -1) =>
            rotateTargets().forEach((id) => onRotate(id, dir));
          const list: React.ReactNode[] = [];
          if (selected?.kind === "card" || selected?.kind === "coin" || selectedStack) {
            list.push(
              <button
                key="flip"
                className="pp-btn pp-btn-cream"
                style={s.actionBtn}
                onClick={() => onFlip(selected ? selected.id : (selectedTop as TableItem).id)}
                title={selected ? `Flip ${cardTitle(selected)}` : `Flip the top card (${selectedTop ? cardTitle(selectedTop) : ""})`}
              >
                Flip
              </button>
            );
          }
          if (selected?.kind === "die") {
            list.push(
              <button key="roll" className="pp-btn pp-btn-cream" style={s.actionBtn} onClick={() => onRoll(selected.id)} title={`Roll ${cardTitle(selected)}`}>
                Roll
              </button>
            );
          }
          if (canRotate) {
            list.push(
              <button key="ccw" className="pp-btn pp-btn-cream" style={s.actionBtn} onClick={() => spin(-1)} title="Rotate 90° counter-clockwise (← / A)">⟲ Rotate</button>,
              <button key="cw" className="pp-btn pp-btn-cream" style={s.actionBtn} onClick={() => spin(1)} title="Rotate 90° clockwise (→ / D)">Rotate ⟳</button>
            );
          }
          if (pickedCards >= 2) {
            list.push(
              <button
                key="group"
                className="pp-btn pp-btn-leaf"
                style={s.actionBtn}
                onClick={() => { groupRef.current([...multiSel]); setMultiSel(new Set()); }}
                title={`Stack the ${pickedCards} picked cards into one pile, in picked order`}
              >
                Group ({pickedCards})
              </button>
            );
          }
          if (selectedStack && selectedId) {
            list.push(
              <button
                key="shuffle"
                className="pp-btn pp-btn-cream"
                style={s.actionBtn}
                onClick={() => onShuffle(selectedId)}
                title={`Shuffle the pile of ${selectedStack.length}`}
              >
                Shuffle
              </button>,
              <button
                key="align"
                className="pp-btn pp-btn-cream"
                style={s.actionBtn}
                onClick={() => onAlign(selectedId)}
                title="Turn every card in the pile to face the top card's way"
              >
                Align
              </button>,
              <button
                key="up"
                className="pp-btn pp-btn-cream"
                style={s.actionBtn}
                onClick={() => onFace(selectedId, true)}
                title="Face the whole pile up"
              >
                Up
              </button>,
              <button
                key="down"
                className="pp-btn pp-btn-cream"
                style={s.actionBtn}
                onClick={() => onFace(selectedId, false)}
                title="Face the whole pile down"
              >
                Down
              </button>
            );
          }
          if (list.length === 0) return null;
          return <div style={s.actions}>{list}</div>;
        })()}
        </div>
      </div>
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(43,26,18,0.62)", zIndex: 25 },
  // no menu box — the board sits directly on the dim, options float outside
  stage: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 26,
    display: "flex", alignItems: "center", justifyContent: "center",
    gap: 14, flexWrap: "wrap", padding: 16, overflowY: "auto", pointerEvents: "none",
  },
  panel: { width: 224, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10, pointerEvents: "auto", maxHeight: "92%", padding: 18 },
  panelHead: { display: "flex", alignItems: "center", gap: 8 },
  tabBtn: { padding: "7px 8px", fontSize: 13 },
  panelTitle: { flex: 1, fontSize: 12, fontWeight: 900, color: "#6b543f", textTransform: "uppercase", letterSpacing: 0.5 },
  panelChevron: { width: 34, height: 34, flexShrink: 0 },
  sideTabs: {
    display: "flex", flexDirection: "column", gap: 10, flexShrink: 0,
    pointerEvents: "auto", alignSelf: "center",
  },
  addTab: { width: 44, height: 44, flexShrink: 0, pointerEvents: "auto" },
  checkList: { display: "flex", flexDirection: "column", gap: 2, maxHeight: 150, overflowY: "auto" },
  warn: { fontSize: 12, fontWeight: 800, color: "#d95f4b", width: "100%" },
  addBtn: { padding: "6px 14px", fontSize: 14, width: "100%" },
  swatches: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  boardCol: { position: "relative", display: "flex", flexDirection: "column", gap: 10, pointerEvents: "auto", maxWidth: "96%" },
  topbar: { display: "flex", alignItems: "center", gap: 10 },
  titleChip: {
    flex: 1, textAlign: "center",
    fontSize: 14, fontWeight: 900, color: "#faf3df", background: "#4a3728",
    borderRadius: 999, padding: "8px 16px", boxShadow: "0 3px 0 rgba(43,31,22,0.5)",
  },
  flipBtn: { padding: "8px 16px", fontSize: 14, width: "auto" },
  spinBtn: { padding: "8px 10px", fontSize: 17, width: "auto", lineHeight: 1 },
  // under-board action row — overlaid, so appearing / disappearing never
  // moves the board or the side panels. One row, board width, equal buttons.
  actions: {
    position: "absolute", top: "calc(100% + 10px)", left: 0, right: 0,
    display: "flex", flexDirection: "row", flexWrap: "nowrap", gap: 8,
    zIndex: 26, pointerEvents: "auto",
  },
  actionBtn: {
    flex: "1 1 0", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden",
    textOverflow: "ellipsis", textAlign: "center",
    padding: "8px 6px", fontSize: 13,
  },
  boardWrap: { position: "relative" },
  help: { position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 320, maxWidth: "92%", height: 400, maxHeight: "86%", zIndex: 27, padding: 18, display: "flex", flexDirection: "column", gap: 10 },
  helpBody: { flex: 1, minHeight: 0, overflowY: "auto", paddingRight: 4 },
  armNote: {
    position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", zIndex: 12,
    fontSize: 13, fontWeight: 900, color: "#faf3df", background: "#d95f4b",
    border: "3px solid #4a3728", borderRadius: 999, padding: "6px 14px",
    boxShadow: "0 3px 0 #4a3728", whiteSpace: "nowrap", maxWidth: "94%",
    overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none",
  },
  helpTitle: { fontSize: 16, fontWeight: 900, color: "#4a3728" },
  boardRank: {
    position: "absolute", top: 1, left: 3, fontSize: 10, fontWeight: 900,
    color: "rgba(74,55,40,0.7)", lineHeight: 1, pointerEvents: "none",
  },
  boardFile: {
    position: "absolute", bottom: 1, right: 4, fontSize: 10, fontWeight: 900,
    color: "rgba(74,55,40,0.7)", lineHeight: 1, pointerEvents: "none",
  },
  helpList: { margin: 0, paddingLeft: 20, fontSize: 13, fontWeight: 700, color: "#6b543f", display: "flex", flexDirection: "column", gap: 6 },
  surface: {
    position: "relative", width: "min(74vmin, 560px)", aspectRatio: "1 / 1",
    borderRadius: 12, overflow: "hidden", background: "#c99a5e",
    backgroundImage: "repeating-linear-gradient(0deg, rgba(74,55,40,0.28) 0 2px, transparent 2px 26px)",
    border: "6px solid #8a5a33", outline: "3px solid #4a3728",
    boxShadow: "0 8px 0 rgba(43,31,22,0.45), inset 0 0 0 3px rgba(43,31,22,0.25)",
    touchAction: "none", userSelect: "none",
  },
  card: {
    position: "absolute", width: 46, height: 64, transform: "translate(-50%,-50%)",
    background: "#fff8e7", border: "3px solid #4a3728", borderRadius: 8,
    boxShadow: "0 3px 0 rgba(43,31,22,0.6)", cursor: "grab", touchAction: "none",
  },
  corner: { position: "absolute", top: 2, left: 4, fontSize: 12, fontWeight: 900, lineHeight: 1.1, textAlign: "center" },
  pip: { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: 24 },
  unoCorner: { position: "absolute", top: 2, left: 5, fontSize: 11, fontWeight: 900, lineHeight: 1.1, color: "#fff8e7", textShadow: "0 1px 0 rgba(43,31,22,0.6)" },
  unoPip: { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: 20, fontWeight: 900, color: "#fff8e7", textShadow: "0 2px 0 rgba(43,31,22,0.6)" },
  cardBack: { position: "absolute", inset: 3, borderRadius: 5, background: "#3b82f6", border: "2px solid #2c5aa0" },
  // Italian face art (client/public/cards/italian/…): fills the card like
  // the printed back, pointer-transparent so grabs hit the card div.
  italianFace: {
    position: "absolute", inset: 3, width: "calc(100% - 6px)", height: "calc(100% - 6px)",
    borderRadius: 5, objectFit: "cover", pointerEvents: "none", userSelect: "none",
  },
  chip: {
    position: "absolute", width: 26, height: 26, transform: "translate(-50%,-50%)",
    borderRadius: "50%", border: "3px solid #4a3728", boxShadow: "0 2px 0 rgba(43,31,22,0.6), inset 0 0 0 3px rgba(255,255,255,0.25)",
    cursor: "grab", touchAction: "none",
  },
};

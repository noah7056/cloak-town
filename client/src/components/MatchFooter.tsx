type Props = {
  finished: boolean;
  /** we queued a rematch and wait for the other side */
  queued: boolean;
  /** incoming rematch offer waiting on our answer (null when none) */
  offerFromName: string | null;
  oppName: string;
  onRematch: () => void;
  onCancelRematch: () => void;
};

/** Shared result footer for every minigame board: rematch / queued / offer. */
export default function MatchFooter({ finished, queued, offerFromName, oppName, onRematch, onCancelRematch }: Props) {
  if (!finished) return null;
  return (
    <div className="pp-card" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      {queued ? (
        <>
          <div style={{ textAlign: "center", fontWeight: 800, fontSize: 14 }}>
            Rematch queued — waiting on <b>{oppName}</b>…
          </div>
          <button className="pp-btn pp-btn-cream" style={{ padding: "8px 12px", fontSize: 14 }} onClick={onCancelRematch}>
            Cancel rematch
          </button>
        </>
      ) : offerFromName ? (
        <>
          <div style={{ textAlign: "center", fontWeight: 800, fontSize: 14 }}>
            <b>{offerFromName}</b> wants a rematch!
          </div>
          <button className="pp-btn pp-btn-leaf" style={{ padding: "8px 12px", fontSize: 14 }} onClick={onRematch}>
            Play again
          </button>
        </>
      ) : (
        <button className="pp-btn pp-btn-wood" style={{ padding: "8px 12px", fontSize: 14 }} onClick={onRematch}>
          ↻ Rematch
        </button>
      )}
    </div>
  );
}

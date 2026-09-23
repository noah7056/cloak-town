type Props = {
  coins: number;
  tokens: number;
  closing?: boolean;
  onBuy: () => void;
  onClose: () => void;
};

function CoinGlyph({ size = 22 }: { size?: number }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: "50%", background: "#f2c14e",
      border: "2.5px solid #4a3728", display: "inline-flex", alignItems: "center",
      justifyContent: "center", flexShrink: 0,
    }}>
      <span style={{ width: size * 0.35, height: size * 0.35, borderRadius: "50%", background: "#c9952f" }} />
    </span>
  );
}

function TokenGlyph({ size = 22 }: { size?: number }) {
  return (
    <span style={{
      width: size * 0.72, height: size, borderRadius: size * 0.36, background: "#bcd8e8",
      border: "2.5px solid #4a3728", display: "inline-flex", alignItems: "center",
      justifyContent: "center", flexShrink: 0,
    }}>
      <span style={{ width: 3, height: size * 0.4, borderRadius: 2, background: "#6b8fa3" }} />
    </span>
  );
}

export default function TokenModal({ coins, tokens, closing = false, onBuy, onClose }: Props) {
  return (
    <>
      <div
        className={closing ? "pp-anim-fade-out" : "pp-anim-fade-in"}
        style={s.backdrop}
        onClick={onClose}
      />
      <div className={"pp-panel " + (closing ? "pp-anim-center-out" : "pp-anim-center-in")} style={s.modal}>
        {/* vendor marquee */}
        <div style={s.marquee}>
          <span style={s.lamp} />
          <b style={s.marqueeText}>TOKENS</b>
          <span style={s.lamp} />
          <button className="pp-btn pp-btn-cream" style={s.x} onClick={onClose} title="Close (E)">✕</button>
        </div>
        {/* the deal, shown not told */}
        <div style={s.machine}>
          <div style={s.exchange}>
            <CoinGlyph size={26} />
            <b style={s.arrow}>→</b>
            {[0, 1, 2, 3, 4].map((i) => <TokenGlyph key={i} size={22} />)}
          </div>
          <div style={s.slotRow}>
            <span style={s.slot} />
            <span style={s.slotLabel}>insert coin</span>
          </div>
        </div>
        {/* your stash */}
        <div style={s.counts}>
          <span style={s.count}><CoinGlyph size={16} /> {coins}</span>
          <span style={s.count}><TokenGlyph size={16} /> {tokens}</span>
        </div>
        <button
          className="pp-btn pp-btn-leaf"
          style={s.buy}
          disabled={coins < 1}
          onClick={onBuy}
          title={coins < 1 ? "Need a coin" : "Buy 5 tokens"}
        >
          {coins < 1 ? "Need a coin first" : "Buy 5 tokens"}
        </button>
      </div>
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  backdrop: { position: "absolute", inset: 0, background: "rgba(43,26,18,0.62)", zIndex: 30 },
  modal: {
    position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
    width: 300, maxWidth: "92%", zIndex: 31, display: "flex", flexDirection: "column", gap: 10,
    padding: 16,
  },
  marquee: {
    display: "flex", alignItems: "center", gap: 8, background: "#f2c14e",
    border: "3px solid #4a3728", borderRadius: 10, padding: "6px 10px",
  },
  marqueeText: {
    flex: 1, fontFamily: "'Courier New', monospace", fontSize: 17, letterSpacing: 3,
    color: "#4a3728",
  },
  lamp: {
    width: 9, height: 9, borderRadius: "50%", background: "#d95f4b",
    border: "2px solid #4a3728", boxShadow: "0 0 6px 2px rgba(217,95,75,0.7)", flexShrink: 0,
  },
  x: { padding: "4px 10px", fontSize: 14 },
  machine: {
    background: "#a83e2f", border: "3px solid #4a3728", borderRadius: 12,
    padding: "12px 10px 10px", display: "flex", flexDirection: "column", gap: 10,
    boxShadow: "inset 0 3px 0 rgba(255,255,255,0.15)",
  },
  exchange: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
    background: "#241a12", border: "2px solid #4a3728", borderRadius: 8, padding: "8px 4px",
  },
  arrow: { color: "#faf3df", fontSize: 16, margin: "0 2px" },
  slotRow: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8 },
  slot: {
    width: 26, height: 8, borderRadius: 4, background: "#241a12",
    border: "2px solid #4a3728",
  },
  slotLabel: { color: "#f7ead0", fontSize: 12, fontWeight: 800, opacity: 0.85 },
  counts: { display: "flex", gap: 24, justifyContent: "center" },
  count: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 900, color: "#4a3728" },
  buy: { padding: "10px 14px", fontSize: 15 },
};

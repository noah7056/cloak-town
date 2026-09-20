import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cropImgStyle, type Crop } from "../net/profileMeta";
import { downloadUrl } from "../net/gallery";

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, v + amt));
  const r = c((n >> 16) & 255), g = c((n >> 8) & 255), b = c(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export type CardProfile = {
  display_name: string;
  username: string | null;
  bio: string;
  avatar_url?: string;
  avatar_crop?: Crop | null;
  country?: string;
  languages?: string[];
  card_color?: string;
  card_color2?: string;
  card_text?: string;
};

/**
 * Shared profile card: round picture (zoom/focus aware), names,
 * country + languages, always-on dotted divider, bio. Sits on the
 * player's chosen card color (default cream).
 */
export default function ProfileCard({
  p,
  avatarSize = 64,
  actionRow,
  pinned,
}: {
  p: CardProfile;
  avatarSize?: number;
  actionRow?: React.ReactNode;
  /** pinned gallery photos (max 3) — tap to view big */
  pinned?: { url: string }[];
}) {
  const [pinIdx, setPinIdx] = useState<number | null>(null);
  const pins = (pinned || []).filter((ph) => ph.url).slice(0, 3);
  useEffect(() => {
    if (pinIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinIdx(null);
      else if (e.key === "ArrowLeft") setPinIdx((i) => (i === null ? null : (i + pins.length - 1) % pins.length));
      else if (e.key === "ArrowRight") setPinIdx((i) => (i === null ? null : (i + 1) % pins.length));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinIdx, pins.length]);
  const langs = (p.languages || []).filter(Boolean).slice(0, 2);
  // background: solid tint, or a soft diagonal fade when both colors set
  const bg = p.card_color && p.card_color2
    ? `linear-gradient(135deg, ${p.card_color}, ${p.card_color2})`
    : p.card_color || undefined;
  const border = p.card_color ? shade(p.card_color, -55) : undefined;
  const ink = p.card_text || "#4a3728";
  const sub = p.card_text || "#4a3728";
  return (
    <div
      className="pp-card"
      style={{
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        background: bg,
        // same 2px outline as every pp-card, tinted with the card color
        borderColor: border,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {p.avatar_url
          ? (
            <span style={{
              width: avatarSize, height: avatarSize, borderRadius: "50%", overflow: "hidden",
              border: "3px solid #4a3728", flexShrink: 0, display: "inline-block",
            }}>
              <img src={p.avatar_url} alt="" style={cropImgStyle(p.avatar_crop)} />
            </span>
          )
          : (
            <span style={{
              width: avatarSize, height: avatarSize, borderRadius: "50%", background: "#d9c193",
              border: "3px solid #4a3728", display: "inline-flex", alignItems: "center",
              justifyContent: "center", fontSize: avatarSize * 0.4, fontWeight: 900,
              color: "#6b543f", flexShrink: 0,
            }}>
              {(p.display_name || p.username || "?").slice(0, 1).toUpperCase()}
            </span>
          )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: ink }}>
            {p.display_name || "cloakling"}
          </div>
          {p.username ? <div style={{ fontSize: 12, fontWeight: 700, color: ink }}>@{p.username}</div> : null}
        </div>
      </div>
      {p.country || langs.length > 0 ? (
        <div style={{ fontSize: 12, fontWeight: 800, color: sub, lineHeight: 1.45 }}>
          {p.country ? <div>{p.country}</div> : null}
          {langs.length > 0 ? <div>{langs.join(" · ")}</div> : null}
        </div>
      ) : null}
      <div style={{ borderTop: `2px dotted ${ink}`, paddingTop: 8, fontSize: 13, fontWeight: 700, color: sub, whiteSpace: "pre-line", overflowWrap: "anywhere", lineHeight: 1.45 }}>
        {p.bio || "No description yet."}
      </div>
      {pins.length > 0 && (
        <div style={{ display: "flex", gap: 0, justifyContent: "center", paddingTop: 4 }}>
          {pins.map((ph, i) => (
            <button
              key={i}
              onClick={() => setPinIdx(i)}
              title="View bigger"
              style={{
                background: "none", border: "none", padding: 0, cursor: "zoom-in",
                transform: `rotate(${(i - 1) * 6}deg)`, margin: "0 -5px",
              }}
            >
              <img
                src={ph.url}
                alt=""
                style={{
                  width: 62, height: 62, objectFit: "cover", display: "block",
                  background: "#fff8e7", border: "3px solid #fff8e7", outline: "2px solid #4a3728",
                  borderRadius: 4, boxShadow: "0 3px 0 rgba(43,26,18,0.35)",
                }}
              />
            </button>
          ))}
        </div>
      )}
      {actionRow}
      {pinIdx !== null && pins[pinIdx] && createPortal(
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 70,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: 16,
            background: "rgba(30,18,12,0.8)",
          }}
          onClick={() => setPinIdx(null)}
        >
          <button
            className="pp-iconbtn pp-iconbtn-off" style={{ width: 40, height: 40, fontSize: 18, flexShrink: 0 }}
            onClick={(e) => { e.stopPropagation(); setPinIdx((i) => (i === null ? null : (i + pins.length - 1) % pins.length)); }}
            title="Previous"
          >
            ‹
          </button>
          <div
            className="pp-panel"
            style={{ maxWidth: "min(560px, 86vw)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={pins[pinIdx].url} alt=""
              style={{ width: "100%", maxHeight: "62vh", objectFit: "contain", borderRadius: 8, background: "#2b1f16" }}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 800, color: "#6b543f" }}>
                {pinIdx + 1} / {pins.length}
              </span>
              <button
                className="pp-btn pp-btn-wood" style={{ padding: "6px 14px", fontSize: 13 }}
                onClick={() => void downloadUrl(pins[pinIdx].url, `cloak-town-photo-${pinIdx + 1}.jpg`)}
              >
                Download
              </button>
              <button
                className="pp-btn pp-btn-cream" style={{ padding: "6px 14px", fontSize: 13 }}
                onClick={() => setPinIdx(null)}
              >
                Close
              </button>
            </div>
          </div>
          <button
            className="pp-iconbtn pp-iconbtn-off" style={{ width: 40, height: 40, fontSize: 18, flexShrink: 0 }}
            onClick={(e) => { e.stopPropagation(); setPinIdx((i) => (i === null ? null : (i + 1) % pins.length)); }}
            title="Next"
          >
            ›
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

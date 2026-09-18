import { useEffect, useRef, useState } from "react";

/** One frozen frame + where the photographer stood in it (device pixels). */
export type CamShot = { frame: HTMLCanvasElement; px: number; py: number; n: number };

export type CamFilters = {
  brightness: number; // 40..160 (%)
  contrast: number;   // 40..160 (%)
  saturation: number; // 0..200 (%)
  hue: number;        // -180..180 (deg tint shift)
  bw: boolean;        // black & white
  zoom: number;       // 1..3
};

export const CAM_DEFAULTS: CamFilters = {
  brightness: 100, contrast: 100, saturation: 100, hue: 0, bw: false, zoom: 1,
};

/** Square render of the shot, cropped around the player, filters applied. */
export function renderShot(shot: CamShot, f: CamFilters, size: number): HTMLCanvasElement | null {
  const src = shot.frame;
  if (!src.width || !src.height || size <= 0) return null;
  const base = Math.min(src.width, src.height, 900);
  const side = Math.max(24, base / Math.max(1, f.zoom));
  const cx = Math.max(side / 2, Math.min(src.width - side / 2, shot.px));
  const cy = Math.max(side / 2, Math.min(src.height - side / 2, shot.py));
  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  const filter =
    "brightness(" + (f.brightness / 100) + ")" +
    " contrast(" + (f.contrast / 100) + ")" +
    " saturate(" + (f.saturation / 100) + ")" +
    " hue-rotate(" + f.hue + "deg)" +
    (f.bw ? " grayscale(1)" : "");
  try {
    (ctx as CanvasRenderingContext2D & { filter?: string }).filter = filter;
  } catch {
    /* older canvas: plain render, no filters */
  }
  ctx.drawImage(src, cx - side / 2, cy - side / 2, side, side, 0, 0, size, size);
  return out;
}

/** Small jpeg for the shared in-game wall (kept tiny for socket travel). */
export function shotToShareJpeg(shot: CamShot, f: CamFilters): string | null {
  const c = renderShot(shot, f, 256);
  return c ? c.toDataURL("image/jpeg", 0.72) : null;
}

type NumKey = "brightness" | "contrast" | "saturation" | "hue" | "zoom";

export default function CameraModal({ shot, onClose, onSaveInGame }: {
  shot: CamShot;
  onClose: () => void;
  onSaveInGame: (jpeg: string, caption: string) => void;
}) {
  const [f, setF] = useState<CamFilters>(CAM_DEFAULTS);
  const [caption, setCaption] = useState("Cloak Town");
  const [editingCaption, setEditingCaption] = useState(false);
  const [saved, setSaved] = useState(false);
  const previewRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setSaved(false);
  }, [shot.n]);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const rendered = renderShot(shot, f, 360);
    if (!rendered) return;
    el.width = 360;
    el.height = 360;
    el.getContext("2d")?.drawImage(rendered, 0, 0);
  }, [shot, f]);

  const setNum = (k: NumKey) => (v: number) =>
    setF((prev) => ({ ...prev, [k]: v }));

  const download = () => {
    const el = previewRef.current;
    if (!el) return;
    const a = document.createElement("a");
    a.href = el.toDataURL("image/png");
    a.download = "cloak-town-polaroid.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const saveInGame = () => {
    const jpeg = shotToShareJpeg(shot, f);
    if (!jpeg) return;
    onSaveInGame(jpeg, caption.trim().slice(0, 24) || "Cloak Town");
    setSaved(true);
  };

  const slider = (label: string, k: NumKey, min: number, max: number, step: number, unit: string) => {
    const isDefault = f[k] === CAM_DEFAULTS[k];
    return (
      <label key={k} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, fontWeight: 800 }}>
        <span style={{ width: 88, flexShrink: 0 }}>{label}</span>
        <input type="range" className="pp-range" min={min} max={max} step={step}
          value={f[k]} onChange={(e) => setNum(k)(Number(e.target.value))} />
        <span style={{ width: 58, textAlign: "right", color: "#6b543f" }}>{f[k]}{unit}</span>
        <button
          onClick={(e) => { e.preventDefault(); setNum(k)(CAM_DEFAULTS[k]); }}
          disabled={isDefault}
          title={"Reset " + label.toLowerCase()}
          style={{
            width: 26, height: 26, borderRadius: "50%", flexShrink: 0, padding: 0,
            background: "#fff8e7", border: "2.5px solid #4a3728", color: "#4a3728",
            fontSize: 14, fontWeight: 900, fontFamily: "inherit", lineHeight: 1,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            opacity: isDefault ? 0.35 : 1, cursor: isDefault ? "default" : "pointer",
          }}
        >
          ↻
        </button>
      </label>
    );
  };

  const shownCaption = caption.trim() || "Cloak Town";
  const commitCaption = () => {
    setCaption((c) => c.trim().slice(0, 24) || "Cloak Town");
    setEditingCaption(false);
  };

  return (
    <>
      <div style={s.backdrop} onClick={onClose} />
      <div className="pp-panel pp-scroll" style={s.modal}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 21, fontWeight: 900 }}>Camera</h2>
          <button className="pp-iconbtn pp-iconbtn-off" style={{ width: 38, height: 38, fontSize: 15 }} onClick={onClose} title="Close">✕</button>
        </div>
        {/* polaroid-style preview: white frame, thick bottom, caption.
            The caption itself is the editor — pen (or click) to scribble. */}
        <div style={{ alignSelf: "center", background: "#fff8e7", border: "3px solid #4a3728", borderRadius: 6, padding: 12, paddingBottom: 10, boxShadow: "0 4px 0 #4a3728" }}>
          <canvas ref={previewRef} style={{ width: 300, height: 300, display: "block", borderRadius: 2, background: "#d9c193" }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, paddingTop: 8 }}>
            {editingCaption ? (
              <input
                autoFocus
                value={caption}
                onChange={(e) => setCaption(e.target.value.slice(0, 24))}
                onBlur={commitCaption}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                maxLength={24}
                placeholder="Cloak Town"
                style={{
                  fontFamily: "inherit", fontWeight: 900, fontSize: 15, fontStyle: "italic",
                  color: "#4a3728", textAlign: "center", background: "transparent",
                  border: "none", borderBottom: "3px solid #4e8d7c", outline: "none",
                  width: "100%", padding: "0 2px",
                }}
              />
            ) : (
              <>
                <span
                  onClick={() => setEditingCaption(true)}
                  title="Edit caption"
                  style={{ fontWeight: 900, fontSize: 15, color: "#4a3728", fontStyle: "italic", cursor: "text" }}
                >
                  {shownCaption}
                </span>
                <button
                  onClick={() => setEditingCaption(true)}
                  title="Edit caption"
                  style={{ background: "none", border: "none", padding: 2, cursor: "pointer", display: "inline-flex" }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24">
                    <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19l-4 1z" fill="#4e8d7c" stroke="#4a3728" strokeWidth="1.6" strokeLinejoin="round" />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {slider("Brightness", "brightness", 40, 160, 1, "%")}
          {slider("Contrast", "contrast", 40, 160, 1, "%")}
          {slider("Saturation", "saturation", 0, 200, 1, "%")}
          {slider("Tint", "hue", -180, 180, 1, "")}
          {slider("Zoom", "zoom", 1, 3, 0.1, "x")}
          <div style={{ display: "flex", gap: 8 }}>
            <button className={"pp-choice" + (f.bw ? " pp-choice-on" : "")} onClick={() => setF((p) => ({ ...p, bw: !p.bw }))}>
              Black & white: {f.bw ? "on" : "off"}
            </button>
            <button className="pp-choice" style={{ flex: 0, paddingLeft: 18, paddingRight: 18 }} onClick={() => setF(CAM_DEFAULTS)} title="Reset all effects">
              Reset
            </button>
          </div>
        </div>
        {saved && (
          <div style={{ fontSize: 13, fontWeight: 800, color: "#3e7d46", textAlign: "center" }}>
            It is in your hands now — close this and press Interact to set it down.
          </div>
        )}
        <button className="pp-btn pp-btn-wood" onClick={download} title="Save a PNG file to your PC">
          Save to PC
        </button>
        <button className="pp-btn pp-btn-leaf" onClick={saveInGame} title="Hold it in game — place it with Interact">
          Save in game
        </button>
      </div>
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(43,26,18,0.62)", zIndex: 30 },
  modal: { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 400, maxWidth: "94%", maxHeight: "94%", overflowY: "auto", padding: 22, zIndex: 31, display: "flex", flexDirection: "column", gap: 12 },
};

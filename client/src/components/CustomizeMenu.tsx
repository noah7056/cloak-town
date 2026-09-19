import { useEffect, useMemo, useRef, useState } from "react";
import AvatarPreview from "./AvatarPreview";
import {
  ACCESSORIES, BACKS, BOOT_COLORS, CLOAK_COLORS, DEFAULT_AVATAR, EYES,
  FACE_DECOS, GLASSES_OPTS, HATS, HAT_COLORS, PATTERNS, PETS,
  PET_ACCENTS, PET_COLORS, SKIN_TONES,
  TRIM_COLORS, decodeAvatar, encodeAvatar, randomAvatar,
  type Avatar,
} from "../game/avatar";

type Props = {
  initial: Avatar;
  name: string;
  onSave: (a: Avatar) => void;
  onCancel: () => void;
  /** render just the panel (for overlaying on another screen) instead of a full page */
  overlay?: boolean;
  /** incremented by the parent to request a close (e.g. backdrop click) —
   *  routed through the same back/confirm flow as the back arrow */
  closeSignal?: number;
};

function Swatches({ colors, value, onPick }: { colors: string[]; value: string; onPick: (c: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {colors.map((c) => (
        <button
          key={c}
          onClick={() => onPick(c)}
          title={c}
          aria-label={`color ${c}`}
          style={{
            width: 30, height: 30, borderRadius: "50%", background: c, padding: 0,
            border: "3px solid #4a3728", cursor: "pointer",
            outline: value.toLowerCase() === c.toLowerCase() ? "3px solid #58a05c" : "none",
            outlineOffset: 2, boxShadow: "0 3px 0 #4a3728",
          }}
        />
      ))}
      <label
        title="Custom color"
        style={{
          width: 30, height: 30, borderRadius: "50%", cursor: "pointer",
          border: "3px dashed #4a3728", boxShadow: "0 3px 0 #4a3728",
          background: `conic-gradient(#ef4444,#facc15,#22c55e,#3b82f6,#a855f7,#ef4444)`,
          position: "relative", overflow: "hidden", display: "inline-block",
        }}
      >
        <input
          type="color"
          value={value}
          onChange={(e) => onPick(e.target.value)}
          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}
        />
      </label>
    </div>
  );
}

function OptionGrid<T extends string>({
  options, value, onPick,
}: {
  options: { id: T; label: string; icon?: string }[];
  value: T;
  onPick: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            onClick={() => onPick(o.id)}
            className={"pp-choice" + (on ? " pp-choice-on" : "")}
            style={{ flex: "1 1 auto", minWidth: 86, display: "flex", gap: 6, alignItems: "center", justifyContent: "center" }}
          >
            {o.icon ? <span style={{ fontSize: 16 }}>{o.icon}</span> : null}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="pp-section-title">{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>{children}</div>
    </div>
  );
}

const DIRS = [
  { id: "down", label: "↓" },
  { id: "up", label: "↑" },
  { id: "left", label: "←" },
  { id: "right", label: "→" },
];

export default function CustomizeMenu({ initial, name, onSave, onCancel, overlay = false, closeSignal = 0 }: Props) {
  const [draft, setDraft] = useState<Avatar>({ ...initial });
  const [dir, setDir] = useState("down");
  const [walking, setWalking] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [shareCode, setShareCode] = useState("");
  const [shareMsg, setShareMsg] = useState("");
  const set = <K extends keyof Avatar>(k: K, v: Avatar[K]) => {
    setDraft((d) => ({ ...d, [k]: v, ...(k === "color" ? {} : {}) }));
    setConfirmDiscard(false);
  };
  const setPet = <K extends keyof Avatar["pet"]>(k: K, v: Avatar["pet"][K]) => {
    setDraft((d) => ({ ...d, pet: { ...d.pet, [k]: v } }));
    setConfirmDiscard(false);
  };

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initial), [draft, initial]);
  const lookCode = useMemo(() => encodeAvatar(draft), [draft]);

  const doRandom = () => setDraft(randomAvatar(draft));
  const doReset = () => setDraft({
    ...DEFAULT_AVATAR,
    color: draft.color,
    gradient: draft.gradient,
    cloakEnd: draft.cloakEnd,
  });

  const tryBack = () => {
    if (!dirty) { onCancel(); return; }
    if (confirmDiscard) onCancel();
    else setConfirmDiscard(true);
  };
  // Backdrop clicks from the parent take the same path as the back arrow.
  // Value-compare (not a first-render flag) so StrictMode's double-effect
  // invocation can't mistake a mount for a close request.
  const lastSignal = useRef(closeSignal);
  useEffect(() => {
    if (lastSignal.current === closeSignal) return;
    lastSignal.current = closeSignal;
    tryBack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeSignal]);

  const importCode = () => {
    const got = decodeAvatar(shareCode);
    if (got) {
      setDraft(got);
      setShareMsg("Look imported!");
    } else {
      setShareMsg("That code didn't parse — check for typos.");
    }
  };

  const panel = (
      <div className="pp-panel" style={{ width: "100%", maxWidth: 980, padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
        {/* top bar: back arrow / title / save */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="pp-iconbtn pp-iconbtn-off" style={{ width: 44, height: 44, fontSize: 22 }} onClick={tryBack} title={dirty ? "Back without saving" : "Back"}>
            ←
          </button>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>Customize cloakling</h2>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#6b543f" }}>
              {dirty ? "● unsaved changes — Save to keep them" : "all changes saved"}
            </div>
          </div>
          <button className="pp-btn pp-btn-cream" onClick={doRandom} title="Surprise me">🎲 Random</button>
          <button className="pp-btn pp-btn-cream" onClick={doReset} title="Clear hats, glasses and extras (keeps cloak color)">Reset extras</button>
          <button className="pp-btn pp-btn-leaf" onClick={() => onSave(draft)} title="Save and go back">Save ✓</button>
        </div>

        {confirmDiscard && (
          <div className="pp-card" style={{ padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", borderColor: "#d95f4b" }}>
            <span style={{ flex: 1, fontWeight: 800, fontSize: 14 }}>Discard unsaved changes and go back?</span>
            <button className="pp-btn pp-btn-danger" style={{ padding: "7px 14px", fontSize: 14 }} onClick={onCancel}>Discard</button>
            <button className="pp-btn pp-btn-cream" style={{ padding: "7px 14px", fontSize: 14 }} onClick={() => setConfirmDiscard(false)}>Keep editing</button>
          </div>
        )}

        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
          {/* live preview column */}
          <div style={{ flex: "0 0 300px", display: "flex", flexDirection: "column", gap: 10, alignItems: "center", margin: "0 auto" }}>
            <div className="pp-card" style={{ padding: 12, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <AvatarPreview avatar={draft} name={name} size={240} dir={dir} walking={walking} />
              <div style={{ display: "flex", gap: 6 }}>
                {DIRS.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setDir(d.id)}
                    className={"pp-choice" + (dir === d.id ? " pp-choice-on" : "")}
                    style={{ flex: 0, minWidth: 52, fontSize: 16, padding: "6px 10px" }}
                    title={`Face ${d.id}`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <button className={"pp-choice" + (walking ? " pp-choice-on" : "")} onClick={() => setWalking((w) => !w)} style={{ width: "100%" }}>
                {walking ? "🚶 walking preview: on" : "🧍 idle preview — tap to walk"}
              </button>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#6b543f", textAlign: "center" }}>
                WYSIWYG — this is exactly how you'll look in-game.
              </div>
            </div>
            <div className="pp-card" style={{ padding: 12, width: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 8 }}>
              <b style={{ fontSize: 14 }}>Share this look</b>
              <div style={{ display: "flex", gap: 6 }}>
                <input className="pp-input" style={{ margin: 0, fontSize: 12, padding: "8px 10px" }} value={lookCode} readOnly onFocus={(e) => e.target.select()} title="Your look code" />
                <button
                  className="pp-btn pp-btn-wood" style={{ padding: "8px 12px", fontSize: 13 }}
                  onClick={() => { navigator.clipboard?.writeText(lookCode); setShareMsg("Look code copied!"); }}
                >
                  Copy
                </button>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  className="pp-input" style={{ margin: 0, fontSize: 13 }} placeholder="Paste a friend's code…"
                  value={shareCode} onChange={(e) => { setShareCode(e.target.value); setShareMsg(""); }}
                />
                <button className="pp-btn pp-btn-cream" style={{ padding: "8px 12px", fontSize: 13 }} onClick={importCode}>Use</button>
              </div>
              {shareMsg && <span style={{ fontSize: 12, fontWeight: 800, color: "#4e8d7c" }}>{shareMsg}</span>}
            </div>
          </div>

          {/* controls column */}
          <div className="pp-scroll" style={{ flex: "1 1 420px", minWidth: 300, maxHeight: 560, overflowY: "auto", overflowX: "hidden", paddingRight: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            <Section title="Cloak">
              <span className="pp-label" style={{ margin: 0 }}>Cloak color</span>
              <Swatches colors={CLOAK_COLORS} value={draft.color} onPick={(c) => set("color", c)} />
              <span className="pp-label" style={{ margin: 0 }}>Shade</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className={"pp-choice" + (!draft.gradient ? " pp-choice-on" : "")} onClick={() => set("gradient", false)}>Solid</button>
                <button className={"pp-choice" + (draft.gradient ? " pp-choice-on" : "")} onClick={() => set("gradient", true)}>Gradient ↓</button>
              </div>
              {draft.gradient && (
                <>
                  <span className="pp-label" style={{ margin: 0 }}>Fades into (hem)</span>
                  <Swatches colors={CLOAK_COLORS} value={draft.cloakEnd} onPick={(c) => set("cloakEnd", c)} />
                </>
              )}
              <span className="pp-label" style={{ margin: 0 }}>Trim & hem</span>
              <Swatches colors={TRIM_COLORS} value={draft.trim} onPick={(c) => set("trim", c)} />
              <span className="pp-label" style={{ margin: 0 }}>Cloak pattern</span>
              <OptionGrid options={PATTERNS} value={draft.pattern} onPick={(v) => set("pattern", v)} />
            </Section>

            <Section title="Wings & tails">
              <OptionGrid options={BACKS} value={draft.back} onPick={(v) => set("back", v)} />
              {draft.back !== "none" && (
                <>
                  <span className="pp-label" style={{ margin: 0 }}>Wing / cape / tail color</span>
                  <Swatches colors={HAT_COLORS} value={draft.backColor} onPick={(c) => set("backColor", c)} />
                </>
              )}
            </Section>

            <Section title="Sidekick pet">
              <OptionGrid options={PETS} value={draft.pet.kind} onPick={(v) => setPet("kind", v)} />
              {draft.pet.kind !== "none" && (
                <>
                  <span className="pp-label" style={{ margin: 0 }}>Pet main color</span>
                  <Swatches colors={PET_COLORS} value={draft.pet.color} onPick={(c) => setPet("color", c)} />
                  <span className="pp-label" style={{ margin: 0 }}>Pet accent (trim / belly / leaf)</span>
                  <Swatches colors={PET_ACCENTS} value={draft.pet.accent} onPick={(c) => setPet("accent", c)} />
                  <span className="pp-label" style={{ margin: 0 }}>Pet eyes</span>
                  <OptionGrid options={EYES} value={draft.pet.eyes} onPick={(v) => setPet("eyes", v)} />
                  {draft.pet.kind === "blob" && (
                    <>
                      <span className="pp-label" style={{ margin: 0 }}>Mini-me boots</span>
                      <Swatches colors={BOOT_COLORS} value={draft.pet.boots} onPick={(c) => setPet("boots", c)} />
                    </>
                  )}
                  <span className="pp-label" style={{ margin: 0 }}>Pet cheeks</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className={"pp-choice" + (!draft.pet.blush ? " pp-choice-on" : "")} onClick={() => setPet("blush", false)}>Plain</button>
                    <button className={"pp-choice" + (draft.pet.blush ? " pp-choice-on" : "")} onClick={() => setPet("blush", true)}>Blush</button>
                  </div>
                </>
              )}
            </Section>

            <Section title="Headwear">
              <OptionGrid options={HATS} value={draft.hat} onPick={(v) => set("hat", v)} />
              {draft.hat !== "none" && (
                <>
                  <span className="pp-label" style={{ margin: 0 }}>Hat color</span>
                  <Swatches colors={HAT_COLORS} value={draft.hatColor} onPick={(c) => set("hatColor", c)} />
                </>
              )}
            </Section>

            <Section title="Face">
              <span className="pp-label" style={{ margin: 0 }}>Eyes</span>
              <OptionGrid options={EYES} value={draft.eyeStyle} onPick={(v) => set("eyeStyle", v)} />
              <span className="pp-label" style={{ margin: 0 }}>Face tone</span>
              <Swatches colors={SKIN_TONES} value={draft.skin} onPick={(c) => set("skin", c)} />
              <span className="pp-label" style={{ margin: 0 }}>Cheeks & marks</span>
              <OptionGrid options={FACE_DECOS} value={draft.faceDeco} onPick={(v) => set("faceDeco", v)} />
              <span className="pp-label" style={{ margin: 0 }}>Glasses</span>
              <OptionGrid options={GLASSES_OPTS} value={draft.glasses} onPick={(v) => set("glasses", v)} />
            </Section>

            <Section title="Outfit extras">
              <span className="pp-label" style={{ margin: 0 }}>Neck & chest</span>
              <OptionGrid options={ACCESSORIES} value={draft.accessory} onPick={(v) => set("accessory", v)} />
              <span className="pp-label" style={{ margin: 0 }}>Boots</span>
              <Swatches colors={BOOT_COLORS} value={draft.boots} onPick={(c) => set("boots", c)} />
            </Section>
          </div>
        </div>
      </div>
  );
  if (overlay) return panel;
  return (
    <div className="pp-lobby-bg" style={{ minHeight: "100%", boxSizing: "border-box", padding: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {panel}
    </div>
  );
}

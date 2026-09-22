import { useEffect, useState } from "react";
import { DEFAULT_BINDS, BIND_ROWS, isForbiddenKey, prettyKey, type Binds } from "../game/binds";
import { useVoice, type VoiceMode } from "../voice/useVoice";

type VoiceSel = Pick<
  ReturnType<typeof useVoice>,
  "devices" | "loadDevices" | "playTest" | "resetMesh" | "peersLinked" | "diag"
>;

export type SettingsCommit = {
  binds: Binds;
  dust: boolean;
  debugMode: boolean;
  showColliders: boolean;
  uiScale: number;
  showBuddy: boolean;
  showHints: boolean;
  micDeviceId: string;
  voiceMode: VoiceMode;
  echoCancellation: boolean;
};

type Props = {
  onClose: () => void;
  closing?: boolean;
  binds: Binds;
  dust: boolean;
  debugMode: boolean;
  showColliders: boolean;
  uiScale: number;
  showBuddy: boolean;
  showHints: boolean;
  micDeviceId: string;
  voiceMode: VoiceMode;
  echoCancellation: boolean;
  voice: VoiceSel;
  commitSettings: (s: SettingsCommit) => void;
};

type Tab = "how" | "iface" | "keys" | "voice";

const INFO_SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Moving around",
    rows: [
      ["Options menu", "Pause button (top-left) or ESC"],
      ["Hide / show chat", "Tab on the right edge of the screen"],
    ],
  },
  {
    title: "Chatting",
    rows: [
      ["Send a message", "Type + Enter"],
      ["Unread badge", "Count on the chat tab while it's hidden"],
    ],
  },
  {
    title: "Voice chat",
    rows: [
      ["Mic on / off", "Mic button (top-left) or your voice key"],
      ["Modes", "Toggle, or push-to-talk while held — mic + mode in the Voice tab"],
      ["Range", "Proximity based — louder when you're close"],
    ],
  },
  {
    title: "Servers",
    rows: [
      ["Public", "Listed in the browser — click to join"],
      ["Private", "Code-only, plus a password if the host set one"],
      ["Invite code", "Copy yours from the pause menu"],
    ],
  },
  {
    title: "Tips",
    rows: [
      ["Mini-games", "Press Interact near a friend to challenge them"],
      ["Voice stuck?", "Reconnect voice in Settings → Voice"],
      ["Coins", "Walk over coins (+1), win games (+1). E near a friend → tip 1 coin. E at the plaza fountain → toss one in for luck. Per-server: rejoining keeps them"],
      ["Football", "Walk onto the pitch → E opens/closes the match panel. Queue 2–8 (even), West vs East, first to 5, winners get +3 coins each. Sit in the pitch stands mid-game to spectate"],
      ["TV couch", "E opens/closes the TV from the couch · Shift+E gets you up (wiggling won't)"],
      ["Deck tables", "Sit at a deck table → E opens the tabletop (cards, chips, dice, coins, chessboards + pieces — free play, shared live) · Shift+E gets you up (wiggling won't) · stairs cost a little speed"],
      ["Race", "Grab a color-coded joystick by the race track (replaces the old hut) → WASD drives your car, not you. E opens/closes the race menu, Shift+E sets the stick down: solo or up to 3, one counterclockwise lap. Winner of a 2–3 driver race gets +1 coin"],
      ["Debug", "Shift+P overlay, Shift+O colliders"],
      ["Careful", "Ctrl+W closes the tab (browser rule) — < crouches safely"],
    ],
  },
];

const TABS: { id: Tab; label: string }[] = [
  { id: "iface", label: "Interface" },
  { id: "keys", label: "Keybinds" },
  { id: "voice", label: "Voice" },
  { id: "how", label: "How to" },
];

/** Tabbed settings with draft semantics: everything edits a draft, ✓
 *  (top-right) commits + closes, ✕ closes without saving. Shared by the
 *  lobby gear button and the in-game pause menu. Header + tabs stay fixed;
 *  only the tab body scrolls. */
export default function SettingsModal({
  onClose, closing = false, binds, dust, debugMode, showColliders, uiScale,
  showBuddy, showHints, micDeviceId, voiceMode, echoCancellation, voice, commitSettings,
}: Props) {
  const [tab, setTab] = useState<Tab>("iface");
  // Drafts — re-initialized every open since the modal unmounts on close.
  const [dBinds, setDBinds] = useState<Binds>(binds);
  const [dDust, setDDust] = useState(dust);
  const [dDebug, setDDebug] = useState(debugMode);
  const [dColl, setDColl] = useState(showColliders);
  const [dScale, setDScale] = useState(uiScale);
  const [dBuddy, setDBuddy] = useState(showBuddy);
  const [dHints, setDHints] = useState(showHints);
  const [dMic, setDMic] = useState(micDeviceId);
  const [dMode, setDMode] = useState<VoiceMode>(voiceMode);
  const [dEcho, setDEcho] = useState(echoCancellation);
  const [bindingAction, setBindingAction] = useState<keyof Binds | null>(null);

  // Mic list for the Voice tab.
  useEffect(() => {
    void voice.loadDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keybind capture: click a row, press the replacement. ESC cancels;
  // Ctrl/⌘/Alt chords, Tab and Control itself are never accepted.
  useEffect(() => {
    if (!bindingAction) return;
    const action = bindingAction;
    const h = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const k = e.key.toLowerCase();
      if (e.key === "Escape") {
        setBindingAction(null);
        return;
      }
      const chorded =
        (e.ctrlKey && k !== "control") || (e.metaKey && k !== "meta") || (e.altKey && k !== "alt");
      if (chorded || isForbiddenKey(k)) return; // ignore, keep listening
      setDBinds((b) => {
        const next = { ...b, [action]: k } as Binds;
        for (const key of Object.keys(next) as (keyof Binds)[]) {
          if (key !== action && next[key] === k) next[key] = b[action]; // swap duplicates
        }
        return next;
      });
      setBindingAction(null);
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [bindingAction]);

  const save = () => {
    commitSettings({
      binds: dBinds, dust: dDust, debugMode: dDebug, showColliders: dColl,
      uiScale: dScale, showBuddy: dBuddy, showHints: dHints,
      micDeviceId: dMic, voiceMode: dMode, echoCancellation: dEcho,
    });
    onClose();
  };

  const howSections = [
    {
      title: "Moving around",
      rows: [
        ["Walk", `${prettyKey(dBinds.up)} ${prettyKey(dBinds.left)} ${prettyKey(dBinds.down)} ${prettyKey(dBinds.right)} or arrow keys`],
        ["Run", `Hold ${prettyKey(dBinds.run)} (faster, with dust)`],
        ["Jump", `${prettyKey(dBinds.jump)} — steerable mid-air`],
        ["Crouch", `Hold ${prettyKey(dBinds.crouch)} (slower, sneakier)`],
        ["React", `${prettyKey(dBinds.emotes)} opens emotes, 1–8 picks the visible row, Tab flips pages`],
        ["Camera", `${prettyKey(dBinds.camera)} snaps a polaroid — effects, save to PC or share in game`],
        ["Interact", `${prettyKey(dBinds.interact)}: sit • grab/throw ball • TV • photos • football on the pitch • challenge / tip a friend`],
      ] as [string, string][],
    },
    ...INFO_SECTIONS.filter((s) => s.title !== "Moving around"),
  ];

  return (
    <>
      <div className={closing ? "pp-anim-fade-out" : "pp-anim-fade-in"} style={s.backdrop} onClick={onClose} />
      <div className={closing ? "pp-anim-center-out" : "pp-anim-center-in"} style={s.modal}>
        <div className="pp-panel" style={s.sheet}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 21, fontWeight: 900, flex: 1 }}>Settings</h2>
            <button className="pp-iconbtn pp-iconbtn-off" style={{ width: 38, height: 38, fontSize: 15 }} onClick={onClose} title="Close without saving">✕</button>
            <button className="pp-iconbtn pp-iconbtn-on" style={{ width: 38, height: 38, fontSize: 17 }} onClick={save} title="Save and close">✓</button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                className={"pp-choice" + (tab === t.id ? " pp-choice-on" : "")}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="pp-scroll" style={s.body}>
            {tab === "how" && (
              <>
                {howSections.map((sec) => (
                  <div key={sec.title}>
                    <div className="pp-section-title">{sec.title}</div>
                    {sec.rows.map(([k, v]) => (
                      <div key={k} style={{ display: "flex", gap: 10, fontSize: 14, padding: "5px 0", borderBottom: "2px dotted #d9c193" }}>
                        <b style={{ minWidth: 128, flexShrink: 0 }}>{k}</b>
                        <span style={{ color: "#6b543f", fontWeight: 700 }}>{v}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}
            {tab === "iface" && (
              <>
                <span className="pp-label" style={{ marginTop: 2 }}>Interface size</span>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input
                    type="range"
                    id="ct-ui-scale" name="uiScale"
                    className="pp-range"
                    min={50}
                    max={150}
                    step={5}
                    value={Math.round(dScale * 100)}
                    onChange={(e) => setDScale(Number(e.target.value) / 100)}
                    aria-label="Interface size"
                  />
                  <b style={{ minWidth: 52, textAlign: "right", fontSize: 15 }}>{Math.round(dScale * 100)}%</b>
                </div>
                <span className="pp-label">Effects</span>
                <button className={"pp-choice" + (dDust ? " pp-choice-on" : "")} style={s.uniformBtn} onClick={() => setDDust((v) => !v)}>
                  Run dust: {dDust ? "on" : "off"}
                </button>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className={"pp-choice" + (dDebug ? " pp-choice-on" : "")} style={{ ...s.uniformBtn, flex: 1 }} onClick={() => setDDebug((v) => !v)} title="On-screen technical overlay (Shift+P)">
                    Debug: {dDebug ? "on" : "off"}
                  </button>
                  <button className={"pp-choice" + (dColl ? " pp-choice-on" : "")} style={{ ...s.uniformBtn, flex: 1 }} onClick={() => setDColl((v) => !v)} title="Highlight collider boxes (Shift+O)">
                    Colliders: {dColl ? "on" : "off"}
                  </button>
                </div>
                <span className="pp-label">Home screen</span>
                <button className={"pp-choice" + (dBuddy ? " pp-choice-on" : "")} style={s.uniformBtn} onClick={() => setDBuddy((v) => !v)}>
                  Cloakling: {dBuddy ? "shown" : "hidden"}
                </button>
                <span className="pp-label">In game</span>
                <button className={"pp-choice" + (dHints ? " pp-choice-on" : "")} style={s.uniformBtn} onClick={() => setDHints((v) => !v)} title="Bottom keybind hints (Press E to…)">
                  Keybind hints: {dHints ? "shown" : "hidden"}
                </button>
                {dDebug && (
                  <>
                    <div className="pp-section-title">Debug data</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: voice.peersLinked > 0 ? "#3e7d46" : "#b3814d" }}>
                      {voice.peersLinked > 0
                        ? `● voice linked to ${voice.peersLinked} ${voice.peersLinked === 1 ? "person" : "people"}`
                        : "○ no voice link yet — links form when someone else is here and a mic is on"}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#6b543f" }}>
                      output: {voice.diag.ctx} • mic[{voice.diag.out}]
                      {voice.diag.peers.map((p) => (
                        <span key={p.id}> • {p.id}: {p.conn}{p.track ? "+audio" : "-audio"} vol {p.gain}{p.dist == null ? "" : ` ${p.dist}px`} mic[{p.rstate}] ear[{p.inLvl}] ↑{p.upBs}B/s ↓{p.downBs}B/s</span>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
            {tab === "keys" && (
              <>
                {BIND_ROWS.map(({ action, label }) => (
                  <div key={action} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 800 }}>{label}</span>
                    <button
                      className="pp-btn pp-btn-cream"
                      style={{ padding: "7px 14px", fontSize: 14, minWidth: 110 }}
                      onClick={() => setBindingAction(action)}
                    >
                      {bindingAction === action ? "Press a key…" : `Key: ${prettyKey(dBinds[action])}`}
                    </button>
                  </div>
                ))}
                <span style={{ fontSize: 12, color: "#6b543f", fontWeight: 700 }}>
                  Arrows always move too; ESC, Enter, Shift+P/O stay fixed. Duplicates swap. Ctrl/⌘ combos, Tab and Control itself can't be bound.
                </span>
                <button className="pp-btn pp-btn-wood" onClick={() => setDBinds({ ...DEFAULT_BINDS })}>
                  Reset defaults
                </button>
              </>
            )}
            {tab === "voice" && (
              <>
                <span className="pp-label" style={{ marginTop: 2 }}>Microphone</span>
                <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                  <span className="pp-select-wrap">
                    <select id="ct-mic" name="mic" className="pp-select" value={dMic} onChange={(e) => setDMic(e.target.value)}>
                      <option value="">System default</option>
                      {voice.devices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                      ))}
                    </select>
                  </span>
                  <button className="pp-btn pp-btn-wood" style={{ padding: "8px 14px", alignSelf: "center" }} onClick={() => voice.loadDevices()} title="Refresh microphone list">↻</button>
                </div>
                <span className="pp-label">Activation mode</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className={"pp-choice" + (dMode === "toggle" ? " pp-choice-on" : "")} style={{ ...s.uniformBtn, flex: 1 }} onClick={() => setDMode("toggle")}>Toggle</button>
                  <button className={"pp-choice" + (dMode === "ptt" ? " pp-choice-on" : "")} style={{ ...s.uniformBtn, flex: 1 }} onClick={() => setDMode("ptt")}>Push-to-talk</button>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    className={"pp-choice" + (dEcho ? " pp-choice-on" : "")}
                    style={{ ...s.uniformBtn, flex: 0, minWidth: 150 }}
                    onClick={() => setDEcho((v) => !v)}
                    title="Browser mic cleanup: helps with echo, can strangle audio on shared speakers"
                  >
                    Echo filter: {dEcho ? "on" : "off"}
                  </button>
                  <span style={{ fontSize: 12, color: "#6b543f", fontWeight: 700 }}>
                    Turn off if voices vanish on shared speakers
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="pp-btn pp-btn-cream" style={{ padding: "8px 14px", fontSize: 14, flex: 1 }} onClick={() => voice.playTest()}>Test speaker</button>
                  <button className="pp-btn pp-btn-cream" style={{ padding: "8px 14px", fontSize: 14, flex: 1 }} onClick={() => voice.resetMesh()} title="Tear down and rebuild all voice links from scratch">Reconnect voice</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(43,26,18,0.62)", zIndex: 40 },
  modal: { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 560, maxWidth: "94%", zIndex: 41 },
  // Fixed sheet: header + tabs stay put, only the body scrolls.
  sheet: { height: "min(640px, 92vh)", display: "flex", flexDirection: "column", gap: 9, padding: 22 },
  body: { flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", gap: 9, paddingRight: 2 },
  uniformBtn: { minHeight: 44, flex: "none" },
};

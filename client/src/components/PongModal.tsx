import { useEffect, useRef, useState } from "react";
import type { PongState } from "../net/socket";

// Server field units (mirrors server PONG_W/H) — rendering is %-based.
const FW = 200, FH = 120, PAD_W = 4, PAD_H = 26, P1_X = 8, P2_X = 192, BALL_R = 3;

type Props = {
  pong: PongState;
  /** 1 = left paddle (P1), 2 = right paddle (P2), 0 = spectator mirror */
  mySide: 0 | 1 | 2;
  myId: string;
  /** your cross-device pong wins (DB) — shown in the lobby */
  wins: number;
  /** your token balance — Ready takes 1 token when the match starts */
  tokens: number;
  closing?: boolean;
  onReady: (ready: boolean) => void;
  onInput: (up: boolean, down: boolean) => void;
  onClose: () => void;
};

export default function PongModal({
  pong, mySide, myId, wins, tokens, closing = false, onReady, onInput, onClose,
}: Props) {
  const status = pong?.status ?? "lobby";
  const [, setTick] = useState(0);

  // Drive your paddle with W/S or arrows. Change-events + a slow heartbeat
  // (dropped packets must not glue your paddle in place).
  const held = useRef({ up: false, down: false });
  const inputRef = useRef(onInput);
  inputRef.current = onInput;
  useEffect(() => {
    if (mySide === 0) return;
    const send = () => inputRef.current(held.current.up, held.current.down);
    const key = (e: KeyboardEvent, down: boolean) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      const isUp = k === "arrowup" || k === "w";
      const isDown = k === "arrowdown" || k === "s";
      if (!isUp && !isDown) return;
      e.preventDefault();
      let changed = false;
      if (isUp && held.current.up !== down) { held.current.up = down; changed = true; }
      if (isDown && held.current.down !== down) { held.current.down = down; changed = true; }
      if (changed) send();
    };
    const dn = (e: KeyboardEvent) => { if (!e.repeat) key(e, true); };
    const up = (e: KeyboardEvent) => key(e, false);
    const beat = setInterval(send, 300);
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", dn);
      window.removeEventListener("keyup", up);
      clearInterval(beat);
      held.current = { up: false, down: false };
      inputRef.current(false, false);
    };
  }, [mySide]);

  // Countdown number ticks locally (server owns the real transition).
  useEffect(() => {
    if (pong?.status !== "countdown") return;
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [pong?.status]);

  const s1 = pong?.s1 ?? 0, s2 = pong?.s2 ?? 0;
  const n1 = pong?.p1Name || "P1", n2 = pong?.p2Name || "P2";
  const t1 = `${n1}${pong?.p1 === myId ? " (you)" : ""}`;
  const t2 = `${n2}${pong?.p2 === myId ? " (you)" : ""}`;
  const myReady = mySide === 1 ? !!pong?.ready1 : mySide === 2 ? !!pong?.ready2 : false;
  const oppReady = mySide === 1 ? !!pong?.ready2 : mySide === 2 ? !!pong?.ready1 : false;
  const bothHere = !!pong?.p1 && !!pong?.p2;
  const cd = pong?.status === "countdown"
    ? Math.max(1, Math.ceil(((pong?.countdownAt || 0) - Date.now()) / 1000))
    : 0;

  return (
    <>
      <div
        className={closing ? "pp-anim-fade-out" : "pp-anim-fade-in"}
        style={s.backdrop}
        onClick={onClose}
      />
      <div className={"pp-panel " + (closing ? "pp-anim-center-out" : "pp-anim-center-in")} style={s.modal}>
        <div style={s.head}>
          <b style={s.title}>PONG</b>
          <span style={s.score}>{t1} {s1} : {s2} {t2}</span>
          <button className="pp-btn pp-btn-cream" style={s.x} onClick={onClose} title="Close (E)">✕</button>
        </div>
        <div style={s.screen}>
          {/* center line */}
          <div style={s.mid} />
          {/* paddles */}
          <div style={{ ...s.pad, left: `${((P1_X - PAD_W / 2) / FW) * 100}%`, top: `${(((pong?.pad1 ?? FH / 2) - PAD_H / 2) / FH) * 100}%`, width: `${(PAD_W / FW) * 100}%`, height: `${(PAD_H / FH) * 100}%` }} />
          <div style={{ ...s.pad, left: `${((P2_X - PAD_W / 2) / FW) * 100}%`, top: `${(((pong?.pad2 ?? FH / 2) - PAD_H / 2) / FH) * 100}%`, width: `${(PAD_W / FW) * 100}%`, height: `${(PAD_H / FH) * 100}%` }} />
          {/* ball */}
          {pong?.ball && (
            <div style={{
              ...s.ball,
              left: `${((pong.ball.x - BALL_R) / FW) * 100}%`,
              top: `${((pong.ball.y - BALL_R) / FH) * 100}%`,
              width: `${((BALL_R * 2) / FW) * 100}%`,
              height: `${((BALL_R * 2) / FH) * 100}%`,
            }} />
          )}
          {status === "countdown" && <div style={s.cd}>{cd}</div>}
          <div style={s.scan} />
        </div>
        {mySide === 0 ? (
          <div style={s.note}>
            Spectating <b>{n1}</b> vs <b>{n2}</b>
          </div>
        ) : status === "lobby" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={s.note}>
              {bothHere
                ? <>First to 11{oppReady ? " · opponent ready ✓" : " · waiting for opponent…"}</>
                : <>Waiting for an opponent</>}
            </div>
            {wins > 0 && <div style={s.note}>Your pong wins: <b>{wins}</b></div>}
            {bothHere && (
              <button
                className={"pp-btn " + (myReady ? "pp-btn-cream" : "pp-btn-leaf")}
                style={s.start}
                disabled={!myReady && tokens < 1}
                onClick={() => onReady(!myReady)}
                title={!myReady && tokens < 1 ? "Need a token" : "Ready"}
              >
                {myReady ? "Ready ✓ (tap to unready)" : tokens < 1 ? "Need a token" : "Ready"}
              </button>
            )}
          </div>
        ) : status === "countdown" ? (
          <div style={s.note}>Get ready…</div>
        ) : status === "play" ? (
          <div style={s.note}>
            <b>W/S</b> or <b>↑/↓</b> to move
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={s.result}>
              GAME OVER
            </div>
            <button
              className="pp-btn pp-btn-leaf"
              style={s.start}
              disabled={tokens < 1}
              onClick={() => onReady(true)}
              title={tokens < 1 ? "Need a token" : "Back to the lobby, marked ready"}
            >
              {tokens < 1 ? "Need a token" : "Rematch: ready up"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  backdrop: { position: "absolute", inset: 0, background: "rgba(43,26,18,0.62)", zIndex: 30 },
  modal: {
    position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
    width: 420, maxWidth: "94%", zIndex: 31, display: "flex", flexDirection: "column", gap: 10,
    padding: 16,
  },
  head: { display: "flex", alignItems: "center", gap: 10 },
  title: {
    fontFamily: "'Courier New', monospace", fontSize: 20, letterSpacing: 3,
    color: "#4a3728", background: "#7ec8f0", border: "3px solid #4a3728",
    borderRadius: 8, padding: "2px 10px",
  },
  score: { flex: 1, fontFamily: "'Courier New', monospace", fontWeight: 900, fontSize: 14, color: "#4a3728" },
  x: { padding: "4px 10px", fontSize: 14 },
  screen: {
    position: "relative", background: "#16233f", border: "4px solid #4a3728",
    borderRadius: 10, overflow: "hidden", aspectRatio: "200 / 120",
  },
  mid: {
    position: "absolute", left: "50%", top: "6%", bottom: "6%", width: 0,
    borderLeft: "3px dashed rgba(255,255,255,0.6)",
  },
  pad: { position: "absolute", background: "#faf3df", borderRadius: 2 },
  ball: { position: "absolute", background: "#faf3df", borderRadius: 2 },
  cd: {
    position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
    fontFamily: "'Courier New', monospace", fontWeight: 900, fontSize: 64, color: "#faf3df",
  },
  scan: {
    position: "absolute", inset: 0, pointerEvents: "none",
    background: "repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 4px)",
  },
  note: { fontSize: 13, fontWeight: 700, color: "#6b543f", textAlign: "center" },
  result: {
    fontFamily: "'Courier New', monospace", fontWeight: 900, fontSize: 16,
    color: "#4a3728", textAlign: "center",
  },
  start: { padding: "10px 14px", fontSize: 15 },
};

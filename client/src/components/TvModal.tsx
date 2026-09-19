import { useEffect, useRef, useState } from "react";
import type { TvState } from "../net/socket";
import { parseVideoUrl, tvPlayhead, loadYouTubeApi, fmtTime } from "../game/tvShared";

type Props = {
  tv: TvState;
  watchers: number;
  closing?: boolean;
  onPlay: (url: string) => void;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  onSeek: (pos: number) => void;
  onStop: () => void;
  onClose: () => void;
};

/* Speaker glyph: sound waves when live, bare cone when muted. */
function SpeakerGlyph({ off }: { off: boolean }) {
  const ink = "#4a3728";
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 9.5v5h3.5L13 19.5v-15L7.5 9.5H4z"
        fill={ink}
        stroke={ink}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {!off && (
        <>
          <path d="M15.5 9.2a4 4 0 010 5.6" stroke={ink} strokeWidth="2" strokeLinecap="round" />
          <path d="M18 6.8a7.4 7.4 0 010 10.4" stroke={ink} strokeWidth="2" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export default function TvModal({ tv, watchers, closing = false, onPlay, onPause, onResume, onRestart, onSeek, onStop, onClose }: Props) {
  const [draft, setDraft] = useState(tv?.url || "");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [isFs, setIsFs] = useState(false);
  const screenRef = useRef<HTMLDivElement>(null);
  // Personal subtitle pref (local only — the room stays in sync regardless).
  const [cc, setCc] = useState(false);
  const [hasMp4Cc, setHasMp4Cc] = useState(false);
  const ytWrapRef = useRef<HTMLDivElement>(null);
  const ytPlayer = useRef<any>(null);
  const ytVideoId = useRef<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mp4Url = useRef<string | null>(null);

  const parsed = parseVideoUrl(tv?.url || "");
  const tvJson = JSON.stringify(tv);

  // Push the shared state into the local player (YouTube or <video>).
  // All control flows through the server round-trip, so players can never
  // echo or fight each other — this function is the only writer.
  useEffect(() => {
    const cur: TvState = tv ? JSON.parse(tvJson) : null;
    // Stopped (or switched away): tear players down so replaying the same
    // link later starts from a clean slate instead of a dead handle.
    if (!cur || parseVideoUrl(cur.url).kind !== "youtube") {
      try {
        ytPlayer.current?.destroy?.();
      } catch {}
      ytPlayer.current = null;
      ytVideoId.current = null;
      // drop any manual iframe/iFrame leftovers (our children, not React's)
      try {
        if (ytWrapRef.current) ytWrapRef.current.innerHTML = "";
      } catch {}
    }
    if (!cur || parseVideoUrl(cur.url).kind !== "mp4") mp4Url.current = null;
    if (!cur) {
      setCc(false);
      setHasMp4Cc(false);
      return;
    }
    const p = parseVideoUrl(cur.url);
    if (p.kind === "youtube") {
      let cancelled = false;
      void loadYouTubeApi().then(() => {
        if (cancelled) return;
        const w = window as any;
        if (!w.YT?.Player || !ytWrapRef.current) return;
        try {
          // Recreate per video: single-video loop needs playlist=id at
          // construction, and a fresh node keeps old iframes from piling up.
          if (ytVideoId.current !== p.id) {
            try {
              ytPlayer.current?.destroy?.();
            } catch {}
            ytPlayer.current = null;
            // CRITICAL: hand YouTube a manually-created inner div, never
            // React's own node — YT *replaces* the passed node with an
            // iframe, and React crashes removing a node it no longer owns.
            ytWrapRef.current.innerHTML = "";
            const inner = document.createElement("div");
            inner.setAttribute("data-yt", "");
            inner.style.width = "100%";
            inner.style.height = "100%";
            ytWrapRef.current.appendChild(inner);
            ytPlayer.current = new w.YT.Player(inner, {
              width: "100%",
              height: "100%",
              videoId: p.id,
              playerVars: {
                autoplay: 1, controls: 0, rel: 0, modestbranding: 1,
                disablekb: 1, iv_load_policy: 3, playsinline: 1,
                loop: 1, playlist: p.id, // loop dodges the end-screen recommendations
              },
              events: {
                onReady: () => {
                  if (muted) ytPlayer.current?.mute?.();
                  if (cc) {
                    try {
                      ytPlayer.current?.loadModule?.("captions");
                    } catch {}
                  }
                  const c: TvState = tv ? JSON.parse(tvJson) : null;
                  if (c) applyYouTube(c);
                },
              },
            });
            ytVideoId.current = p.id;
            setCc(false); // fresh player, captions start off
          } else {
            applyYouTube(cur);
          }
        } catch {
          /* player torn down mid-load — next state heals it */
        }
      });
      return () => {
        cancelled = true;
      };
    }
    if (p.kind === "mp4" && videoRef.current) {
      const v = videoRef.current;
      if (mp4Url.current !== cur.url) {
        mp4Url.current = cur.url;
        v.src = cur.url;
        setCc(false);
      }
      v.muted = muted;
      setHasMp4Cc(!!(v.textTracks && v.textTracks.length > 0));
      const want = tvPlayhead(cur);
      if (cur.playing) {
        if (Math.abs((v.currentTime || 0) - want) > 2.5) {
          try {
            v.currentTime = want;
          } catch {
            /* metadata not here yet — timeupdate heals it */
          }
        }
        void v.play().catch(() => {});
      } else {
        v.pause();
        if (Math.abs((v.currentTime || 0) - want) > 1) {
          try {
            v.currentTime = want;
          } catch {}
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tvJson]);

  function applyYouTube(cur: NonNullable<TvState>) {
    const w = window as any;
    const pl = ytPlayer.current;
    if (!pl?.getPlayerState || !w.YT) return;
    try {
      const want = tvPlayhead(cur);
      const have = pl.getCurrentTime?.() || 0;
      const st = pl.getPlayerState();
      if (cur.playing) {
        if (Math.abs(have - want) > 2.5) pl.seekTo(want, true);
        if (st !== w.YT.PlayerState.PLAYING) pl.playVideo();
      } else {
        if (Math.abs(have - want) > 1) pl.seekTo(want, true);
        if (st === w.YT.PlayerState.PLAYING) pl.pauseVideo();
      }
    } catch {
      /* mid-teardown — next state heals it */
    }
  }

  // Gentle drift correction while a program runs (clocks wander).
  useEffect(() => {
    if (!tv?.playing) return;
    const id = setInterval(() => {
      const cur: TvState = tv ? JSON.parse(tvJson) : null;
      if (!cur) return;
      const p = parseVideoUrl(cur.url);
      if (p.kind === "youtube" && ytPlayer.current?.getCurrentTime) {
        try {
          const have = ytPlayer.current.getCurrentTime() || 0;
          if (Math.abs(have - tvPlayhead(cur)) > 3) applyYouTube(cur);
        } catch {}
      } else if (p.kind === "mp4" && videoRef.current) {
        const v = videoRef.current;
        if (!v.paused && Math.abs((v.currentTime || 0) - tvPlayhead(cur)) > 3) {
          try {
            v.currentTime = tvPlayhead(cur);
          } catch {}
        }
      }
    }, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tvJson]);

  // Progress readout (also feeds the seek bar below).
  useEffect(() => {
    const tick = () => {
      const cur: TvState = tv ? JSON.parse(tvJson) : null;
      if (!cur) {
        setPos(0);
        setDur(0);
        return;
      }
      setPos(tvPlayhead(cur));
      try {
        if (ytPlayer.current?.getDuration) {
          const d = ytPlayer.current.getDuration() || 0;
          if (d > 0) setDur(d);
        } else if (videoRef.current && videoRef.current.duration > 0) {
          setDur(videoRef.current.duration);
        }
      } catch {}
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tvJson]);

  const seekTo = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!tv || dur <= 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
    onSeek(ratio * dur);
  };

  // Mute is local-only (your ears, your call).
  useEffect(() => {
    try {
      if (muted) ytPlayer.current?.mute?.();
      else ytPlayer.current?.unMute?.();
    } catch {}
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  // Tear down playback when the panel closes (the room keeps watching).
  useEffect(() => {
    return () => {
      try {
        ytPlayer.current?.destroy?.();
      } catch {}
      ytPlayer.current = null;
      ytVideoId.current = null;
      mp4Url.current = null;
    };
  }, []);

  // Fullscreen follows the browser (ESC exits natively, we just mirror it).
  useEffect(() => {
    const h = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  const toggleFs = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      try {
        const p = screenRef.current?.requestFullscreen?.();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch {}
    }
  };

  // Subtitles, just for you: loading the captions module shows YouTube's
  // default track, unloading hides it again. No probing, no fibbing.
  const toggleCc = () => {
    if (parsed.kind === "youtube" && ytPlayer.current) {
      try {
        if (!cc) ytPlayer.current.loadModule("captions");
        else ytPlayer.current.unloadModule("captions");
      } catch {}
      setCc(!cc);
    } else if (parsed.kind === "mp4" && videoRef.current) {
      const tracks = videoRef.current.textTracks;
      if (!tracks || tracks.length === 0) return;
      const next = !cc;
      for (let i = 0; i < tracks.length; i++) {
        try {
          tracks[i].mode = i === 0 && next ? "showing" : "hidden";
        } catch {}
      }
      setCc(next);
    }
  };

  const submit = () => {
    const p = parseVideoUrl(draft);
    if (p.kind === "empty") {
      setError("Paste a YouTube or .mp4 link first.");
      return;
    }
    if (p.kind === "unsupported") {
      setError("That host can't play here — YouTube and direct .mp4/.webm links work.");
      return;
    }
    setError("");
    onPlay(draft.trim());
  };

  return (
    <>
      <div className={closing ? "pp-anim-fade-out" : "pp-anim-fade-in"} style={s.backdrop} onClick={onClose} />
      <div className={"pp-panel " + (closing ? "pp-anim-center-out" : "pp-anim-center-in")} style={s.modal}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>Cozy TV</h2>
          <button className="pp-iconbtn pp-iconbtn-off" style={{ width: 38, height: 38, fontSize: 15 }} onClick={onClose} title="Close (keeps playing for everyone)">
            ✕
          </button>
        </div>
        <div ref={screenRef} style={s.screen}>
          {parsed.kind === "youtube" && <div ref={ytWrapRef} style={{ width: "100%", height: "100%" }} />}
          {parsed.kind === "mp4" && <video ref={videoRef} style={{ width: "100%", height: "100%", background: "#000" }} playsInline />}
          {(parsed.kind === "empty" || parsed.kind === "unsupported") && (
            <div style={s.idle}>Paste a link below and hit Watch — everyone in the room sees the same thing.</div>
          )}
        </div>
        {tv && (
          <>
            <div onClick={seekTo} title="Seek — everyone follows" style={s.progress}>
              <div style={{ ...s.fill, width: `${dur > 0 ? Math.min(100, (pos / dur) * 100) : 0}%` }} />
            </div>
            <div style={s.times}>
              <span>{fmtTime(pos)}</span>
              <span>{dur > 0 ? fmtTime(dur) : pos > 1 ? "tuning in…" : "loading…"}</span>
            </div>
          </>
        )}
        <div style={s.status}>
          {tv ? (
            <>
              <b>{tv.playing ? "Playing" : "Paused"}</b>
              <span style={{ color: "#6b543f" }}>
                {" "}
                · {watchers} watching · started by {tv.by || "someone"}
              </span>
            </>
          ) : (
            <span style={{ color: "#6b543f" }}>Nothing on yet — pick something good.</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", alignItems: "center" }}>
          {tv?.playing ? (
            <button className="pp-btn pp-btn-wood" style={s.icon} onClick={onPause} title="Pause (everyone)">
              ❚❚
            </button>
          ) : (
            <button className="pp-btn pp-btn-leaf" style={s.icon} onClick={onResume} disabled={!tv} title="Play (everyone)">
              ▶
            </button>
          )}
          <button className="pp-btn pp-btn-cream" style={s.icon} onClick={onRestart} disabled={!tv} title="Restart (everyone)">
            ↻
          </button>
          {(parsed.kind === "youtube" || hasMp4Cc) && (
            <button
              className={"pp-btn " + (cc ? "pp-btn-leaf" : "pp-btn-cream")}
              style={s.iconCc}
              onClick={toggleCc}
              title="Subtitles, just for you"
            >
              CC
            </button>
          )}
          <button
            className={"pp-btn " + (muted ? "pp-btn-danger" : "pp-btn-cream")}
            style={s.icon}
            onClick={() => setMuted((m) => !m)}
            title="Mute, just for you"
          >
            <SpeakerGlyph off={muted} />
          </button>
          <button className="pp-btn pp-btn-cream" style={s.icon} onClick={toggleFs} title={isFs ? "Exit fullscreen (or ESC)" : "Fullscreen"}>
            ⤢
          </button>
          <button className="pp-btn pp-btn-danger" style={s.icon} onClick={onStop} disabled={!tv} title="Stop (everyone)">
            ■
          </button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="pp-input"
            style={{ margin: 0, flex: 1 }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="YouTube or .mp4 link…"
            maxLength={500}
          />
          <button className="pp-btn pp-btn-leaf" style={{ padding: "9px 16px" }} onClick={submit}>
            Watch
          </button>
        </div>
        {error && <div style={{ fontSize: 13, fontWeight: 800, color: "#a83e2f" }}>{error}</div>}
      </div>
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(43,26,18,0.62)", zIndex: 30 },
  modal: {
    position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
    width: 700, maxWidth: "94%", maxHeight: "94%", padding: 20, zIndex: 31,
    display: "flex", flexDirection: "column", gap: 10, overflowY: "auto", overflowX: "hidden",
  },
  screen: { width: "100%", aspectRatio: "16 / 9", background: "#0b0e1a", borderRadius: 12, overflow: "hidden", border: "3px solid #4a3728" },
  idle: {
    width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
    textAlign: "center", padding: 24, boxSizing: "border-box", color: "#8b93b0", fontWeight: 800, fontSize: 15,
  },
  status: { fontSize: 14, fontWeight: 800 },
  icon: {
    width: 46, height: 42, padding: 0, fontSize: 17,
    display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  iconCc: {
    width: 52, height: 42, padding: 0, fontSize: 14, fontWeight: 900,
    display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  progress: {
    height: 12, borderRadius: 7, background: "#3a2c1e", border: "2px solid #4a3728",
    cursor: "pointer", overflow: "hidden",
  },
  fill: { height: "100%", background: "#f2c14e", borderRadius: 4 },
  times: { display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 800, color: "#6b543f", marginTop: -6 },
};

import { useEffect, useRef } from "react";
import type { TvState } from "../net/socket";
import { parseVideoUrl, tvPlayhead, loadYouTubeApi } from "./tvShared";
import { TV_SPOT } from "./maps";

export type TvMe = { x: number; y: number; mapId: string } | null;

/**
 * TV spillover audio: panel closed + standing in the arcade near the set =
 * you still hear the program, volume fading with distance like it's really
 * coming from the speakers. Full blast on the couch, gone past the door.
 * Pauses the moment you open the panel (it has its own audible player),
 * wander off, or the TV stops. Plain DOM rig — React never touches it.
 */
export function useTvAudio(tv: TvState, tvOpen: boolean, getMe: () => TvMe) {
  const yt = useRef<any>(null);
  const ytId = useRef<string | null>(null);
  const mount = useRef<HTMLDivElement | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);

  const tvRef = useRef(JSON.stringify(tv));
  tvRef.current = JSON.stringify(tv);
  const openRef = useRef(tvOpen);
  openRef.current = tvOpen;
  const meRef = useRef(getMe);
  meRef.current = getMe;

  const pauseAll = () => {
    try {
      yt.current?.pauseVideo?.();
    } catch {}
    try {
      audio.current?.pause?.();
    } catch {}
  };

  const syncAmbient = () => {
    let cur: TvState = null;
    try {
      cur = tvRef.current ? JSON.parse(tvRef.current) : null;
    } catch {
      cur = null;
    }
    const me = meRef.current();
    const eligible = !!cur && !openRef.current && !!me && me.mapId === "arcade";
    if (!eligible || !cur || !me) {
      pauseAll();
      if (!cur) {
        ytId.current = null;
        audioUrl.current = null;
      }
      return;
    }
    const d = Math.hypot(TV_SPOT.x - me.x, TV_SPOT.y - me.y);
    const vol = d <= 130 ? 1 : d >= 430 ? 0 : 1 - (d - 130) / 300;
    if (vol <= 0) {
      pauseAll();
      return;
    }
    const p = parseVideoUrl(cur.url);
    if (p.kind === "youtube") {
      try {
        audio.current?.pause?.();
      } catch {}
      audioUrl.current = null;
      if (ytId.current !== p.id) {
        ytId.current = p.id;
        void loadYouTubeApi().then(() => {
          const w = window as any;
          if (!w.YT?.Player || !mount.current || ytId.current !== p.id) return;
          try {
            try {
              yt.current?.destroy?.();
            } catch {}
            mount.current.innerHTML = "";
            const inner = document.createElement("div");
            inner.style.width = "100%";
            inner.style.height = "100%";
            mount.current.appendChild(inner);
            yt.current = new w.YT.Player(inner, {
              width: "4",
              height: "4",
              videoId: p.id,
              playerVars: {
                autoplay: 0, controls: 0, rel: 0, disablekb: 1,
                iv_load_policy: 3, playsinline: 1, loop: 1, playlist: p.id,
              },
              events: { onReady: () => syncAmbient() },
            });
          } catch {}
        });
        return;
      }
      const pl = yt.current;
      if (!pl?.getPlayerState) return;
      try {
        const w = window as any;
        const want = tvPlayhead(cur, 1);
        const have = pl.getCurrentTime?.() || 0;
        pl.setVolume?.(Math.round(vol * 100));
        if (cur.playing) {
          if (Math.abs(have - want) > 4) pl.seekTo(want, true);
          if (pl.getPlayerState() !== w.YT.PlayerState.PLAYING) pl.playVideo();
        } else if (pl.getPlayerState() === w.YT.PlayerState.PLAYING) {
          pl.pauseVideo();
        }
      } catch {}
      return;
    }
    if (p.kind === "mp4" && audio.current) {
      try {
        yt.current?.pauseVideo?.();
      } catch {}
      const a = audio.current;
      if (audioUrl.current !== cur.url) {
        audioUrl.current = cur.url;
        a.src = cur.url;
      }
      a.volume = vol;
      const want = tvPlayhead(cur, 1);
      if (cur.playing) {
        if (Math.abs((a.currentTime || 0) - want) > 4) {
          try {
            a.currentTime = want;
          } catch {}
        }
        try {
          const pr = a.play();
          if (pr && typeof pr.catch === "function") pr.catch(() => {});
        } catch {}
      } else {
        a.pause();
      }
      return;
    }
    pauseAll();
  };

  useEffect(() => {
    const slot = document.createElement("div");
    slot.setAttribute("data-tv-ambient", "");
    slot.style.cssText =
      "position:fixed;left:0;bottom:0;width:4px;height:4px;overflow:hidden;opacity:0.01;pointer-events:none;";
    document.body.appendChild(slot);
    mount.current = slot;
    const a = new Audio();
    a.preload = "auto";
    audio.current = a;
    syncAmbient();
    const id = setInterval(syncAmbient, 500);
    // browsers gate audio behind a first gesture — retry on every one
    const kick = () => {
      syncAmbient();
    };
    window.addEventListener("pointerdown", kick);
    window.addEventListener("keydown", kick);
    return () => {
      clearInterval(id);
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
      try {
        yt.current?.destroy?.();
      } catch {}
      yt.current = null;
      try {
        a.pause();
      } catch {}
      audio.current = null;
      mount.current = null;
      slot.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

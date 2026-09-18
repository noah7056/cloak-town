import type { TvState } from "../net/socket";

export type ParsedVideo =
  | { kind: "youtube"; id: string }
  | { kind: "mp4" }
  | { kind: "unsupported" }
  | { kind: "empty" };

export function parseVideoUrl(url: string): ParsedVideo {
  const u = (url || "").trim();
  if (!u) return { kind: "empty" };
  const m = u.match(/(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{6,})/);
  if (m) return { kind: "youtube", id: m[1] };
  const clean = u.split(/[?#]/)[0].toLowerCase();
  if (/\.(mp4|webm|ogv|ogg|mov)$/.test(clean)) return { kind: "mp4" };
  return { kind: "unsupported" };
}

/** Playhead seconds for a tv state (fast-forwards while playing). */
export function tvPlayhead(tv: NonNullable<TvState>, rate = 1): number {
  if (!tv.playing) return tv.position;
  return Math.max(0, tv.position + ((Date.now() - tv.updatedAt) / 1000) * rate);
}

export function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

// YouTube IFrame API, loaded once for the whole session.
let ytApiPromise: Promise<void> | null = null;
export function loadYouTubeApi(): Promise<void> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    const w = window as any;
    if (w.YT && w.YT.Player) {
      resolve();
      return;
    }
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      if (prev) prev();
      resolve();
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    setTimeout(() => resolve(), 8000); // offline: never hang the panel
  });
  return ytApiPromise;
}

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

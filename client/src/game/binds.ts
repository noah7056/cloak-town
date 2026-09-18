// Central keybind map: every rebindable action lives here, persisted as one
// JSON blob (pp-keys). Arrows (move alt), ESC, Enter and Shift+P/O are fixed
// and documented in How to play instead.

export type Binds = {
  up: string;
  down: string;
  left: string;
  right: string;
  run: string;
  crouch: string;
  jump: string;
  emotes: string;
  voice: string;
  interact: string;
  camera: string;
};

export const DEFAULT_BINDS: Binds = {
  up: "w",
  down: "s",
  left: "a",
  right: "d",
  run: "shift",
  crouch: "<",
  jump: " ",
  emotes: "t",
  voice: "v",
  interact: "e",
  camera: "c",
};

export const BIND_ROWS: { action: keyof Binds; label: string }[] = [
  { action: "up", label: "Move up" },
  { action: "left", label: "Move left" },
  { action: "down", label: "Move down" },
  { action: "right", label: "Move right" },
  { action: "run", label: "Run" },
  { action: "crouch", label: "Crouch" },
  { action: "jump", label: "Jump" },
  { action: "emotes", label: "Emote picker" },
  { action: "voice", label: "Voice key" },
  { action: "interact", label: "Interact" },
  { action: "camera", label: "Camera" },
];

function loadSetting(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function loadBinds(): Binds {
  try {
    const raw = localStorage.getItem("pp-keys");
    if (raw) {
      const parsed = { ...DEFAULT_BINDS, ...JSON.parse(raw) };
      // one-time migration: the old crouch default was C (awkward with D +
      // Space). Anyone still on it gets the new "<" default; explicit
      // rebinds to C still work via Reset/rebind.
      if (parsed.crouch === "c") parsed.crouch = DEFAULT_BINDS.crouch;
      return parsed;
    }
  } catch {
    /* corrupted blob — fall through to defaults */
  }
  // one-time migration from the old standalone voice key
  let voice = "v";
  try {
    voice = localStorage.getItem("pp-vkey") || "v";
    if (voice === "t") voice = "v"; // T opens emotes now
  } catch {}
  return { ...DEFAULT_BINDS, voice };
}

export function prettyKey(k: string): string {
  if (k === " ") return "Space";
  if (k === "<") return "<";
  if (k.length === 1) return k.toUpperCase();
  return k.charAt(0).toUpperCase() + k.slice(1);
}

/** Keys that can never be bound (browser/system territory or UI-critical). */
export function isForbiddenKey(k: string): boolean {
  return k === "escape" || k === "tab" || k === "control" || k === "meta";
}

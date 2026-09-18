// Cloak Town avatar system — all the knobs for your little traveler.
// Stored as one blob in localStorage ("pp-avatar"), sent to the server on
// join/create, broadcast with the player, rendered by engine.ts.

export type EyeStyle = "round" | "happy" | "sleepy" | "wink" | "sharp" | "dot";
export type HatKind =
  | "none" | "beanie" | "wizard" | "crown" | "flower"
  | "horns" | "cat" | "tophat" | "straw" | "headphones";
export type GlassesKind = "none" | "round" | "shades" | "star";
export type PatternKind = "solid" | "stripes" | "dots" | "patches";
export type AccessoryKind = "none" | "scarf" | "bow" | "pendant" | "straps";
export type FaceDeco = "none" | "blush" | "freckles" | "scar";
export type BackKind = "none" | "angel" | "bat" | "cape" | "tail";
export type PetKind = "none" | "blob" | "sprout" | "wisp";

export type Pet = {
  kind: PetKind;
  /** main body color */
  color: string;
  /** belly / leaf / mini-me trim accent */
  accent: string;
  eyes: EyeStyle;
  blush: boolean;
  /** mini-me boots */
  boots: string;
};

export type Avatar = {
  /** cloak main color — kept in sync with Player.color for compat */
  color: string;
  /** two-tone cloak: when gradient is on, the cloak fades color → cloakEnd */
  gradient: boolean;
  cloakEnd: string;
  /** hood rim / hem edge */
  trim: string;
  boots: string;
  /** face shadow tone */
  skin: string;
  eyeStyle: EyeStyle;
  glasses: GlassesKind;
  hat: HatKind;
  hatColor: string;
  pattern: PatternKind;
  accessory: AccessoryKind;
  faceDeco: FaceDeco;
  back: BackKind;
  /** wing / cape / tail tint */
  backColor: string;
  pet: Pet;
};

export const CLOAK_COLORS = [
  "#ef4444", "#f97316", "#facc15", "#22c55e", "#14b8a6", "#3b82f6",
  "#a855f7", "#ec4899", "#8a5a33", "#78350f", "#06b6d4", "#84cc16",
  "#f7ead0", "#34343f", "#e8919c", "#7c5cd6",
];

export const TRIM_COLORS = [
  "#f2c14e", "#faf3df", "#d95f4b", "#4e8d7c", "#3b82f6", "#a855f7",
  "#22c55e", "#8a5a33", "#34343f", "#7c5cd6", "#06b6d4", "#ec4899",
];

export const BOOT_COLORS = ["#3a2a1e", "#5d3a1e", "#8a5a33", "#34343f", "#d95f4b", "#3b82f6", "#faf3df"];
export const SKIN_TONES = ["#2b1f16", "#5d3a1e", "#8a5a33", "#c9a177", "#f1d3a7", "#6f8f5f", "#7c7fc4"];
export const HAT_COLORS = [
  "#d95f4b", "#f2c14e", "#4e8d7c", "#3b82f6", "#a855f7", "#22c55e",
  "#8a5a33", "#34343f", "#faf3df", "#e8919c", "#06b6d4", "#78350f",
];

export const DEFAULT_AVATAR: Avatar = {
  color: "#ef4444",
  gradient: false,
  cloakEnd: "#3b82f6",
  trim: "#f2c14e",
  boots: "#3a2a1e",
  skin: "#2b1f16",
  eyeStyle: "round",
  glasses: "none",
  hat: "none",
  hatColor: "#4e8d7c",
  pattern: "solid",
  accessory: "none",
  faceDeco: "none",
  back: "none",
  backColor: "#faf3df",
  pet: { kind: "none", color: "#f2c14e", accent: "#d95f4b", eyes: "round", blush: false, boots: "#3a2a1e" },
};

export const HATS: { id: HatKind; label: string; icon: string }[] = [
  { id: "none", label: "Bare hood", icon: "○" },
  { id: "beanie", label: "Beanie", icon: "▲" },
  { id: "wizard", label: "Wizard", icon: "✦" },
  { id: "crown", label: "Crown", icon: "♛" },
  { id: "flower", label: "Flower crown", icon: "✿" },
  { id: "horns", label: "Horns", icon: "♈" },
  { id: "cat", label: "Cat ears", icon: "🐾" },
  { id: "tophat", label: "Top hat", icon: "▤" },
  { id: "straw", label: "Straw hat", icon: "◍" },
  { id: "headphones", label: "Headphones", icon: "◖" },
];

export const EYES: { id: EyeStyle; label: string }[] = [
  { id: "round", label: "Round" },
  { id: "happy", label: "Happy" },
  { id: "sleepy", label: "Sleepy" },
  { id: "wink", label: "Wink" },
  { id: "sharp", label: "Sharp" },
  { id: "dot", label: "Dot" },
];

export const GLASSES_OPTS: { id: GlassesKind; label: string }[] = [
  { id: "none", label: "None" },
  { id: "round", label: "Round" },
  { id: "shades", label: "Shades" },
  { id: "star", label: "Star" },
];

export const PATTERNS: { id: PatternKind; label: string }[] = [
  { id: "solid", label: "Solid" },
  { id: "stripes", label: "Stripes" },
  { id: "dots", label: "Dots" },
  { id: "patches", label: "Patches" },
];

export const ACCESSORIES: { id: AccessoryKind; label: string }[] = [
  { id: "none", label: "None" },
  { id: "scarf", label: "Scarf" },
  { id: "bow", label: "Bowtie" },
  { id: "pendant", label: "Pendant" },
  { id: "straps", label: "Pack straps" },
];

export const FACE_DECOS: { id: FaceDeco; label: string }[] = [
  { id: "none", label: "None" },
  { id: "blush", label: "Blush" },
  { id: "freckles", label: "Freckles" },
  { id: "scar", label: "Scar" },
];

export const BACKS: { id: BackKind; label: string; icon: string }[] = [
  { id: "none", label: "None", icon: "○" },
  { id: "angel", label: "Angel wings", icon: "🪽" },
  { id: "bat", label: "Bat wings", icon: "🦇" },
  { id: "cape", label: "Cape", icon: "🧥" },
  { id: "tail", label: "Tail", icon: "🐈" },
];

export const PETS: { id: PetKind; label: string; icon: string }[] = [
  { id: "none", label: "No pet", icon: "○" },
  { id: "blob", label: "Mini me", icon: "🧍" },
  { id: "sprout", label: "Sprout", icon: "🌱" },
  { id: "wisp", label: "Wisp (flies)", icon: "👻" },
];

export const PET_COLORS = CLOAK_COLORS;
export const PET_ACCENTS = TRIM_COLORS;

const HEX = /^#[0-9a-fA-F]{6}$/;
function hex(v: unknown, fallback: string): string {
  return typeof v === "string" && HEX.test(v) ? v : fallback;
}

/** Clamp anything (network / storage) into a valid Avatar. */
export function sanitizeAvatar(raw: unknown): Avatar {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const one = <T extends string>(v: unknown, list: readonly T[], fb: T): T =>
    typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fb;
  const bool = (v: unknown, fb: boolean): boolean =>
    typeof v === "boolean" ? v : fb;
  const pr = (typeof r.pet === "object" && r.pet !== null ? r.pet : {}) as Record<string, unknown>;
  return {
    color: hex(r.color, DEFAULT_AVATAR.color),
    gradient: bool(r.gradient, false),
    cloakEnd: hex(r.cloakEnd, DEFAULT_AVATAR.cloakEnd),
    trim: hex(r.trim, DEFAULT_AVATAR.trim),
    boots: hex(r.boots, DEFAULT_AVATAR.boots),
    skin: hex(r.skin, DEFAULT_AVATAR.skin),
    eyeStyle: one(r.eyeStyle, EYES.map((e) => e.id), "round"),
    glasses: one(r.glasses, GLASSES_OPTS.map((g) => g.id), "none"),
    hat: one(r.hat, HATS.map((h) => h.id), "none"),
    hatColor: hex(r.hatColor, DEFAULT_AVATAR.hatColor),
    pattern: one(r.pattern, PATTERNS.map((p) => p.id), "solid"),
    accessory: one(r.accessory, ACCESSORIES.map((a) => a.id), "none"),
    faceDeco: one(r.faceDeco, FACE_DECOS.map((f) => f.id), "none"),
    back: one(r.back, BACKS.map((b) => b.id), "none"),
    backColor: hex(r.backColor, DEFAULT_AVATAR.backColor),
    pet: {
      kind: one(pr.kind, PETS.map((p) => p.id), "none"),
      color: hex(pr.color, DEFAULT_AVATAR.pet.color),
      accent: hex(pr.accent, DEFAULT_AVATAR.pet.accent),
      eyes: one(pr.eyes, EYES.map((e) => e.id), "round"),
      blush: bool(pr.blush, false),
      boots: hex(pr.boots, DEFAULT_AVATAR.pet.boots),
    },
  };
}

const KEY = "pp-avatar";
const LEGACY_COLOR = "pp-color";

export function loadAvatar(): Avatar {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_AVATAR, ...sanitizeAvatar(JSON.parse(raw)) };
    // migrate the old lone color picker
    const legacy = localStorage.getItem(LEGACY_COLOR);
    if (legacy && HEX.test(legacy)) return { ...DEFAULT_AVATAR, color: legacy };
  } catch { /* private mode */ }
  return { ...DEFAULT_AVATAR };
}

export function saveAvatar(a: Avatar) {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch { /* private mode */ }
}

const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

export function randomAvatar(base?: Avatar): Avatar {
  const b = base ?? DEFAULT_AVATAR;
  const gradient = Math.random() < 0.3;
  const petKind = Math.random() < 0.65 ? "none" as const : pick(PETS.filter((x) => x.id !== "none")).id;
  return {
    color: pick(CLOAK_COLORS),
    gradient,
    cloakEnd: gradient ? pick(CLOAK_COLORS) : b.cloakEnd,
    trim: pick(TRIM_COLORS),
    boots: pick(BOOT_COLORS),
    skin: Math.random() < 0.7 ? b.skin : pick(SKIN_TONES),
    eyeStyle: pick(EYES).id,
    glasses: Math.random() < 0.6 ? "none" : pick(GLASSES_OPTS.filter((g) => g.id !== "none")).id,
    hat: Math.random() < 0.25 ? "none" : pick(HATS.filter((h) => h.id !== "none")).id,
    hatColor: pick(HAT_COLORS),
    pattern: Math.random() < 0.45 ? "solid" : pick(PATTERNS.filter((p) => p.id !== "solid")).id,
    accessory: Math.random() < 0.5 ? "none" : pick(ACCESSORIES.filter((a) => a.id !== "none")).id,
    faceDeco: Math.random() < 0.55 ? "none" : pick(FACE_DECOS.filter((f) => f.id !== "none")).id,
    back: Math.random() < 0.6 ? "none" : pick(BACKS.filter((x) => x.id !== "none")).id,
    backColor: pick(HAT_COLORS),
    pet: petKind === "none"
      ? { ...b.pet, kind: "none" as const }
      : {
          kind: petKind,
          color: pick(PET_COLORS),
          accent: pick(PET_ACCENTS),
          eyes: Math.random() < 0.7 ? "round" as const : pick(EYES).id,
          blush: Math.random() < 0.3,
          boots: pick(BOOT_COLORS),
        },
  };
}

/** Short shareable code — copy/paste a look to a friend. */
export function encodeAvatar(a: Avatar): string {
  try {
    return btoa(JSON.stringify(a)).replace(/=+$/, "");
  } catch {
    return "";
  }
}

export function decodeAvatar(code: string): Avatar | null {
  try {
    const s = code.trim().replace(/\s+/g, "");
    const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
    return sanitizeAvatar(JSON.parse(atob(padded)));
  } catch {
    return null;
  }
}

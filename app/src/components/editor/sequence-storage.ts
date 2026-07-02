import { Effect, PIXEL_COUNT, type Cue, type RGB, type Sequence } from '@/lib/types';

/** localStorage key for the working sequence (per the app brief). */
export const STORAGE_KEY = 'necklace.sequence';

/** Round-half-up + clamp into a u8 [0,255]. */
export function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n);
  return r < 0 ? 0 : r > 255 ? 255 : r;
}

/** Clamp into a u32 [0, 4294967295], floored. */
export function clampU32(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = Math.floor(n);
  return r < 0 ? 0 : r > 0xffffffff ? 0xffffffff : r;
}

function clampRGB(value: unknown): RGB {
  if (Array.isArray(value)) {
    return [clampByte(Number(value[0])), clampByte(Number(value[1])), clampByte(Number(value[2]))];
  }
  return [0, 0, 0];
}

/** A fresh cue with sensible defaults, overridable via `partial`. */
export function makeCue(partial: Partial<Cue> = {}): Cue {
  return {
    effect: Effect.Solid,
    durationMs: 2000,
    colorA: [255, 255, 255],
    colorB: [0, 0, 255],
    param1: 100,
    param2: 128,
    brightness: 255,
    ...partial,
  };
}

/** Coerce arbitrary parsed JSON into a valid Cue (lenient: clamp, don't reject). */
export function sanitizeCue(raw: unknown): Cue {
  const c = (raw ?? {}) as Record<string, unknown>;
  const effect = Number(c.effect);
  return {
    effect: effect >= 0 && effect <= 3 ? (effect as Effect) : Effect.Solid,
    durationMs: clampU32(Number(c.durationMs)),
    colorA: clampRGB(c.colorA),
    colorB: clampRGB(c.colorB),
    param1: clampByte(Number(c.param1)),
    param2: clampByte(Number(c.param2)),
    brightness: clampByte(Number(c.brightness)),
  };
}

/** Coerce arbitrary parsed JSON into a valid Sequence. */
export function sanitizeSequence(raw: unknown): Sequence {
  const s = (raw ?? {}) as Record<string, unknown>;
  const cues = Array.isArray(s.cues) ? s.cues.map(sanitizeCue) : [];
  const pixelCount = Number(s.pixelCount);
  return {
    version: 1,
    pixelCount: Number.isFinite(pixelCount) && pixelCount > 0 ? Math.floor(pixelCount) : PIXEL_COUNT,
    cues,
    loop: typeof s.loop === 'boolean' ? s.loop : true, // default ON (matches device default)
  };
}

/** Starter sequence shown on first load. */
export function defaultSequence(): Sequence {
  return {
    version: 1,
    pixelCount: PIXEL_COUNT,
    loop: true,
    cues: [
      makeCue({ effect: Effect.Solid, durationMs: 3000, colorA: [255, 0, 0], colorB: [0, 0, 0], param1: 0, param2: 0 }),
      makeCue({ effect: Effect.Fade, durationMs: 4000, colorA: [255, 0, 0], colorB: [0, 0, 255], param1: 0, param2: 0 }),
      makeCue({ effect: Effect.Breathe, durationMs: 6000, colorA: [0, 120, 255], colorB: [0, 0, 0], param1: 120, param2: 0 }),
    ],
  };
}

export function loadSequence(): Sequence {
  if (typeof window === 'undefined') return defaultSequence();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSequence();
    return sanitizeSequence(JSON.parse(raw));
  } catch {
    return defaultSequence();
  }
}

export function saveSequence(seq: Sequence): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seq));
  } catch {
    /* ignore quota / private-mode write failures */
  }
}

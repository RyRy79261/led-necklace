import { Effect, PIXEL_COUNT, type Cue, type RGB, type Sequence } from '@/lib/types';

/** localStorage key the editor / remote surfaces persist the authored show under. */
export const SEQUENCE_STORAGE_KEY = 'necklace.sequence';

/**
 * Built-in demo sequence. Exercises all four v1 effects so the simulator is
 * useful with zero authoring and zero hardware.
 */
export const DEMO_SEQUENCE: Sequence = {
  version: 1,
  pixelCount: PIXEL_COUNT,
  cues: [
    // Solid magenta hold.
    {
      effect: Effect.Solid,
      durationMs: 2500,
      colorA: [255, 40, 90],
      colorB: [0, 0, 0],
      param1: 0,
      param2: 0,
      brightness: 255,
    },
    // Crossfade red -> blue.
    {
      effect: Effect.Fade,
      durationMs: 4000,
      colorA: [255, 0, 0],
      colorB: [0, 40, 255],
      param1: 0,
      param2: 0,
      brightness: 255,
    },
    // Slow green breathe (period = 150 * 10ms = 1500ms).
    {
      effect: Effect.Breathe,
      durationMs: 6000,
      colorA: [0, 255, 120],
      colorB: [0, 0, 0],
      param1: 150,
      param2: 0,
      brightness: 255,
    },
    // White strobe (period = 20 * 10ms = 200ms, ~50% duty).
    {
      effect: Effect.Strobe,
      durationMs: 3000,
      colorA: [255, 255, 255],
      colorB: [0, 0, 0],
      param1: 20,
      param2: 128,
      brightness: 255,
    },
    // Crossfade violet -> cyan at reduced per-cue brightness.
    {
      effect: Effect.Fade,
      durationMs: 4000,
      colorA: [120, 0, 255],
      colorB: [0, 200, 255],
      param1: 0,
      param2: 0,
      brightness: 220,
    },
  ],
};

export type SequenceSource = 'stored' | 'demo';

export interface LoadedSequence {
  sequence: Sequence;
  source: SequenceSource;
}

function clampByte(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0;
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function toRgb(v: unknown): RGB {
  if (Array.isArray(v) && v.length >= 3) {
    return [clampByte(v[0]), clampByte(v[1]), clampByte(v[2])];
  }
  return [0, 0, 0];
}

function toDurationMs(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0;
  return v < 0 ? 0 : v;
}

/**
 * Coerce loosely-typed JSON (whatever the editor wrote) into a valid Sequence.
 * Returns null when there is nothing playable. Lenient by design — this is the
 * offline preview loader, not the strict wire decoder.
 */
function normalizeSequence(input: unknown): Sequence | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  if (!Array.isArray(obj.cues)) return null;

  const cues: Cue[] = [];
  for (const raw of obj.cues) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    const effectNum =
      typeof c.effect === 'number' && c.effect >= 0 && c.effect <= 3
        ? c.effect
        : Effect.Solid;
    cues.push({
      effect: effectNum as Effect,
      durationMs: toDurationMs(c.durationMs),
      colorA: toRgb(c.colorA),
      colorB: toRgb(c.colorB),
      param1: clampByte(c.param1),
      param2: clampByte(c.param2),
      brightness: c.brightness === undefined ? 255 : clampByte(c.brightness),
    });
  }
  if (cues.length === 0) return null;

  const version = typeof obj.version === 'number' ? obj.version : 1;
  const pixelCount =
    typeof obj.pixelCount === 'number' ? obj.pixelCount : PIXEL_COUNT;
  return { version, pixelCount, cues };
}

/**
 * Load the authored sequence from localStorage ('necklace.sequence'), falling
 * back to the built-in demo. Safe to call on the server (returns the demo).
 */
export function loadSequence(): LoadedSequence {
  if (typeof window === 'undefined') {
    return { sequence: DEMO_SEQUENCE, source: 'demo' };
  }
  try {
    const raw = window.localStorage.getItem(SEQUENCE_STORAGE_KEY);
    if (raw) {
      const seq = normalizeSequence(JSON.parse(raw));
      if (seq) return { sequence: seq, source: 'stored' };
    }
  } catch {
    // Corrupt / unreadable storage — fall back to the demo below.
  }
  return { sequence: DEMO_SEQUENCE, source: 'demo' };
}

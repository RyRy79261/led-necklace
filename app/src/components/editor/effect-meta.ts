import { Effect } from '@/lib/types';

/**
 * Per-effect authoring metadata: which fields an effect actually consumes, and
 * the labels to show for the shared param1/param2 slots. Mirrors the semantics
 * in shared/DATA-MODEL.md section 3.
 */
export interface EffectMeta {
  value: Effect;
  label: string;
  blurb: string;
  usesColorB: boolean;
  usesParam1: boolean;
  usesParam2: boolean;
  param1Label: string;
  param2Label: string;
}

export const EFFECTS: EffectMeta[] = [
  {
    value: Effect.Solid,
    label: 'Solid',
    blurb: 'One colour, held for the full duration.',
    usesColorB: false,
    usesParam1: false,
    usesParam2: false,
    param1Label: 'Param 1',
    param2Label: 'Param 2',
  },
  {
    value: Effect.Fade,
    label: 'Fade',
    blurb: 'Crossfade from colour A to colour B across the duration.',
    usesColorB: true,
    usesParam1: false,
    usesParam2: false,
    param1Label: 'Param 1',
    param2Label: 'Param 2',
  },
  {
    value: Effect.Breathe,
    label: 'Breathe',
    blurb: 'Colour A with a sinusoidal brightness envelope.',
    usesColorB: false,
    usesParam1: true,
    usesParam2: false,
    param1Label: 'Period (×10 ms)',
    param2Label: 'Param 2',
  },
  {
    value: Effect.Strobe,
    label: 'Strobe',
    blurb: 'Colour A flashing on/off at a period + duty cycle.',
    usesColorB: false,
    usesParam1: true,
    usesParam2: true,
    param1Label: 'Period (×10 ms)',
    param2Label: 'Duty (0–255)',
  },
];

export function effectMeta(effect: Effect): EffectMeta {
  return EFFECTS.find((e) => e.value === effect) ?? EFFECTS[0];
}

/** STROBE period_ms = (param1==0 ? 100 : param1) * 10  — per DATA-MODEL.md. */
export function periodMs(param1: number): number {
  return (param1 === 0 ? 100 : param1) * 10;
}

/** Strobe duty as a fraction 0..1 (param2/255). */
export function dutyFraction(param2: number): number {
  return param2 / 255;
}

// BREATHE period is a 16-bit value split across param1 (low) + param2 (high), in 10 ms units,
// so it can go far slower than a single u8's 2.55 s. See DATA-MODEL.md section 3.
export const BREATHE_PERIOD_MIN_MS = 200;
export const BREATHE_PERIOD_MAX_MS = 60000;

/** BREATHE period (ms) decoded from its two byte slots: period_ms = (units==0?100:units)*10. */
export function breathePeriodMs(param1: number, param2: number): number {
  const units = (param1 & 0xff) | ((param2 & 0xff) << 8);
  return (units === 0 ? 100 : units) * 10;
}

/** Split a desired BREATHE period (ms) into the param1 (low) + param2 (high) byte slots. */
export function breatheParams(periodMs: number): { param1: number; param2: number } {
  const clamped = Math.min(BREATHE_PERIOD_MAX_MS, Math.max(10, Math.round(periodMs)));
  const units = Math.round(clamped / 10); // 1..6000
  return { param1: units & 0xff, param2: (units >> 8) & 0xff };
}

/**
 * Sensible param1/param2 defaults when an effect is (re)selected. The two byte slots mean
 * different things per effect (BREATHE now uses param2 as its period high byte, STROBE uses
 * it as duty), so reset them on switch to avoid a stale value corrupting the new effect.
 */
export function defaultParamsForEffect(effect: Effect): { param1: number; param2: number } {
  switch (effect) {
    case Effect.Breathe:
      return breatheParams(4000); // 4 s per breath
    case Effect.Strobe:
      return { param1: 50, param2: 128 }; // 500 ms period, ~50% duty
    default:
      return { param1: 0, param2: 0 };
  }
}

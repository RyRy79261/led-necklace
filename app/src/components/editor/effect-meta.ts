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

/** period_ms = (param1==0 ? 100 : param1) * 10  — per DATA-MODEL.md. */
export function periodMs(param1: number): number {
  return (param1 === 0 ? 100 : param1) * 10;
}

/** Strobe duty as a fraction 0..1 (param2/255). */
export function dutyFraction(param2: number): number {
  return param2 / 255;
}

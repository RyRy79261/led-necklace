import { Effect, PIXEL_COUNT, type Cue, type RGB } from '@/lib/types';

/**
 * Round-half-up with clamp to [0,255].
 * A tiny epsilon absorbs floating-point representation error so values that are
 * mathematically exactly x.5 (e.g. the breathe envelope at a quarter period,
 * where cos(pi/2) is 6.1e-17 instead of 0) round up as the contract intends.
 */
function round255(x: number): number {
  const r = Math.floor(x + 0.5 + 1e-9);
  if (r < 0) return 0;
  if (r > 255) return 255;
  return r;
}

/**
 * Render a cue at a given elapsed time to PIXEL_COUNT linear (pre-gamma) pixels.
 * All pixels share one colour in v1. See shared/DATA-MODEL.md section 3.
 */
export function renderCue(cue: Cue, elapsedMs: number): RGB[] {
  const bScale = cue.brightness / 255;
  const a = cue.colorA;
  const b = cue.colorB;
  let color: RGB;

  switch (cue.effect) {
    case Effect.Solid: {
      // env = 1
      color = [round255(a[0] * bScale), round255(a[1] * bScale), round255(a[2] * bScale)];
      break;
    }
    case Effect.Fade: {
      const f = cue.durationMs === 0 ? 1 : Math.min(1, Math.max(0, elapsedMs / cue.durationMs));
      color = [
        round255((a[0] * (1 - f) + b[0] * f) * bScale),
        round255((a[1] * (1 - f) + b[1] * f) * bScale),
        round255((a[2] * (1 - f) + b[2] * f) * bScale),
      ];
      break;
    }
    case Effect.Breathe: {
      const period = (cue.param1 === 0 ? 100 : cue.param1) * 10;
      const phase = (elapsedMs % period) / period;
      const env = (1 - Math.cos(2 * Math.PI * phase)) / 2; // 0 at phase 0, 1 at phase 0.5
      color = [
        round255(a[0] * bScale * env),
        round255(a[1] * bScale * env),
        round255(a[2] * bScale * env),
      ];
      break;
    }
    case Effect.Strobe: {
      const period = (cue.param1 === 0 ? 100 : cue.param1) * 10;
      const duty = cue.param2 / 255;
      const on = elapsedMs % period < duty * period;
      color = on
        ? [round255(a[0] * bScale), round255(a[1] * bScale), round255(a[2] * bScale)]
        : [0, 0, 0];
      break;
    }
    default: {
      color = [0, 0, 0];
      break;
    }
  }

  const frame: RGB[] = new Array(PIXEL_COUNT);
  for (let i = 0; i < PIXEL_COUNT; i++) frame[i] = [color[0], color[1], color[2]];
  return frame;
}

/**
 * Per-channel gamma correction: gamma8(v) = round(255 * (v/255)^2.2).
 * gamma8(0) = 0, gamma8(255) = 255.
 */
export function gamma8(v: number): number {
  const c = v < 0 ? 0 : v > 255 ? 255 : v;
  return round255(255 * Math.pow(c / 255, 2.2));
}

/**
 * Final display stage: scale by masterBrightness (linear domain) then gamma.
 * out = gamma8( round(linear * master / 255) ) per channel.
 */
export function applyDisplay(frame: RGB[], masterBrightness: number): RGB[] {
  const m = masterBrightness / 255;
  return frame.map(
    (px): RGB => [
      gamma8(round255(px[0] * m)),
      gamma8(round255(px[1] * m)),
      gamma8(round255(px[2] * m)),
    ],
  );
}

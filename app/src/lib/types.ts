export enum Effect { Solid = 0, Fade = 1, Breathe = 2, Strobe = 3 }
export type RGB = [number, number, number]; // each 0..255, linear (pre-gamma)
export interface Cue {
  effect: Effect;
  durationMs: number;
  colorA: RGB;
  colorB: RGB;
  param1: number;     // 0..255 — STROBE period / BREATHE period low byte
  param2: number;     // 0..255 — STROBE duty / BREATHE period high byte
  brightness: number; // 0..255
}
export interface Sequence {
  version: number;    // = 1
  pixelCount: number; // = 30
  cues: Cue[];
  loop?: boolean;     // when true, playback wraps at end instead of stopping (v2 loop flag)
}
export const PIXEL_COUNT = 30;
export const CUE_BYTES = 16;
export const HEADER_BYTES = 5;

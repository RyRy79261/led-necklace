// effects.h — reference effect engine (AUTHORITATIVE CONTRACT: shared/DATA-MODEL.md §3)
//
// renderCue returns LINEAR RGB (pre-gamma). In v1 every pixel is the same colour, so a
// single RGB is returned and the caller (Player) broadcasts it to all PIXEL_COUNT pixels.
// Rounding is round-half-up, clamp [0,255]. Bodies live in effects.cpp (build agents).
#pragma once

#include <stdint.h>
#include "seq.h"

// Render a cue at `elapsedMs` into its linear (pre-gamma) colour.
//   SOLID:   colorA * (brightness/255)
//   FADE:    lerp(colorA, colorB, clamp(elapsedMs/durationMs,0,1)) * (brightness/255)
//   BREATHE: colorA * (brightness/255) * (1 - cos(2*pi*phase))/2
//   STROBE:  on ? colorA * (brightness/255) : (0,0,0)
// masterBrightness and gamma are applied SEPARATELY, downstream (see Player / gamma8).
RGB renderCue(const Cue& cue, uint32_t elapsedMs);

// Final-stage gamma: gamma8(v) = round(255 * (v/255)^2.2). gamma8(0)=0, gamma8(255)=255.
uint8_t gamma8(uint8_t v);

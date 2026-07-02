// effects.cpp — reference effect engine + final-stage gamma
// (AUTHORITATIVE CONTRACT: shared/DATA-MODEL.md §3). Portable C++ (host + ESP32).
//
// renderCue returns LINEAR RGB (pre-gamma, pre-masterBrightness). Rounding is
// round-half-up, clamp [0,255]. Cross-checked byte-for-byte against
// shared/test-vectors.json → effects[].
#include "effects.h"
#include <cmath>

// π as a portable literal (M_PI is not guaranteed without _USE_MATH_DEFINES).
static const double PI_D = 3.14159265358979323846;

// round-half-up to [0,255]. The tiny epsilon absorbs floating-point error so that
// values that are mathematically an exact half (e.g. 255*(1-cos(π/2))/2 = 127.5,
// which cos() yields as 127.49999999999999) round UP as the contract specifies.
// The epsilon is far smaller than the ~0.1 gap to any genuine non-half value, so it
// only ever rescues near-exact-half results — matching test-vectors.json exactly.
static inline uint8_t roundClamp(double v) {
  double r = std::floor(v + 0.5 + 1e-9);
  if (r < 0.0)   r = 0.0;
  if (r > 255.0) r = 255.0;
  return (uint8_t)r;
}

RGB renderCue(const Cue& cue, uint32_t elapsedMs) {
  RGB out = {0, 0, 0};
  const double bScale = (double)cue.brightness / 255.0;

  switch (cue.effect) {
    case EFFECT_SOLID: {
      // env = 1 → pixel = colorA * bScale.
      out.r = roundClamp((double)cue.colorA.r * bScale);
      out.g = roundClamp((double)cue.colorA.g * bScale);
      out.b = roundClamp((double)cue.colorA.b * bScale);
      break;
    }

    case EFFECT_FADE: {
      // f = clamp(elapsed/duration, 0, 1); durationMs==0 ⇒ f=1.
      double f;
      if (cue.durationMs == 0) {
        f = 1.0;
      } else {
        f = (double)elapsedMs / (double)cue.durationMs;
        if (f < 0.0) f = 0.0;
        if (f > 1.0) f = 1.0;
      }
      out.r = roundClamp(((double)cue.colorA.r * (1.0 - f) + (double)cue.colorB.r * f) * bScale);
      out.g = roundClamp(((double)cue.colorA.g * (1.0 - f) + (double)cue.colorB.g * f) * bScale);
      out.b = roundClamp(((double)cue.colorA.b * (1.0 - f) + (double)cue.colorB.b * f) * bScale);
      break;
    }

    case EFFECT_BREATHE: {
      // 16-bit period: units = param1 | (param2<<8), in 10ms steps (0 => 100). Lets a breathe
      // run far slower than the 2.55s a single u8 allowed. (STROBE still uses param1 only +
      // param2 as duty.) period_ms = (units==0?100:units)*10; env = (1 - cos(2π·phase))/2.
      uint32_t units  = (uint32_t)cue.param1 | ((uint32_t)cue.param2 << 8);
      uint32_t period = (units == 0 ? 100u : units) * 10u;
      double phase = (double)(elapsedMs % period) / (double)period;
      double env   = (1.0 - std::cos(2.0 * PI_D * phase)) / 2.0;
      out.r = roundClamp((double)cue.colorA.r * bScale * env);
      out.g = roundClamp((double)cue.colorA.g * bScale * env);
      out.b = roundClamp((double)cue.colorA.b * bScale * env);
      break;
    }

    case EFFECT_STROBE: {
      // period = (param1==0?100:param1)*10 ms; on while (elapsed mod period) < duty·period.
      uint32_t period = (uint32_t)(cue.param1 == 0 ? 100 : cue.param1) * 10u;
      double duty = (double)cue.param2 / 255.0;
      bool on = (double)(elapsedMs % period) < duty * (double)period;
      if (on) {
        out.r = roundClamp((double)cue.colorA.r * bScale);
        out.g = roundClamp((double)cue.colorA.g * bScale);
        out.b = roundClamp((double)cue.colorA.b * bScale);
      }
      // else stays (0,0,0)
      break;
    }

    default:
      // Unknown / reserved effect (v2 CHASE/PALETTE not implemented) → blackout.
      break;
  }

  return out;
}

// Final-stage gamma: gamma8(v) = round(255 * (v/255)^2.2).
// Naturally exact at the endpoints: gamma8(0)=0, gamma8(255)=255.
uint8_t gamma8(uint8_t v) {
  double f = std::pow((double)v / 255.0, 2.2);
  double r = std::floor(255.0 * f + 0.5 + 1e-9);
  if (r < 0.0)   r = 0.0;
  if (r > 255.0) r = 255.0;
  return (uint8_t)r;
}

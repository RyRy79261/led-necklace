# Data Model & Effect Semantics — AUTHORITATIVE CONTRACT

Both the app (TypeScript) and the firmware (C++) implement this **exactly**. When in
doubt, `test-vectors.json` is the tie-breaker. Signatures here are **frozen** — implement
the bodies, do not change the exported shapes.

Design rule from the user: **keep it dead simple.** A sequence is an ordered list of
cues. Auto mode walks them on a timer; manual mode advances one cue per NEXT press.
No music/beat sync. That's it.

---

## 1. Types

### Effect enum (u8 on the wire)
```
0 = SOLID    // one colour, held
1 = FADE     // crossfade colorA -> colorB across the cue's duration
2 = BREATHE  // colorA with a sinusoidal brightness envelope
3 = STROBE   // colorA flashing on/off at a frequency + duty cycle
```
v2 (reserved, do NOT implement now): 4=CHASE, 5=PALETTE.

### Cue — fixed 16 bytes on the wire (little-endian)
| field        | type | bytes | meaning |
|--------------|------|-------|---------|
| effect       | u8   | 1     | Effect enum |
| durationMs   | u32  | 4     | how long the cue is held in AUTO mode |
| colorA (rgb) | u8×3 | 3     | primary colour, order R,G,B |
| colorB (rgb) | u8×3 | 3     | secondary colour (FADE only; else ignored) |
| param1       | u8   | 1     | STROBE period (units of 10 ms, period_ms=param1×10). BREATHE: **low byte** of a 16-bit period (see §3) |
| param2       | u8   | 1     | STROBE duty cycle 0..255 (fraction = param2/255). BREATHE: **high byte** of the 16-bit period (§3). unused for SOLID/FADE |
| brightness   | u8   | 1     | per-cue max brightness 0..255 |
| reserved     | u8×2 | 2     | zero-filled |

**TypeScript (`src/lib/types.ts` — scaffold writes this verbatim):**
```ts
export enum Effect { Solid = 0, Fade = 1, Breathe = 2, Strobe = 3 }
export type RGB = [number, number, number]; // each 0..255, linear (pre-gamma)
export interface Cue {
  effect: Effect;
  durationMs: number;
  colorA: RGB;
  colorB: RGB;
  param1: number;     // 0..255
  param2: number;     // 0..255
  brightness: number; // 0..255
}
export interface Sequence {
  version: number;    // = 1
  pixelCount: number; // = 30
  cues: Cue[];
}
export const PIXEL_COUNT = 30;
export const CUE_BYTES = 16;
export const HEADER_BYTES = 5;
```

**C++ (`firmware/lib/seq/seq.h` — scaffold writes struct + decls):**
```cpp
enum Effect : uint8_t { EFFECT_SOLID=0, EFFECT_FADE=1, EFFECT_BREATHE=2, EFFECT_STROBE=3 };
struct RGB { uint8_t r, g, b; };
struct Cue {
  uint8_t  effect;
  uint32_t durationMs;
  RGB      colorA;
  RGB      colorB;
  uint8_t  param1;
  uint8_t  param2;
  uint8_t  brightness;
};
static const uint16_t PIXEL_COUNT = 30;
static const uint8_t  CUE_BYTES   = 16;
static const uint8_t  HEADER_BYTES= 5;
```

---

## 2. Sequence binary format (little-endian)

```
Header (5 bytes):
  [0]     version  u8   (=1)
  [1..2]  pixelCount u16 (=30)
  [3..4]  cueCount u16
Then cueCount × Cue (16 bytes each), layout per the table above.
Total = 5 + 16*cueCount bytes.
```
See `test-vectors.json` → `codec` for a worked hex example. Reject on decode if:
version≠1, or byte length ≠ 5+16*cueCount, or pixelCount≠30 (warn, still play).

---

## 3. Effect engine — the reference math

`renderCue(cue, elapsedMs) -> RGB[PIXEL_COUNT]` returns **linear** RGB (pre-gamma).
All 30 pixels get the same colour in v1 (no per-pixel spatial effects yet).

Let `bScale = cue.brightness / 255`. Channel scaling is `round(channel * bScale * env)`
where `env` depends on the effect. **Rounding is round-half-up.** Clamp to [0,255].

- **SOLID**: `env = 1`. pixel = colorA * bScale.
- **FADE**: `f = clamp(elapsedMs / durationMs, 0, 1)`; pixel channel =
  `round( (colorA_ch*(1-f) + colorB_ch*f) * bScale )`. (Linear RGB lerp; perceptual
  nicety deferred.) If durationMs==0, f=1.
- **BREATHE**: `units = param1 | (param2<<8)` (16-bit, in units of 10 ms — lets a breathe run
  far slower than a single u8's 2.55 s max); `period = (units==0?100:units)*10` ms;
  `phase = (elapsedMs mod period) / period`;
  `env = (1 - cos(2π*phase)) / 2`  → env=0 at phase 0, env=1 at phase 0.5.
  pixel = colorA * bScale * env. Backward-compatible: an old cue with `param2==0` gives the
  same period as before. (STROBE below still uses param1 as period + param2 as duty.)
- **STROBE**: `period = (param1==0?100:param1)*10` ms; `duty = param2/255`;
  `on = (elapsedMs mod period) < duty*period`;
  pixel = on ? (colorA * bScale) : (0,0,0).

### Gamma — applied as a SEPARATE final stage (not inside renderCue)
`gamma8(v) = round(255 * (v/255)^2.2)`. Exactly: gamma8(0)=0, gamma8(255)=255.
Display pipeline (both canvas preview AND LED output):
`out = gamma8( renderCue(...) * (masterBrightness/255) )` per channel.
`masterBrightness` (0..255) is a runtime global set by the remote / BLE SET_BRIGHTNESS,
default 255. Applied in the linear domain, before gamma.

Test vectors assert **renderCue linear output** exactly, and gamma only at its endpoints,
so gamma-curve rounding differences never break the cross-check.

---

## 4. Player / transport state machine (`src/lib/player.ts` + `firmware/lib/player`)

```
state = { sequence, mode: 'auto'|'manual', currentCue: int, cueStartMs: int, playing: bool }
```
- `play(mode)`  → mode set, currentCue=0, cueStartMs=now, playing=true.
- `stop()`      → playing=false (output blackout).
- `next()`      → currentCue+1, cueStartMs=now. If past last cue → stop() (v1: no loop).
- `prev()`      → currentCue-1 (min 0), cueStartMs=now.
- `goto(i)`     → currentCue=clamp(i), cueStartMs=now.
- `tick(now)`   → if !playing return blackout.
    elapsed = now - cueStartMs.
    if mode=='auto': **WHILE** (playing and elapsed >= cue.durationMs) { next(); elapsed = now - cueStartMs }.
      next() re-stamps cueStartMs=now, so elapsed resets to 0 after each advance — the loop
      therefore only iterates past **zero-duration cues** (which are skipped, never shown) and
      stops at end-of-sequence. Both implementations MUST use this loop form (not a single
      `if`) so they stay byte-identical on sequences containing 0 ms cues.
    return display-pipeline frame for currentCue at elapsed.
- **Clock note:** if an implementation's transport methods can't take `now` (frozen no-arg
  signatures), anchor cueStartMs to the latest tick timestamp AND rebase on the very first
  tick, so a command issued before the clock has started cannot skip cue 0.
- Manual mode: `tick` NEVER auto-advances; the held cue keeps animating (breathe/strobe
  still move because they use `elapsed`). NEXT is the only way forward.
- End-of-sequence in auto ⇒ stop + blackout. (Looping is a v2 flag.)

This exact state machine is shared: firmware runs it at 30–60 FPS; the app runs it to
drive the canvas preview and (via MockTransport) the simulated device.

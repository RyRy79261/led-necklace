# LED Necklace — Locked Decisions & Build Plan

> Companion to the technical brief. Captures what was resolved in the spec-review
> session so the next session doesn't re-derive it. Hardware: Seeed XIAO ESP32-C3,
> 30× WS2812B (3×10 chained), button on D2, LiPo on BAT. It's a **necklace worn
> against the body** — mechanical/safety matters.

## Locked decisions (from user, this session)

1. **Build custom** (not WLED). Needs a **self-timed auto timeline** (NO beat/music
   sync — see scope note below) AND **slide-style manual cue-advance**. WLED can't do
   this (no BLE, weak manual cueing). → WLED = one-afternoon **hardware-validation** rig.
2. **iOS + Android both** → **Capacitor-native BLE** (`@capacitor-community/bluetooth-le`).
   No plain Web Bluetooth PWA as the shipped product.
3. **Phone-app-only live trigger.** No ESP-NOW remote. → **Firmware is BLE-only.**
   This removes the Wi-Fi/BLE coexistence problem entirely (one radio, one stack).

## Consequence of "BLE-only live trigger" — design around it

- **Auto mode is drop-proof:** board plays the timeline autonomously; phone only needs
  a live link at the *instant of START*. BLE can die after that and the show finishes.
- **Manual mode is the fragile path:** every cue-advance needs a live link. Give each
  manual cue a **max-hold timeout that auto-advances / resumes the timeline** so a link
  drop degrades to "show keeps going," not "performer freezes."
- **Physical button carries the fallback** (no hardware remote behind it). It's on the
  performer, so: start/stop + emergency, not primary cueing. Own always-active path,
  debounced, watchdog-protected. Button = D2 = GPIO4.

## Corrections to the brief (apply these)

- **Pins are safe — research Q#5 is closed.** XIAO C3: `D6 = GPIO21` (data),
  `D2 = GPIO4` (button). Strapping pins GPIO2/8/9 = silkscreen D0/D8/D9, both avoided.
  (GPIO21 is UART0 TX; use USB-CDC for console.) Verify on silkscreen when board in hand.
- **WS2812B voltage floor, not "warmth," is the LiPo-direct limit.** VDD spec ~3.5–5.3V;
  below ~3.5V expect flaky data/dropout, NOT just warmer whites. **Cut off at ~3.5V** —
  keeps LEDs in-spec AND protects the cell from deep-discharge (two birds).
- **Add LiPo protection + inline fuse/PTC.** Worn against skin → use a **protected cell**
  and fuse the battery line. Brief adds a switch + cap but no fuse. Only place it's
  under-cautious.
- **Flicker fix is "use RMT driver," not "avoid Wi-Fi."** BLE interrupts jitter bit-banged
  timing too. Use FastLED RMT (or NeoPixel RMT). 30px = huge headroom on the C3.
- **Apply gamma curve** to breathe/fade envelopes or they look wrong to the eye.

## Trim these (brief over-engineers)

- **Upload protocol:** you're a *segment player*, not a frame store. A 10-min show ≈ 1–4KB
  (~50 segments × ~20B) = ~6 BLE writes at MTU 185. Simple `BEGIN/CHUNK×N/END + CRC + ACK`
  is enough. **Resume-on-disconnect is v2**, not v1.
- **Battery capacity is not the binding constraint** (show is 10 min). The C3 radio draws
  ~80–130mA — can rival the LEDs at prop brightness. Measure *whole-system idle incl radio*;
  size the cell for shows-between-charges + wearable form factor, not 10-min runtime.
- **Define the layering model:** brief leaves segment overlap/blend undefined. Decide
  **single-track per target for v1** (sequential, simple), layered/composited for v2.
  Also pin down loop-vs-play-once end behavior + how global brightness cap composes.

## Build order

1. **Bench (WLED, ~1 afternoon):** validate power-on-LiPo, pins, real current draw, and
   how effects look *on the necklace*. Then set WLED aside.
2. **Write the protocol contract FIRST** (long pole): BLE service/characteristics, the
   segment binary format, and the command set (start/stop/advance/jump/blackout/brightness).
   Both firmware and app build against it.
3. **Three parallel tracks:**
   - **Firmware** — autonomous player, NimBLE, RMT effects, robust button + cue-hold timeouts.
   - **App** — timeline editor + browser strip preview + chunked uploader + live remote
     (big START / BLACKOUT, brightness, cue-advance, auto-reconnect + device indicator).
   - **Hardware/mechanical** — necklace build, protected LiPo + fuse, strain relief on
     flexing solder joints, LED diffusion, detachable connector (JST), hard power switch.

## Fan-out buckets (when we do research it)

- **Bench-answerable (use hardware, not agents):** pins, power path on battery, current
  draw, WLED effect fidelity, flicker.
- **Agent-researchable:** iOS BLE foreground/background behavior with
  `@capacitor-community/bluetooth-le`; Capacitor + Next.js static-export constraints;
  chunked-BLE-transfer reference impls on ESP32; NimBLE service patterns.
- **Human-only (get from the performer):** exact show content + how tight the music sync is.

## Still open for the user

- How far off-stage is the operator, and is the ~10m BLE range + venue 2.4GHz congestion
  acceptable? (Accepted BLE-only for now; revisit if range testing fails.)
- Necklace physical form: strip layout, diffusion, how the LiPo/board are carried/concealed.

## Scope simplification (session 2) — "keep it fucking simple"

NO beat/music sync. A sequence is an **ordered list of cues**; each cue =
`{effect, color(s), params, duration_ms}`. Two playback modes off the SAME list:
- **Auto:** hit play → walk the list on each cue's duration → done.
- **Manual:** hit play → hold cue 1; **NEXT** → advance one cue (slide-style).

Ladder of wins: (1) phone press → light on. (2) play-through a sequence. (3) NEXT
advances a cue. That's v1. Everything else is later.

## How far without hardware (~75% of the software, buildable NOW)

Buildable now (no board):
- **Whole app** (Capacitor + Next.js **static export** — client-only): editor
  (cue-list CRUD, pick effect/color/duration, reorder), **browser LED preview = the
  simulator** (canvas of 30 px running the REAL effect math), live remote
  (START / NEXT / BLACKOUT / brightness). App is fully usable + demoable in a browser
  with zero hardware.
- **Shared contract:** sequence binary format + BLE command set + test vectors.
- **Firmware LOGIC:** effect engine (solid/fade/breathe/strobe + gamma) + player state
  machine + protocol codec, written as **portable C++ that also compiles on host**
  (PlatformIO `native` env + Unity tests). Round-trip test: app-encoded bytes →
  firmware decoder → identical cue list.

Waits for hardware (tomorrow+): RMT WS2812B output + flicker, real NimBLE radio
(pair/range/reconnect), power on LiPo, pin/strapping confirm, on-device flash+integration.
→ Hardware day becomes mostly **integration**, not from-scratch coding.

## Agent plan

**1 foundation pass FIRST** (do NOT fan out onto an empty repo — agents collide on
scaffolding): contract + repo scaffold (`/app`, `/firmware`, `/shared`) + data model +
effect math as the reference impl. Then **4 parallel agents** (worktree-isolated):
- **A** — app editor: TS data model + cue-list UI + save/load sequence JSON.
- **B** — app preview + effect engine (TS): canvas simulator + transport (play/next).
- **C** — app live-remote + BLE client (`@capacitor-community/bluetooth-le`) with a
  **mock transport** so it fully works without a board.
- **D** — firmware: portable-C++ engine+player+protocol codec + host unit tests.
  (Split D into engine/player + ble/protocol → 5 agents if going wide.)

## Build status — session 2 (workflow + fixes complete)

Monorepo built by a 13-agent workflow against the frozen `shared/` contract.

VERIFIED with no hardware:
- **App** (`app/`, Next 14 + Capacitor 6, static export): typecheck clean, **44/44 vitest**
  (incl. golden vectors), `next build` static export OK. Three live surfaces:
  `/editor` (cue-list authoring + JSON import/export + localStorage), `/preview`
  (30-px **browser simulator** — the no-hardware demo), `/remote` (START/NEXT/BLACKOUT +
  brightness, MockTransport **and** real Capacitor BLE transport, auto-reconnect).
- **Firmware logic** (`firmware/lib/`): real PlatformIO **native Unity suite 27/27** against
  the SAME golden vectors (codec, effects, player). Portable C++, compiles clean.
- **Firmware device** (`firmware/src/main.cpp`): FastLED RMT on GPIO21, debounced button
  GPIO4, NimBLE service (CMD/UPLOAD/STATUS), chunked upload → LittleFS + CRC, boot-load,
  FastLED current cap (setMaxPowerInVoltsAndMilliamps 5V/1500mA, default brightness 160).
  **Device compile passes** (`pio run -e seeed_xiao_esp32c3`): RAM 11.9%, Flash 42.2% on the C3.

Adversarial-review fixes applied (4/4, 0 high):
- Player auto-advance: firmware `if`→`while` to match app; contract §4 pinned to loop form
  (zero-duration cues are skipped, never shown) so the two engines stay byte-identical.
- `player.ts`: rebase clock on first tick so a `play()` issued before the clock starts
  can't skip cue 0 (matches firmware's real-`now` stamping).
- `codec.ts`: always encode fixed `pixelCount=30` (byte-parity with firmware).
- BLE wire layer: reviewer found no divergences.

Device-compile fixes (found by actually running `pio run`, not by the review):
- `main.cpp`: our `struct RGB` collided with FastLED's `EOrder::RGB` enumerator — fixed by
  including the engine headers before FastLED.h + using the elaborated `struct RGB` form.
- Dropped a deprecated NimBLE 2.x `service->start()` no-op.

REMAINING (hardware day — needs the board):
- Flash, wire 30 px, power from LiPo, confirm the power-path fix works on battery.
- Real on-board checks: BLE pair/range/reconnect on the C3, RMT LED output/flicker,
  button, upload → LittleFS end-to-end.
- Wire the editor's "Upload to device" button to a live BleTransport (Mock-ready today).
- Mechanical: protected LiPo + fuse, strain relief on flexing joints, LED diffusion.

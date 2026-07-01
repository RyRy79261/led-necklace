# LED Necklace — Firmware

Autonomous cue player for a **Seeed XIAO ESP32-C3** driving **30× WS2812B** (3×10 chained),
with a physical button and a BLE control/upload link. The board plays timelines on its own;
the phone app only needs a link at the moment of a command (see `../docs/PLAN.md`).

Framework: Arduino (ESP32). BLE: NimBLE-Arduino. LEDs: FastLED (RMT driver).

## Layout

```
firmware/
  platformio.ini        two envs: seeed_xiao_esp32c3 (target) + native (host tests)
  src/main.cpp          hardware wiring: FastLED, button, LittleFS, NimBLE (STUB)
  lib/seq/              sequence types + binary codec + crc32   (portable C++)
  lib/effects/          reference effect engine + gamma          (portable C++)
  lib/player/           transport state machine                  (portable C++)
  test/                 Unity host tests (native env)
```

The `lib/` engine is **portable C++** — no Arduino dependency — so it builds and is
unit-tested on the host and cross-checks against `../shared/test-vectors.json`. All three
`shared/` contract docs (DATA-MODEL, PROTOCOL, test-vectors) are authoritative and frozen.

## Build (target)

```
pio run -e seeed_xiao_esp32c3          # compile
pio run -e seeed_xiao_esp32c3 -t upload
pio device monitor -b 115200
```

## Test (host, no hardware)

```
pio test -e native
```

Runs the Unity suite against the portable engine. `src/main.cpp` is excluded from this
build (`#ifndef NATIVE`) because there is no Arduino runtime on the host.

## Pin notes

| Silkscreen | GPIO | Use | Notes |
|-----------|------|-----|-------|
| D6 | GPIO21 | WS2812B data | non-strapping (also UART0 TX — use USB-CDC console) |
| D2 | GPIO4  | button       | non-strapping; `INPUT_PULLUP`, debounced |

Strapping pins GPIO2/8/9 (silkscreen D0/D8/D9) are deliberately avoided. Pins set via
`build_flags` in `platformio.ini` (`-DLED_PIN=21 -DBUTTON_PIN=4`). Confirm on the
silkscreen when the board is in hand.

## Power

**LiPo-direct** (cell → BAT, no boost). WS2812B VDD spec is ~3.5–5.3V, so **cut off at
~3.5V**: below that the LEDs get flaky data/dropout (not just warmer whites), and the
cutoff also protects the cell from deep-discharge. Use a **protected cell + inline
fuse/PTC** — it's worn against skin. Full rationale in `../docs/PLAN.md`.

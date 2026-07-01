# LED Necklace

A battery-powered wearable **stage prop**: 30 addressable LEDs (WS2812B) on a necklace,
driven by a Seeed XIAO **ESP32-C3**. A performer wears it; an operator off-stage triggers a
pre-authored lighting sequence — or advances cues live — from a phone over **Bluetooth LE**.

The governing constraint is **live-show reliability**. The sequence is uploaded once and
plays **autonomously on the board** (no live phone connection needed during the show), with a
**physical button** as the last-resort fallback.

## Repo layout (monorepo)

| Path | What |
|---|---|
| [`app/`](app/) | Next.js + Capacitor app — the **editor**, a browser **simulator**, and the live **remote** (iOS / Android / web). |
| [`firmware/`](firmware/) | PlatformIO / ESP32-C3 firmware — the autonomous sequence **player** + BLE server + LED driver. |
| [`shared/`](shared/) | The **authoritative contract** both sides implement: data model, BLE protocol, golden test vectors. |
| [`docs/`](docs/) | Architecture, hardware build, deployment, and the decisions/status log. |

## Quick start (no hardware needed)

```bash
cd app
npm install
npm run dev          # http://localhost:3000
```

- **`/editor`** — author a sequence: an ordered list of cues (effect + colour + duration).
- **`/preview`** — watch it play on a 30-pixel **simulator** in the browser.
- **`/remote`** — drive a **simulated board** (Mock mode): START / NEXT / BLACKOUT / brightness.

### Tests

```bash
cd app      && npm test                          # 44 tests, incl. the golden contract vectors
cd firmware && pio test -e native                # 27 tests, the same vectors, in C++
cd firmware && pio run -e seeed_xiao_esp32c3     # compile the device firmware
```

## The model in one paragraph

You author a **sequence** (a list of cues) in the app. It's encoded to a compact binary blob
and **uploaded over BLE** to the board, which stores it in flash and **plays it autonomously**.
Two playback modes come off the same list: **auto** (each cue held for its duration) and
**manual** (operator presses **NEXT** to advance, slide-style). Any of three triggers —
phone (BLE), physical button, or the auto timer — can start / stop / advance. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Status

The software is **built and verified with no hardware**: app typecheck + 44 tests, firmware
native 27 tests (cross-checked against the *same* golden vectors as the app), and a clean
ESP32-C3 device compile. What remains is the physical build and on-board bring-up.
Full decisions log and remaining tasks: **[docs/PLAN.md](docs/PLAN.md)**.

## Documentation

- **[Architecture](docs/ARCHITECTURE.md)** — how app, contract, and firmware fit together.
- **[Hardware](docs/HARDWARE.md)** — wiring, pins, power, BOM, the necklace build & safety.
- **[Deployment](docs/DEPLOY.md)** — Vercel (web) and Capacitor (iOS / Android).
- **[Plan & decisions](docs/PLAN.md)** — why each call was made; what's left.
- **Contract:** [data model + effects](shared/DATA-MODEL.md) · [BLE protocol](shared/PROTOCOL.md) · [test vectors](shared/test-vectors.json)
- **Sub-project READMEs:** [app](app/README.md) · [firmware](firmware/README.md)

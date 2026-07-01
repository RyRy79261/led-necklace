# Hardware

> Status: **design, not yet built.** Pins and firmware are fixed; the physical build and
> on-board bring-up are the remaining work. Values below are the intended build.

**Form factor:** the 30 LEDs are a rigid **3 × 10 panel** — 3 vertical strips of 10, chained
DIN→DOUT, mounted side-by-side as columns (think a small LED matrix worn on the front of the
body), **not** a draped necklace. The pixel index maps as strip (column) = `floor(i / 10)`,
row = `i % 10`, top → bottom.

## Bill of materials

| Part | Notes |
|---|---|
| Seeed **XIAO ESP32-C3** | Wi-Fi + BLE 5, RISC-V, onboard USB-C LiPo charging. |
| **WS2812B** LEDs ×30 | 3 strips × 10, daisy-chained on one data line. GRB order. |
| **LiPo cell (protected)** | Single cell, 3.7 V nominal. Use a cell with a built-in protection PCM. |
| Momentary button | Start/stop + mode. |
| **Inline fuse / PTC** | On the battery +. Resettable PTC (~2 A hold) is fine. |
| Hard power switch | On the battery line. |
| 330–470 Ω resistor | In series on the data line at the first pixel. |
| ~1000 µF capacitor | Across the strip's +/– near the power injection point. |
| JST-SM connector | Detachable link between board and strips (it's a prop that gets packed). |

## Pinout (XIAO ESP32-C3)

| Function | Silkscreen | GPIO | Notes |
|---|---|---|---|
| LED data | **D6** | **GPIO21** | Non-strapping. `#define LED_PIN 21` in `platformio.ini`. |
| Button | **D2** | **GPIO4** | Non-strapping. `INPUT_PULLUP`, other side to GND. `#define BUTTON_PIN 4`. |

Both chosen pins deliberately avoid the C3's **strapping pins (GPIO2, GPIO8, GPIO9 = D0, D8,
D9)**, which can block boot/flash if held. GPIO21 is also UART0 TX — fine, since logging goes
over native USB-CDC. **Verify against the silkscreen when the board is in hand.**

## Wiring

```
        LiPo(+) ──[ switch ]──[ fuse/PTC ]──┬── XIAO BAT+
                                            └── strip +5V rail ──┬─[ 1000µF ]─ strip GND
        LiPo(–) ─────────────────────────────── XIAO GND ───────┴──────────── strip GND

        XIAO D6 (GPIO21) ──[ 330–470Ω ]── strip-1 DIN
                                           strip-1 DOUT ── strip-2 DIN ── strip-3 DIN (chain)

        XIAO D2 (GPIO4) ── button ── GND
```

## Power — the single most important detail

**Power the LED strip directly from the LiPo (~3.7–4.2 V), NOT from the XIAO `5V` pin.** The
`5V` pin is USB-VBUS passthrough — it outputs nothing on battery, so a `5V → strip` wiring
works on your desk over USB and dies the instant you unplug. LiPo-direct also means the 3.3 V
data line is comfortably above the WS2812B logic threshold (0.7 × VDD), so **no level shifter
is needed**.

- **Low-voltage cutoff at ~3.5 V.** WS2812B are only in-spec down to ~3.5 V (below that:
  flaky data, wrong colours) — and 3.5 V also protects the LiPo from damaging deep discharge.
  One threshold, two wins. (No cutoff is implemented in firmware yet — it needs a battery-sense
  ADC divider; see remaining tasks.)
- **Current cap.** All-white/full-bright 30 px ≈ 1.8 A — never used at prop brightness, but it
  sets wire gauge. Firmware caps it two ways: per-cue + master brightness (default 160/255) and
  FastLED's `setMaxPowerInVoltsAndMilliamps(5, 1500)`.
- **Runtime is not the constraint** (a 10-min show is short); size the cell for shows-between-
  charges and comfortable wear. Note the ESP32-C3 radio draws ~80–130 mA, which can rival the
  LEDs at low brightness — measure whole-system draw, not just the strip.

## Safety (it's worn against a body)

- Use a **protected LiPo** and an **inline fuse/PTC** — a short in a worn cell is a burn risk.
- Mechanically protect the cell (no bare pouch that can be crushed/flexed/punctured).
- **Mount the strips to the rigid panel** and **strain-relieve the cable where it exits the
  panel** — the panel itself doesn't flex, but the lead to the board/battery gets tugged during
  wear and packing. A detachable JST-SM link at the panel edge saves the joints.
- Diffuse the LEDs (raw WS2812B are harsh point sources) for a better stage look.

## Bring-up checklist (hardware day)

1. Flash: `cd firmware && pio run -e seeed_xiao_esp32c3 -t upload`.
2. Confirm 30 px light and data is clean (series resistor + cap in place).
3. **Unplug USB** and confirm it still runs on battery (proves the power-path fix).
4. Button: short = start/stop, long = auto/manual toggle.
5. BLE: connect from the app, confirm STATUS updates, upload a sequence, power-cycle, confirm
   it replays from flash.
6. Range-test BLE from where the operator will actually stand.

# Architecture

## The core idea: store-and-play, not stream

A phone can't be trusted to feed a light show frame-by-frame over BLE on stage — the link is
low-bandwidth and drops. So the board is an **autonomous player**, not a live renderer:

1. The app **authors** a sequence and **uploads** it once over BLE.
2. The board stores it in flash and **plays it itself**, needing no connection during the show.
3. Live control (start / next / blackout / brightness) is small, occasional **commands** —
   never a frame stream.

This is why a Bluetooth hiccup mid-show is survivable: in **auto** mode the phone is only
needed at the instant of START; after that the board runs the whole show on its own.

```
┌─────────────────────────── app/ (Next.js + Capacitor) ───────────────────────────┐
│  /editor  ──author──►  Sequence ──encodeSequence()──►  bytes                       │
│  /preview ──simulate──►  Player + effects  (renders 30 px on a <canvas>)           │
│  /remote  ──control──►  Command ──encodeCommand()──►  bytes                        │
└───────────────────────────────────────────┬───────────────────────────────────────┘
                                             │  BLE (Capacitor / Web Bluetooth)
        upload: BEGIN/CHUNK/END + CRC32      │  commands: 1–3 byte writes
        status: 7-byte notify  ◄─────────────┤
                                             ▼
┌─────────────────────────── firmware/ (ESP32-C3) ────────────────────────────────┐
│  NimBLE server ──► queue ──► Player (lib/player) ──► effects (lib/effects) ──►     │
│  decodeSequence (lib/seq) ──► LittleFS /seq.bin        FastLED RMT ──► 30× WS2812B │
│  physical button (GPIO4) ─────────────────────────────────┘ (independent path)    │
└───────────────────────────────────────────────────────────────────────────────────┘
```

## The contract is the load-bearing wall

`shared/` is the single source of truth that **both** the TypeScript app and the C++ firmware
implement. It is frozen; both sides are tested against it.

- **[shared/DATA-MODEL.md](../shared/DATA-MODEL.md)** — the `Cue`/`Sequence` types, the 16-byte
  binary cue layout, the effect math (solid / fade / breathe / strobe + gamma), and the player
  state machine.
- **[shared/PROTOCOL.md](../shared/PROTOCOL.md)** — the BLE GATT service, command opcodes,
  chunked-upload framing, and the status notification.
- **[shared/test-vectors.json](../shared/test-vectors.json)** — golden inputs → expected bytes
  and pixels. **The app's Vitest suite and the firmware's native Unity suite both assert against
  this same file.** That's how two independently-written engines stay bit-identical.

If you change behaviour, change the contract + vectors first, then make both sides pass.

## App (`app/`)

Static-exported Next.js (App Router) wrapped by Capacitor. Three surfaces, one shared core.

**Core logic (`src/lib/`)** — the reference implementation, framework-free and unit-tested:
- `types.ts` — `Effect`, `RGB`, `Cue`, `Sequence` (verbatim from the contract).
- `codec.ts` — `encodeSequence` / `decodeSequence` (little-endian) + `crc32` (IEEE 802.3).
- `effects.ts` — `renderCue` (linear RGB), `gamma8`, `applyDisplay` (master-brightness + gamma).
- `player.ts` — the `Player` state machine (play / stop / next / prev / goto / tick).
- `ble.ts` — the `Transport` interface with two implementations (see below).

**Surfaces:**
- `src/app/editor/` — author cues; persists to `localStorage`, imports/exports JSON.
- `src/app/preview/` — a `<canvas>` **simulator** running the real `Player` + effects at 60 fps.
- `src/app/remote/` — the live console (START / NEXT / BLACKOUT / brightness, connection UI).

**Two transports, one interface** (`ble.ts`):
- `MockTransport` — drives a local `Player` and round-trips real command/status bytes, so the
  remote works fully **with no board**.
- `BleTransport` — `@capacitor-community/bluetooth-le`: scan by service UUID, MTU negotiation,
  write CMD/UPLOAD, subscribe to STATUS. Same interface, so the UI doesn't care which is live.

## Firmware (`firmware/`)

- **`lib/seq`, `lib/effects`, `lib/player`** — portable C++ mirrors of the app's core. They
  include no Arduino headers, so they compile on the host and run under the native test suite.
- **`src/main.cpp`** — the device glue (excluded from native builds): FastLED RMT driver,
  debounced button, NimBLE GATT server, chunked-upload reassembly → CRC → LittleFS, and the
  ~60 fps render loop.
- **`test/`** — the native Unity suite, transcribing the golden vectors as C++ literals.

**Concurrency:** NimBLE callbacks run on the BLE host task and never touch the `Player`
directly — commands go through a FreeRTOS queue and uploads fill a buffer with a commit flag.
**All** player mutation happens in `loop()` (single writer), so the button path stays fully
independent of the BLE stack.

## Reliability model (why it survives a stage)

| Failure | What saves the show |
|---|---|
| Phone BLE drops mid-show (auto) | Board already has the sequence and plays it autonomously. |
| Phone BLE drops mid-show (manual) | Physical button can advance/stop; cue-hold fallback is a planned refinement. |
| Every wireless path fails | Physical button (GPIO4) starts/stops on an always-live, BLE-independent path. |
| LED inrush / first-pixel glitch | Series resistor + bulk capacitor (see [Hardware](HARDWARE.md)). |
| Over-bright / over-current | Per-cue + master brightness in firmware, plus FastLED's hardware current cap. |

## Key decisions (rationale in [PLAN.md](PLAN.md))

- **Custom build, not WLED** — needs a timeline *and* live manual cueing + BLE, which WLED can't do.
- **BLE-only, no ESP-NOW** — one radio, no Wi-Fi/BLE coexistence problem on the C3.
- **Capacitor-native BLE** — the only path that covers iOS *and* Android from one web codebase.
- **Contract + golden vectors** — lets independent app/firmware engines stay provably in sync.

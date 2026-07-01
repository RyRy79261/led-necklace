# app — LED Necklace control app

Next.js (App Router, **static export**) + Capacitor. Runs as a web app (Vercel) and as a
native iOS/Android app from the same code. Talks to the board over **Bluetooth LE**.

## Commands

```bash
npm install
npm run dev          # dev server at http://localhost:3000
npm run build        # static export → out/  (also Capacitor's webDir)
npm run typecheck    # tsc --noEmit
npm test             # vitest run (44 tests, incl. the golden contract vectors)
```

## Surfaces

| Route | Purpose | Needs BLE? |
|---|---|---|
| `/editor` | Author a sequence — add/reorder cues, pick effect + colours + duration + params. Persists to `localStorage`; JSON import/export. | no |
| `/preview` | 30-pixel **simulator** on a `<canvas>`, running the real player + effect math at 60 fps. | no |
| `/remote` | Live console — START / NEXT / BLACKOUT / brightness, connection UI, auto-reconnect. **Mock** or **BLE** transport. | BLE only in BLE mode |

Everything works with **no hardware** in Mock mode.

## Code map

```
src/lib/            ← reference core (framework-free, unit-tested)
  types.ts          Cue / Sequence / Effect / RGB   (from shared/DATA-MODEL.md)
  codec.ts          encode/decode sequence + crc32  (little-endian wire format)
  effects.ts        renderCue (linear) + gamma8 + applyDisplay
  player.ts         Player state machine (play/stop/next/prev/goto/tick)
  ble.ts            Transport interface + MockTransport + BleTransport
  __tests__/        contract.test.ts (golden vectors), player.test.ts
src/app/            editor/  preview/  remote/  + layout, home
src/components/     editor/  preview/  remote/  (per-surface UI)
```

`src/lib` is a straight mirror of `firmware/lib`; both are verified against
[`shared/test-vectors.json`](../shared/test-vectors.json), so app and firmware render identically.

## Notes

- **Static export.** No SSR/API routes — every page is client-rendered. Browser APIs
  (`localStorage`, `requestAnimationFrame`, BLE) run only inside effects so prerender is safe.
- **Transports share one interface**, so the remote UI is identical whether it's driving a
  simulated board (`MockTransport`) or a real one (`BleTransport`). Swapping is a mode toggle.
- **Deploy:** see [../docs/DEPLOY.md](../docs/DEPLOY.md) — Vercel for web, Capacitor for native,
  including the iOS Web-Bluetooth caveat and the required BLE permissions.

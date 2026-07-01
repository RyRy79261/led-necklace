# Deployment

The app has two delivery targets from one codebase:

| Target | Hosts | BLE control works on | Best for |
|---|---|---|---|
| **Web (Vercel)** | any browser via URL | Android Chrome, desktop Chrome/Edge | authoring, the simulator, quick testing, Android control |
| **Native (Capacitor)** | installed app | **iOS + Android** | the shipping product, especially iPhone control |

`/editor` and `/preview` need no Bluetooth and work everywhere. Only `/remote`'s live BLE
connection is platform-sensitive.

---

## Web on Vercel

The app is a **static export** (`next.config.mjs` → `output: 'export'`), so Vercel serves it as
a static site — no server, no env vars, no secrets.

**One-time setup:**
1. Import `github.com/RyRy79261/led-necklace` into Vercel.
2. Set **Root Directory = `app`** (the app is not at the repo root).
3. Framework preset **Next.js** (auto-detected); build command `next build`, output auto.
4. Deploy. Every push to `main` redeploys.

**The iOS caveat (important):** hosted-web `/remote` uses **Web Bluetooth**, which is
Chromium-only. It works on Android Chrome and desktop Chrome/Edge but **not iOS Safari** (nor
any iOS browser — they're all WebKit). Web Bluetooth also requires **HTTPS**, which Vercel
provides. So the Vercel deploy is perfect for authoring + simulator + Android/desktop control;
for **iPhone control, use the native app** below.

CLI alternative: `cd app && npx vercel` (or `vercel --prod`).

---

## Native app via Capacitor (iOS + Android)

```bash
cd app
npm run build                 # produces app/out/  (Capacitor webDir)
npx cap add ios               # first time only
npx cap add android           # first time only
npx cap sync                  # copy web build + plugins into native projects
npx cap open ios              # → Xcode
npx cap open android          # → Android Studio
```

Then build/run/sign from Xcode or Android Studio as usual. Re-run `npm run build && npx cap
sync` after web changes.

### Required BLE permissions

`@capacitor-community/bluetooth-le` needs platform permissions or scanning silently fails:

- **iOS** — add to `ios/App/App/Info.plist`:
  - `NSBluetoothAlwaysUsageDescription` — e.g. "Connects to the LED necklace over Bluetooth."
- **Android** — in `android/app/src/main/AndroidManifest.xml` (Android 12+ / API 31+):
  - `BLUETOOTH_SCAN` (with `usesPermissionFlags="neverForLocation"`), `BLUETOOTH_CONNECT`.
  - For older Android: `BLUETOOTH`, `BLUETOOTH_ADMIN`, and location permission for scanning.

Background BLE is **not** needed — the operator holds the app in the foreground during the
show — so the premium foreground-service plugin features can be skipped.

---

## Which surface, which platform (summary)

- **Design a show, anywhere:** Vercel web → `/editor` + `/preview`.
- **Run the show from Android or a laptop:** Vercel web → `/remote`.
- **Run the show from an iPhone:** native Capacitor app → `/remote`.
- **No device yet:** `/remote` in **Mock** mode works on every target.

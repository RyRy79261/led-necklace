// main.cpp — firmware entry point (FIRMWARE DEVICE layer).
//
// Wires the portable engine (lib/seq, lib/effects, lib/player) to the hardware:
//   - FastLED (RMT clockless driver) -> 30x WS2812B on LED_PIN, GRB
//   - a debounced physical button on BUTTON_PIN (INPUT_PULLUP)
//   - LittleFS persistence of the uploaded sequence at /seq.bin
//   - a NimBLE-Arduino GATT server (service + CMD/UPLOAD/STATUS) per shared/PROTOCOL.md
//
// The engine logic (effect math, transport state machine, codec, crc32) lives in lib/ and
// is contract-frozen; this file is the on-hardware glue only. Little-endian everywhere.
//
// Concurrency model (keep it simple + robust):
//   NimBLE write callbacks run on the BLE host task. To avoid data races with the render
//   loop, they NEVER touch the Player directly. CMD writes are parsed into a small FreeRTOS
//   queue; UPLOAD writes fill a static reassembly buffer and raise a "commit" flag. ALL
//   Player mutation (button + drained BLE commands + upload commit) happens in loop(), so
//   the button path stays fully independent of the BLE stack and there is a single writer.
//
// Excluded from the `native` unit-test build (no Arduino there).
#ifndef NATIVE

// IMPORTANT: include the portable engine headers FIRST, before FastLED.h. FastLED's EOrder
// enum injects unscoped enumerators named RGB/GRB/BGR/... into this translation unit, which
// would otherwise shadow our `struct RGB` and make `struct Cue { RGB colorA; }` in seq.h fail
// to parse ("'RGB' does not name a type"). Parsing our headers before FastLED is seen keeps
// `RGB` bound to the struct within them. (main.cpp's own later uses still use `struct RGB`.)
#include "seq.h"
#include "effects.h"
#include "player.h"

#include <Arduino.h>
#include <string.h>
#include <FastLED.h>
#include <NimBLEDevice.h>
#include <FS.h>
#include <LittleFS.h>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"

// ── Pins (build_flags in platformio.ini) ──────────────────────────────────────
// D6 = GPIO21 = LED data, D2 = GPIO4 = button. Both non-strapping. See README.
#ifndef LED_PIN
#define LED_PIN 21
#endif
#ifndef BUTTON_PIN
#define BUTTON_PIN 4
#endif

// ── BLE UUIDs (AUTHORITATIVE: shared/PROTOCOL.md) ─────────────────────────────
#define BLE_SERVICE_UUID "5d3a1000-1f2b-4c6a-9e10-000000000001"
#define BLE_CMD_UUID     "5d3a1000-1f2b-4c6a-9e10-000000000002"  // Write / Write-No-Response
#define BLE_UPLOAD_UUID  "5d3a1000-1f2b-4c6a-9e10-000000000003"  // Write-No-Response
#define BLE_STATUS_UUID  "5d3a1000-1f2b-4c6a-9e10-000000000004"  // Notify

// STATUS notify opcodes / UP_ACK status codes (shared/PROTOCOL.md).
static const uint8_t STATUS_STATE   = 0x20;
static const uint8_t STATUS_UP_ACK  = 0x21;
static const uint8_t ACK_OK         = 0;
static const uint8_t ACK_CRC_FAIL   = 1;
static const uint8_t ACK_LEN_FAIL   = 2;
static const uint8_t ACK_STORE_FAIL = 3;

// ── Tunables ──────────────────────────────────────────────────────────────────
static const uint16_t MAX_CUES          = 256;   // matches app authoring cap
static const uint32_t MAX_BLOB          = HEADER_BYTES + (uint32_t)CUE_BYTES * MAX_CUES; // wire bytes
static const uint32_t FRAME_INTERVAL_MS = 16;    // ~62.5 FPS render cadence
static const uint32_t DEBOUNCE_MS       = 25;    // button debounce window
static const uint32_t LONG_PRESS_MS     = 600;   // >= this held = long press (toggle mode)
static const uint16_t REQ_MTU           = 247;   // request larger MTU on connect

// Unattended-show behavior: start the stored sequence on power-up with no phone/BLE/button
// needed. Full rationale at the autostart block in setup(). Set false to boot dark instead.
static const bool     BOOT_AUTOPLAY     = true;

// ── Global current / brightness cap ──────────────────────────────────────────
// The Player already bakes in per-cue brightness, the runtime masterBrightness and gamma
// (tick() returns display-ready bytes). These two hardware caps sit on TOP as a safety net
// so the summed draw of all 30 WS2812B can never imply an unsafe current at prop brightness:
//   MASTER_BRIGHTNESS_CAP — a flat scale applied to every frame (conservative default).
//   MAX_MILLIAMPS         — FastLED auto-dims a frame further if it would exceed this budget.
//
// IMPORTANT — SUPPLY_VOLTS is the model reference, NOT the rail voltage. FastLED's power model
// is calibrated at 5V (see power_mgt.cpp: the per-channel constants are `mA * 5`), so the
// effective ceiling is (SUPPLY_VOLTS * MAX_MILLIAMPS) / 5 milliamps of *actual* LED current.
// Keep SUPPLY_VOLTS = 5 even though the strip runs LiPo-direct at ~3.7-4.2V. To cap to N mA,
// pass (5, N) — passing (4, N) would silently tighten the cap to 4/5·N (e.g. (4,1000) = 0.8A).
static const uint8_t  MASTER_BRIGHTNESS_CAP = 160;   // ~63% flat cap
static const uint32_t SUPPLY_VOLTS          = 5;     // FastLED model reference — keep at 5
static const uint32_t MAX_MILLIAMPS         = 1000;  // -> 1.0A (1C) hard ceiling. Full-white 30px
                                                     // is ~1.3-1.8A at full brightness -> clamped.

// ── FastLED / engine buffers ──────────────────────────────────────────────────
// NOTE: FastLED's EOrder enum injects unscoped enumerators named RGB, GRB, BGR, ... into
// this translation unit; they shadow our engine's `struct RGB` (ordinary-name lookup finds
// the enumerator first). So in main.cpp the struct MUST be named with the elaborated form
// `struct RGB`. The engine .cpp files don't include FastLED, so they are unaffected.
static CRGB        leds[PIXEL_COUNT];         // FastLED pixel buffer (GRB on the wire)
static struct RGB  gFrame[PIXEL_COUNT];       // engine output frame (display-ready bytes)
static Cue    gCues[MAX_CUES];                // active decoded sequence (in-memory structs)
static Cue    gTmpCues[MAX_CUES];             // staging area for an upload before commit
static uint16_t gCueCount = 0;
static Player gPlayer;

// Desired play mode toggled by the button long-press / set by PLAY commands. The Player only
// adopts a mode on play(); this remembers the choice for the next start.
static PlayMode gMode = MODE_AUTO;

// ── Built-in idle / attract patterns ──────────────────────────────────────────
// Shown so the prop is NEVER dark when it isn't playing an uploaded show (power-up with no
// stored sequence, waiting for a link). These are ordinary Cue tables fed through the SAME
// tested effect engine (renderCue) — no new pixel math. Colours/timings are easy to tweak.
// The engine has no loop mode (next() stops at end-of-sequence), so loop() re-plays the active
// idle table when it ends (see the idle block in loop()). Per-cue brightness is 255; the global
// setBrightness(160) + the 1.0A power cap still bound the actual current (even the white breathe).
static const Cue kIdleFade[] = {          // smooth trip around the hue wheel — 6 x 2s = 12s loop
  {EFFECT_FADE, 2000, {255,0,0},   {255,255,0}, 0, 0, 255}, // red     -> yellow
  {EFFECT_FADE, 2000, {255,255,0}, {0,255,0},   0, 0, 255}, // yellow  -> green
  {EFFECT_FADE, 2000, {0,255,0},   {0,255,255}, 0, 0, 255}, // green   -> cyan
  {EFFECT_FADE, 2000, {0,255,255}, {0,0,255},   0, 0, 255}, // cyan    -> blue
  {EFFECT_FADE, 2000, {0,0,255},   {255,0,255}, 0, 0, 255}, // blue    -> magenta
  {EFFECT_FADE, 2000, {255,0,255}, {255,0,0},   0, 0, 255}, // magenta -> red
};
static const Cue kIdleBlueRed[] = {       // "no link" indicator — slow blue/red, 1s each (2s loop)
  {EFFECT_SOLID, 1000, {0,0,255}, {0,0,0}, 0, 0, 255},      // blue
  {EFFECT_SOLID, 1000, {255,0,0}, {0,0,0}, 0, 0, 255},      // red
};
static const Cue kIdleBreathe[] = {       // very slow breathe (~6s) via two long FADEs — beats the
  {EFFECT_FADE, 3000, {0,0,0},       {255,255,255}, 0, 0, 255}, // ramp up   2.55s ceiling of a
  {EFFECT_FADE, 3000, {255,255,255}, {0,0,0},       0, 0, 255}, // ramp down native BREATHE cue
};

enum IdlePattern : uint8_t { IDLE_FADE = 0, IDLE_BLUERED = 1, IDLE_BREATHE = 2 };
static bool        gIdleMode    = false;  // true = looping a built-in idle table (not a real show)
static IdlePattern gIdlePattern = IDLE_FADE;
static uint32_t    gIdleSinceMs = 0;      // millis() when the current idle pattern started

// After this long idling with NO BLE link, the calm color-fade escalates to the blue/red "no
// link" flash; a link returns it to the color-fade. Set 0 to disable the escalation.
static const uint32_t IDLE_NOLINK_MS = 45000;  // 45 s

// Bind + loop one of the built-in idle tables (keeps the prop lit while it waits).
static void enterIdle(IdlePattern p, uint32_t now) {
  switch (p) {
    case IDLE_BLUERED: gPlayer.setSequence(kIdleBlueRed, 2); break;
    case IDLE_BREATHE: gPlayer.setSequence(kIdleBreathe, 2); break;
    case IDLE_FADE:
    default:           gPlayer.setSequence(kIdleFade, 6);    break;
  }
  gIdlePattern = p;
  gIdleMode    = true;
  gIdleSinceMs = now;
  gPlayer.play(MODE_AUTO, now);
}

// Bind + start the uploaded show (gCues), leaving idle. Caller ensures gCueCount > 0.
static void enterShow(uint32_t now) {
  gIdleMode = false;
  gPlayer.setSequence(gCues, gCueCount);
  gPlayer.play(gMode, now);
}

// ── BLE command queue (BLE task -> loop) ──────────────────────────────────────
struct BleEvent {
  uint8_t  op;     // CMD opcode 0x01..0x07
  uint8_t  mode;   // PLAY: 0=auto,1=manual
  uint16_t index;  // GOTO cue index
  uint8_t  value;  // SET_BRIGHT value
};
static QueueHandle_t gCmdQueue = nullptr;

// ── Upload reassembly (BLE task writes; loop commits) ─────────────────────────
static uint8_t  gUploadBuf[MAX_BLOB];
static volatile uint32_t gUploadTotalLen = 0;   // expected length from BEGIN
static volatile uint32_t gUploadCrc      = 0;   // expected crc32 from BEGIN
static volatile uint32_t gUploadHigh     = 0;   // highest offset+len written (received length)
static volatile bool     gUploadActive   = false; // a BEGIN has been seen, awaiting END
static volatile bool     gUploadCommit   = false; // END seen, loop() must validate + commit

// ── BLE server state ──────────────────────────────────────────────────────────
static NimBLECharacteristic* gStatusChar = nullptr;
static volatile bool gConnected   = false;
static volatile bool gForceStatus = false;  // push a STATE notify next loop (e.g. on connect)

// Snapshot of last-notified STATE, for change detection.
static bool     gLastPlaying = false;
static PlayMode gLastMode    = MODE_AUTO;
static uint16_t gLastCue     = 0;
static uint8_t  gLastBright  = 255;
static bool     gHaveLast    = false;

// ── Little-endian readers ─────────────────────────────────────────────────────
static inline uint16_t rdU16(const uint8_t* p) {
  return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}
static inline uint32_t rdU32(const uint8_t* p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
         ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

// ── Display ───────────────────────────────────────────────────────────────────
// Copy the display-ready engine frame to the strip and latch it. FastLED handles GRB
// reordering (chipset template) and the current cap (setBrightness + max-power).
static void applyDisplay(const struct RGB* frame) {  // elaborated: dodge FastLED's EOrder::RGB
  for (uint16_t i = 0; i < PIXEL_COUNT; ++i) {
    leds[i].setRGB(frame[i].r, frame[i].g, frame[i].b);
  }
  FastLED.show();
}

// Immediate, unconditional blackout (panic path). Independent of the Player/engine.
static void blackoutNow() {
  for (uint16_t i = 0; i < PIXEL_COUNT; ++i) leds[i] = CRGB::Black;
  FastLED.show();
}

// ── STATUS notifications ──────────────────────────────────────────────────────
static uint8_t readBatteryPct() {
  // No fuel gauge on this build -> unknown (255) per PROTOCOL.md. (LiPo ADC is future work.)
  return 255;
}

static void notifyState() {
  if (!gStatusChar) return;
  uint16_t ci = gPlayer.currentCue();
  uint8_t buf[7];
  buf[0] = STATUS_STATE;
  buf[1] = gPlayer.isPlaying() ? 1 : 0;
  buf[2] = (uint8_t)gPlayer.mode();
  buf[3] = (uint8_t)(ci & 0xFF);
  buf[4] = (uint8_t)((ci >> 8) & 0xFF);
  buf[5] = gPlayer.masterBrightness();
  buf[6] = readBatteryPct();
  gStatusChar->setValue(buf, sizeof(buf));
  gStatusChar->notify();
}

static void notifyUploadAck(uint8_t status) {
  if (!gStatusChar) return;
  uint8_t buf[2] = { STATUS_UP_ACK, status };
  gStatusChar->setValue(buf, sizeof(buf));
  gStatusChar->notify();
}

// Push STATE only when something the app cares about actually changed (or forced on connect).
static void maybeNotifyStatus() {
  bool     playing = gPlayer.isPlaying();
  PlayMode mode    = gPlayer.mode();
  uint16_t cue     = gPlayer.currentCue();
  uint8_t  bright  = gPlayer.masterBrightness();

  bool changed = gForceStatus || !gHaveLast ||
                 playing != gLastPlaying || mode != gLastMode ||
                 cue != gLastCue || bright != gLastBright;
  if (!changed) return;

  gLastPlaying = playing; gLastMode = mode; gLastCue = cue; gLastBright = bright;
  gHaveLast = true; gForceStatus = false;

  if (gConnected) notifyState();
}

// ── LittleFS persistence ──────────────────────────────────────────────────────
static bool persistSeq(const uint8_t* data, uint32_t len) {
  File f = LittleFS.open("/seq.bin", "w");
  if (!f) return false;
  size_t w = f.write(data, len);
  f.close();
  return w == len;
}

// Decode a wire blob into gCues via the staging buffer, swap in on success.
static bool loadBlobIntoPlayer(const uint8_t* data, uint32_t len) {
  uint16_t count = 0;
  if (!decodeSequence(data, len, gTmpCues, MAX_CUES, count)) return false;
  memcpy(gCues, gTmpCues, (size_t)count * sizeof(Cue));
  gCueCount = count;
  gPlayer.setSequence(gCues, gCueCount);
  return true;
}

// Boot: load /seq.bin if present (no BLE/render running yet, so no locking needed).
static void loadSeqFromFlash() {
  if (!LittleFS.exists("/seq.bin")) return;
  File f = LittleFS.open("/seq.bin", "r");
  if (!f) return;
  size_t len = f.size();
  if (len == 0 || len > MAX_BLOB) { f.close(); return; }
  size_t got = f.read(gUploadBuf, len);
  f.close();
  if (got != len) return;
  if (loadBlobIntoPlayer(gUploadBuf, (uint32_t)len)) {
    Serial.printf("[boot] loaded /seq.bin (%u bytes, %u cues)\n", (unsigned)len, gCueCount);
  } else {
    Serial.println("[boot] /seq.bin failed to decode; ignoring");
  }
}

// ── Upload commit (runs in loop() only) ───────────────────────────────────────
// Validate the reassembled blob (length -> crc -> decode -> persist), swap it into the
// Player, and ack. On any failure the currently-playing sequence is left untouched.
static void handleUploadCommit() {
  if (!gUploadCommit) return;
  gUploadCommit = false;
  gUploadActive = false;

  uint32_t total = gUploadTotalLen;
  uint32_t high  = gUploadHigh;

  if (high != total || total == 0 || total > MAX_BLOB) {
    notifyUploadAck(ACK_LEN_FAIL);
    return;
  }
  if (crc32(gUploadBuf, total) != gUploadCrc) {
    notifyUploadAck(ACK_CRC_FAIL);
    return;
  }
  if (!loadBlobIntoPlayer(gUploadBuf, total)) {
    // Structurally invalid (bad version / length / cueCount) -> report as a length failure.
    notifyUploadAck(ACK_LEN_FAIL);
    return;
  }
  // New show is live in RAM -> leave the idle attract and start playing it immediately.
  enterShow(millis());
  if (!persistSeq(gUploadBuf, total)) {
    // Sequence is live in RAM but not saved -> report storage failure; keep playing it.
    notifyUploadAck(ACK_STORE_FAIL);
    gForceStatus = true;
    return;
  }
  notifyUploadAck(ACK_OK);
  gForceStatus = true;  // sequence reset to cue 0 / stopped -> push fresh STATE
}

// ── Apply a queued BLE CMD (runs in loop() only) ──────────────────────────────
static void applyBleCommand(const BleEvent& ev, uint32_t now) {
  switch (ev.op) {
    case 0x01: // PLAY
      gMode = (ev.mode == MODE_MANUAL) ? MODE_MANUAL : MODE_AUTO;
      gPlayer.play(gMode, now);
      break;
    case 0x02: gPlayer.stop(); break;                 // STOP
    case 0x03: gPlayer.next(now); break;              // NEXT
    case 0x04: gPlayer.prev(now); break;              // PREV
    case 0x05: gPlayer.goto_(ev.index, now); break;   // GOTO
    case 0x06: gPlayer.setMasterBrightness(ev.value); break; // SET_BRIGHT
    case 0x07: gIdleMode = false; gPlayer.stop(); blackoutNow(); break;  // BLACKOUT (panic; exits idle)
    default: break;
  }
}

// ── BLE callbacks (BLE host task context) ─────────────────────────────────────
class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* /*pServer*/, NimBLEConnInfo& /*connInfo*/) override {
    gConnected   = true;
    gForceStatus = true;  // emit one STATE on connect (PROTOCOL.md)
  }
  void onDisconnect(NimBLEServer* /*pServer*/, NimBLEConnInfo& /*connInfo*/, int /*reason*/) override {
    gConnected = false;
    // Advertising auto-restarts (advertiseOnDisconnect(true), set in setup()).
  }
};

class CmdCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* pCharacteristic, NimBLEConnInfo& /*connInfo*/) override {
    NimBLEAttValue val = pCharacteristic->getValue();
    const uint8_t* d = val.data();
    size_t n = val.length();
    if (n < 1 || !gCmdQueue) return;

    BleEvent ev = {};
    ev.op = d[0];
    switch (d[0]) {
      case 0x01: if (n < 2) return; ev.mode = d[1]; break;            // PLAY [mode]
      case 0x02: case 0x03: case 0x04: case 0x07: break;              // STOP/NEXT/PREV/BLACKOUT
      case 0x05: if (n < 3) return; ev.index = rdU16(d + 1); break;   // GOTO [u16]
      case 0x06: if (n < 2) return; ev.value = d[1]; break;           // SET_BRIGHT [u8]
      default: return; // unknown opcode
    }
    // Non-blocking: commands are idempotent-safe to resend, so a full queue can drop.
    xQueueSend(gCmdQueue, &ev, 0);
  }
};

class UploadCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* pCharacteristic, NimBLEConnInfo& /*connInfo*/) override {
    NimBLEAttValue val = pCharacteristic->getValue();
    const uint8_t* d = val.data();
    size_t n = val.length();
    if (n < 1) return;

    switch (d[0]) {
      case 0x10: { // BEGIN [totalLen u32][crc32 u32]
        if (n < 9) return;
        uint32_t total = rdU32(d + 1);
        uint32_t crc   = rdU32(d + 5);
        if (total == 0 || total > MAX_BLOB) { gUploadActive = false; return; }
        gUploadTotalLen = total;
        gUploadCrc      = crc;
        gUploadHigh     = 0;
        gUploadCommit   = false;
        gUploadActive   = true;
        break;
      }
      case 0x11: { // CHUNK [offset u16][payload...]
        if (n < 3 || !gUploadActive) return;
        uint32_t offset = rdU16(d + 1);
        uint32_t payLen = (uint32_t)n - 3;
        if (payLen == 0) return;
        if (offset + payLen > gUploadTotalLen) return; // out of declared range -> drop
        memcpy(gUploadBuf + offset, d + 3, payLen);
        uint32_t end = offset + payLen;
        if (end > gUploadHigh) gUploadHigh = end;
        break;
      }
      case 0x12: // END -> loop() validates + commits
        if (!gUploadActive) return;
        gUploadCommit = true;
        break;
      default: break;
    }
  }
};

// ── Button (debounced; classify on release; fully BLE-independent) ────────────
static int      gBtnReading   = HIGH;  // last raw read
static int      gBtnStable    = HIGH;  // debounced state (HIGH = released, pull-up)
static uint32_t gBtnChangedMs = 0;     // when the raw read last changed
static uint32_t gBtnPressMs   = 0;     // when the current press started

static void onShortPress(uint32_t now) {
  if (gIdleMode) return;                       // idling (no show) -> nothing to start/stop
  if (gPlayer.isPlaying()) gPlayer.stop();
  else                     gPlayer.play(gMode, now);
}
static void onLongPress(uint32_t now) {
  gMode = (gMode == MODE_AUTO) ? MODE_MANUAL : MODE_AUTO;
  // Don't disturb the idle attract (it loops in AUTO); only re-apply to a running show.
  if (!gIdleMode && gPlayer.isPlaying()) gPlayer.play(gMode, now); // apply immediately (restarts at cue 0)
}

static void serviceButton(uint32_t now) {
  int reading = digitalRead(BUTTON_PIN);
  if (reading != gBtnReading) { gBtnReading = reading; gBtnChangedMs = now; }

  if ((now - gBtnChangedMs) >= DEBOUNCE_MS && reading != gBtnStable) {
    gBtnStable = reading;
    if (gBtnStable == LOW) {          // pressed (INPUT_PULLUP)
      gBtnPressMs = now;
    } else {                          // released -> classify by held duration
      uint32_t held = now - gBtnPressMs;
      if (held >= LONG_PRESS_MS) onLongPress(now);
      else                       onShortPress(now);
    }
  }
}

// ── Setup / loop ──────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);

  // Button first so the start/stop + panic path is live ASAP, independent of everything else.
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  gBtnReading = gBtnStable = digitalRead(BUTTON_PIN);
  gBtnChangedMs = millis();

  // FastLED — WS2812B on ESP32 uses the RMT clockless driver (BLE IRQs jitter bit-banged
  // timing; RMT avoids flicker). GRB order. Apply the global current/brightness cap.
  FastLED.addLeds<WS2812B, LED_PIN, GRB>(leds, PIXEL_COUNT);
  FastLED.setBrightness(MASTER_BRIGHTNESS_CAP);
  FastLED.setMaxPowerInVoltsAndMilliamps(SUPPLY_VOLTS, MAX_MILLIAMPS);
  blackoutNow();  // start dark

  // Command queue must exist before BLE callbacks can fire.
  gCmdQueue = xQueueCreate(16, sizeof(BleEvent));

  // LittleFS — mount (format on first boot) and load any saved sequence.
  if (LittleFS.begin(true)) {
    loadSeqFromFlash();
  } else {
    Serial.println("[boot] LittleFS mount failed");
  }

  // Boot behavior — NEVER sit dark:
  //   • a show is stored  -> autostart it standalone (unattended safety; no phone needed).
  //   • nothing stored    -> loop the color-fade attract, escalating to the blue/red "no link"
  //                          flash after IDLE_NOLINK_MS with no BLE connection.
  // Both drive the tested effect engine. MODEL SWITCH: to always show the attract first and
  // require the app to start even a stored show, change `gCueCount > 0` below to `false`.
  if (BOOT_AUTOPLAY && gCueCount > 0) {
    enterShow(millis());
    Serial.printf("[boot] autostart stored show: %u cues\n", gCueCount);
  } else {
    enterIdle(IDLE_FADE, millis());
    Serial.println("[boot] no stored show -> idle attract (color fade)");
  }

  // NimBLE — server + service + CMD/UPLOAD/STATUS characteristics, then advertise.
  NimBLEDevice::init("Necklace");
  NimBLEDevice::setMTU(REQ_MTU);  // request a larger MTU so uploads chunk in fewer writes

  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  server->advertiseOnDisconnect(true);

  NimBLEService* service = server->createService(BLE_SERVICE_UUID);

  NimBLECharacteristic* cmdChar = service->createCharacteristic(
      BLE_CMD_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  cmdChar->setCallbacks(new CmdCallbacks());

  NimBLECharacteristic* upChar = service->createCharacteristic(
      BLE_UPLOAD_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  upChar->setCallbacks(new UploadCallbacks());

  gStatusChar = service->createCharacteristic(
      BLE_STATUS_UUID, NIMBLE_PROPERTY::NOTIFY);

  // (NimBLE 2.x starts services automatically when the server starts advertising; the old
  // service->start() is a deprecated no-op and is intentionally omitted.)

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(BLE_SERVICE_UUID);
  adv->setName("Necklace");
  adv->enableScanResponse(true);   // 128-bit UUID + name won't fit one 31-byte packet
  adv->start();

  Serial.println("[boot] ready; advertising as 'Necklace'");
}

void loop() {
  uint32_t now = millis();

  // 1) Button — always-live, BLE-independent transport + panic path.
  serviceButton(now);

  // 2) Drain queued BLE commands (single-writer discipline: only loop() touches Player).
  if (gCmdQueue) {
    BleEvent ev;
    while (xQueueReceive(gCmdQueue, &ev, 0) == pdTRUE) applyBleCommand(ev, now);
  }

  // 3) Commit a finished upload (validate len+crc, decode, persist, reload, ack).
  handleUploadCommit();

  // 3.5) Idle/attract escalation: color-fade -> blue/red "no link" flash after IDLE_NOLINK_MS
  //      with no BLE link, and back to the calm fade once a link appears. (The seamless LOOP of
  //      the built-in happens in the render step below, so the wrap never shows a black frame.)
  if (gIdleMode) {
    if (gConnected) {
      if (gIdlePattern != IDLE_FADE) enterIdle(IDLE_FADE, now);
    } else if (IDLE_NOLINK_MS && gIdlePattern == IDLE_FADE &&
               (now - gIdleSinceMs) >= IDLE_NOLINK_MS) {
      enterIdle(IDLE_BLUERED, now);
    }
  }

  // 4) Render at ~60 FPS. tick() emits display-ready bytes (per-cue + master brightness +
  //    gamma already baked in); FastLED's caps then bound the actual current draw.
  static uint32_t lastFrameMs = 0;
  if ((now - lastFrameMs) >= FRAME_INTERVAL_MS) {
    lastFrameMs = now;
    gPlayer.tick(now, gFrame);
    // Idle patterns loop forever: the engine stops at end-of-sequence (next()->stop()). If an
    // idle table just ended, restart it and re-render THIS frame so the wrap shows no black blip.
    if (gIdleMode && !gPlayer.isPlaying()) {
      gPlayer.play(MODE_AUTO, now);
      gPlayer.tick(now, gFrame);
    }
    applyDisplay(gFrame);
  }

  // 5) Notify STATE on change (and once on connect).
  maybeNotifyStatus();

  // 6) Yield: feeds the task watchdog / lets the BLE + idle tasks run. Caps loop ~1 kHz,
  //    which is ample for debounce and 60 FPS.
  delay(1);
}

#endif  // NATIVE

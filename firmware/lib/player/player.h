// player.h — transport / player state machine (AUTHORITATIVE CONTRACT: shared/DATA-MODEL.md §4)
//
// Portable C++ shared with the app's player.ts. Firmware runs it at 30–60 FPS. The player
// holds a pointer to the active cue list (owned elsewhere, e.g. decoded into a static
// buffer) and produces display-pipeline frames. Bodies live in player.cpp (build agents).
//
// Time is supplied by the caller (millis() on device, a test clock on host) — the player
// never reads a clock itself, which keeps it host-testable. Every state-changing transport
// command takes the current time so it can stamp cueStartMs = now per DATA-MODEL §4.
#pragma once

#include <stdint.h>
#include "seq.h"
#include "effects.h"

enum PlayMode : uint8_t { MODE_AUTO = 0, MODE_MANUAL = 1 };

class Player {
public:
  Player();

  // Bind the active sequence. `cues` must stay valid for the player's lifetime (or until
  // the next setSequence). Resets transport to stopped at cue 0.
  void setSequence(const Cue* cues, uint16_t count);

  // ── Transport controls (DATA-MODEL §4) ─────────────────────────────────────
  void play(PlayMode mode, uint32_t nowMs);  // mode set, currentCue=0, cueStartMs=now, playing=true
  void stop();                               // playing=false (output blackout)
  void next(uint32_t nowMs);                 // currentCue+1; past last cue => stop() (v1: no loop)
  void prev(uint32_t nowMs);                 // currentCue-1 (min 0), cueStartMs=now
  void goto_(uint16_t index, uint32_t nowMs);// currentCue=clamp(index), cueStartMs=now

  // Advance to `nowMs` and fill `frame` (PIXEL_COUNT pixels) with the display-pipeline
  // output: gamma8( renderCue(cue, elapsed) * (masterBrightness/255) ) per channel.
  // If not playing (or at end-of-sequence in auto), fills blackout. In auto mode, advances
  // when elapsed >= cue.durationMs (may stop at the end). Manual mode never auto-advances.
  void tick(uint32_t nowMs, RGB* frame);

  // ── Runtime brightness (PROTOCOL SET_BRIGHT); applied in linear domain, before gamma ──
  void    setMasterBrightness(uint8_t value);
  uint8_t masterBrightness() const;

  // ── State getters ──────────────────────────────────────────────────────────
  bool     isPlaying() const;
  PlayMode mode() const;
  uint16_t currentCue() const;

private:
  const Cue* cues_;
  uint16_t   cueCount_;
  PlayMode   mode_;
  uint16_t   currentCue_;
  uint32_t   cueStartMs_;
  bool       playing_;
  uint8_t    masterBrightness_;  // default 255
};

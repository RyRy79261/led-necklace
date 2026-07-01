// player.cpp — transport / player state machine (AUTHORITATIVE CONTRACT: shared/DATA-MODEL.md §4).
// Portable C++ shared conceptually with the app's player.ts. Time is supplied by the caller;
// the player never reads a clock itself (keeps it host-testable).
//
// Display pipeline (per DATA-MODEL §3): out = gamma8( renderCue(cue, elapsed) * (master/255) ).
#include "player.h"
#include <cmath>

// round-half-up to [0,255] for the linear-domain master-brightness scale (before gamma).
// Matches the rounding convention used across the contract (see effects.cpp).
static inline uint8_t roundClamp(double v) {
  double r = std::floor(v + 0.5 + 1e-9);
  if (r < 0.0)   r = 0.0;
  if (r > 255.0) r = 255.0;
  return (uint8_t)r;
}

static inline void fillBlackout(RGB* frame) {
  for (uint16_t i = 0; i < PIXEL_COUNT; ++i) {
    frame[i].r = 0;
    frame[i].g = 0;
    frame[i].b = 0;
  }
}

Player::Player()
    : cues_(0),
      cueCount_(0),
      mode_(MODE_AUTO),
      currentCue_(0),
      cueStartMs_(0),
      playing_(false),
      masterBrightness_(255) {}

void Player::setSequence(const Cue* cues, uint16_t count) {
  cues_       = cues;
  cueCount_   = count;
  currentCue_ = 0;
  cueStartMs_ = 0;
  playing_    = false;   // reset transport to stopped at cue 0
}

// play → mode set, currentCue=0, cueStartMs=now, playing=true.
void Player::play(PlayMode mode, uint32_t nowMs) {
  mode_       = mode;
  currentCue_ = 0;
  cueStartMs_ = nowMs;
  playing_    = true;
}

// stop → playing=false (output blackout).
void Player::stop() {
  playing_ = false;
}

// next → currentCue+1, cueStartMs=now. If past last cue → stop() (v1: no loop).
void Player::next(uint32_t nowMs) {
  currentCue_ = (uint16_t)(currentCue_ + 1);
  cueStartMs_ = nowMs;
  if (currentCue_ >= cueCount_) {
    stop();
  }
}

// prev → currentCue-1 (min 0), cueStartMs=now.
void Player::prev(uint32_t nowMs) {
  if (currentCue_ > 0) {
    currentCue_ = (uint16_t)(currentCue_ - 1);
  }
  cueStartMs_ = nowMs;
}

// goto → currentCue=clamp(index, 0, cueCount-1), cueStartMs=now.
void Player::goto_(uint16_t index, uint32_t nowMs) {
  if (cueCount_ == 0) {
    currentCue_ = 0;
  } else if (index >= cueCount_) {
    currentCue_ = (uint16_t)(cueCount_ - 1);
  } else {
    currentCue_ = index;
  }
  cueStartMs_ = nowMs;
}

// tick → if !playing return blackout. elapsed = now - cueStartMs.
// In auto mode, if elapsed >= cue.durationMs → next() (may stop at end), then recompute.
// Manual mode never auto-advances. Returns the display-pipeline frame for the current cue.
void Player::tick(uint32_t nowMs, RGB* frame) {
  if (!playing_ || cues_ == 0 || cueCount_ == 0 || currentCue_ >= cueCount_) {
    fillBlackout(frame);
    return;
  }

  // Auto mode: walk cue durations. next() re-stamps cueStartMs_ = nowMs so elapsed
  // resets to 0 after each advance; the loop therefore only iterates past zero-duration
  // cues (skipped, never shown) and stops at end-of-sequence. Loop form (not a single
  // `if`) to stay bit-identical with app/src/lib/player.ts — see DATA-MODEL.md §4.
  if (mode_ == MODE_AUTO) {
    while (playing_ && (nowMs - cueStartMs_) >= cues_[currentCue_].durationMs) {
      next(nowMs);  // may stop() at end of sequence
      if (!playing_ || currentCue_ >= cueCount_) {
        fillBlackout(frame);
        return;
      }
    }
  }

  uint32_t elapsed = nowMs - cueStartMs_;
  RGB lin = renderCue(cues_[currentCue_], elapsed);

  // masterBrightness applied in the LINEAR domain, then gamma (DATA-MODEL §3).
  const double mScale = (double)masterBrightness_ / 255.0;
  RGB out;
  out.r = gamma8(roundClamp((double)lin.r * mScale));
  out.g = gamma8(roundClamp((double)lin.g * mScale));
  out.b = gamma8(roundClamp((double)lin.b * mScale));

  for (uint16_t i = 0; i < PIXEL_COUNT; ++i) {
    frame[i] = out;
  }
}

void Player::setMasterBrightness(uint8_t value) { masterBrightness_ = value; }
uint8_t Player::masterBrightness() const        { return masterBrightness_; }

bool     Player::isPlaying()  const { return playing_; }
PlayMode Player::mode()       const { return mode_; }
uint16_t Player::currentCue() const { return currentCue_; }

// seq.h — sequence types + binary codec (AUTHORITATIVE CONTRACT: shared/DATA-MODEL.md §1–2)
//
// Little-endian everywhere. This header is portable C++ (host + ESP32); the bodies live
// in seq.cpp (implemented by the build agents). Do NOT change the exported shapes — they
// are frozen and cross-checked against shared/test-vectors.json.
#pragma once

#include <stdint.h>
#include <stddef.h>

// ── Effect enum (u8 on the wire) ──────────────────────────────────────────────
// v2 (reserved, do NOT implement now): 4=CHASE, 5=PALETTE.
enum Effect : uint8_t {
  EFFECT_SOLID   = 0,  // one colour, held
  EFFECT_FADE    = 1,  // crossfade colorA -> colorB across the cue's duration
  EFFECT_BREATHE = 2,  // colorA with a sinusoidal brightness envelope
  EFFECT_STROBE  = 3   // colorA flashing on/off at a frequency + duty cycle
};

// Linear (pre-gamma) RGB, each channel 0..255.
struct RGB { uint8_t r, g, b; };

// Cue — fixed 16 bytes on the wire (little-endian). See DATA-MODEL §1 for field meaning.
struct Cue {
  uint8_t  effect;      // Effect enum
  uint32_t durationMs;  // how long the cue is held in AUTO mode
  RGB      colorA;      // primary colour (R,G,B)
  RGB      colorB;      // secondary colour (FADE only; else ignored)
  uint8_t  param1;      // BREATHE/STROBE period in units of 10 ms (period_ms = param1*10; 0 => 100)
  uint8_t  param2;      // STROBE duty cycle 0..255 (fraction = param2/255); unused elsewhere
  uint8_t  brightness;  // per-cue max brightness 0..255
};

static const uint16_t PIXEL_COUNT  = 30;
static const uint8_t  CUE_BYTES    = 16;
static const uint8_t  HEADER_BYTES = 5;

// ── Codec (bodies in seq.cpp) ─────────────────────────────────────────────────

// Decode a sequence blob (header + cueCount*Cue) into outCues.
// Rejects (returns false) if: version != 1, len != 5 + 16*cueCount, or cueCount > maxCues.
// pixelCount != 30 is a warning only (still decodes). On success outCount holds the cue
// count and the function returns true.
bool decodeSequence(const uint8_t* buf, size_t len, Cue* outCues, uint16_t maxCues,
                    uint16_t& outCount);

// Encode `count` cues into `out` (caller supplies a buffer of at least
// HEADER_BYTES + CUE_BYTES*count bytes). Returns the number of bytes written.
size_t encodeSequence(const Cue* cues, uint16_t count, uint8_t* out);

// CRC32 — IEEE 802.3 (poly 0xEDB88320, reflected, init 0xFFFFFFFF, final XOR 0xFFFFFFFF).
// Used for the chunked upload END check (shared/PROTOCOL.md).
uint32_t crc32(const uint8_t* data, size_t len);

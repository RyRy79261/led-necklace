// seq.cpp — sequence binary codec + CRC32 (AUTHORITATIVE CONTRACT: shared/DATA-MODEL.md §1–2,
// shared/PROTOCOL.md upload). Portable C++ (host + ESP32). Little-endian everywhere.
//
// Wire layout (all little-endian):
//   Header (5 bytes): [0] version=1  [1..2] pixelCount(u16)  [3..4] cueCount(u16)
//   Cue (16 bytes):   [0] effect  [1..4] durationMs(u32)  [5..7] colorA(rgb)
//                     [8..10] colorB(rgb)  [11] param1  [12] param2  [13] brightness
//                     [14..15] reserved(=0)
#include "seq.h"

// ── Little-endian scalar helpers ──────────────────────────────────────────────
static inline uint16_t rd16(const uint8_t* p) {
  return (uint16_t)((uint16_t)p[0] | ((uint16_t)p[1] << 8));
}
static inline uint32_t rd32(const uint8_t* p) {
  return  (uint32_t)p[0]
        | ((uint32_t)p[1] << 8)
        | ((uint32_t)p[2] << 16)
        | ((uint32_t)p[3] << 24);
}
static inline void wr16(uint8_t* p, uint16_t v) {
  p[0] = (uint8_t)(v & 0xFF);
  p[1] = (uint8_t)((v >> 8) & 0xFF);
}
static inline void wr32(uint8_t* p, uint32_t v) {
  p[0] = (uint8_t)(v & 0xFF);
  p[1] = (uint8_t)((v >> 8) & 0xFF);
  p[2] = (uint8_t)((v >> 16) & 0xFF);
  p[3] = (uint8_t)((v >> 24) & 0xFF);
}

// ── Decode ────────────────────────────────────────────────────────────────────
// Rejects (returns false) if: buf null, len < header, version != 1,
// len != 5 + 16*cueCount, or cueCount > maxCues. pixelCount != 30 is a warning
// only (still decodes) — the contract says warn-but-play, so we don't reject here.
bool decodeSequence(const uint8_t* buf, size_t len, Cue* outCues, uint16_t maxCues,
                    uint16_t& outCount) {
  if (buf == 0 || len < (size_t)HEADER_BYTES) return false;

  uint8_t version = buf[0];
  if (version != 1) return false;

  // uint16_t pixelCount = rd16(buf + 1);  // != 30 is a warning only; not enforced here.
  uint16_t cueCount = rd16(buf + 3);

  if (len != (size_t)HEADER_BYTES + (size_t)CUE_BYTES * (size_t)cueCount) return false;
  if (cueCount > maxCues) return false;

  const uint8_t* p = buf + HEADER_BYTES;
  for (uint16_t i = 0; i < cueCount; ++i) {
    Cue c;
    c.effect      = p[0];
    c.durationMs  = rd32(p + 1);
    c.colorA.r    = p[5];
    c.colorA.g    = p[6];
    c.colorA.b    = p[7];
    c.colorB.r    = p[8];
    c.colorB.g    = p[9];
    c.colorB.b    = p[10];
    c.param1      = p[11];
    c.param2      = p[12];
    c.brightness  = p[13];
    // p[14], p[15] are reserved and ignored on decode.
    outCues[i] = c;
    p += CUE_BYTES;
  }
  outCount = cueCount;
  return true;
}

// ── Encode ────────────────────────────────────────────────────────────────────
// Writes version=1, pixelCount=PIXEL_COUNT, cueCount=count, then the cues. Caller
// must supply a buffer of at least HEADER_BYTES + CUE_BYTES*count bytes.
size_t encodeSequence(const Cue* cues, uint16_t count, uint8_t* out) {
  out[0] = 1;                       // version
  wr16(out + 1, PIXEL_COUNT);       // pixelCount
  wr16(out + 3, count);             // cueCount

  uint8_t* p = out + HEADER_BYTES;
  for (uint16_t i = 0; i < count; ++i) {
    const Cue& c = cues[i];
    p[0]  = c.effect;
    wr32(p + 1, c.durationMs);
    p[5]  = c.colorA.r;
    p[6]  = c.colorA.g;
    p[7]  = c.colorA.b;
    p[8]  = c.colorB.r;
    p[9]  = c.colorB.g;
    p[10] = c.colorB.b;
    p[11] = c.param1;
    p[12] = c.param2;
    p[13] = c.brightness;
    p[14] = 0;                      // reserved
    p[15] = 0;                      // reserved
    p += CUE_BYTES;
  }
  return (size_t)HEADER_BYTES + (size_t)CUE_BYTES * (size_t)count;
}

// ── CRC32 — IEEE 802.3 (poly 0xEDB88320 reflected, init/final XOR 0xFFFFFFFF) ──
uint32_t crc32(const uint8_t* data, size_t len) {
  uint32_t crc = 0xFFFFFFFFu;
  for (size_t i = 0; i < len; ++i) {
    crc ^= (uint32_t)data[i];
    for (int b = 0; b < 8; ++b) {
      uint32_t mask = (uint32_t)(-(int32_t)(crc & 1u));
      crc = (crc >> 1) ^ (0xEDB88320u & mask);
    }
  }
  return crc ^ 0xFFFFFFFFu;
}

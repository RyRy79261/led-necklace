// test_main.cpp — Unity host tests for the portable firmware engine (env:native).
//
// These are the CROSS-IMPLEMENTATION golden checks: every literal below is transcribed
// byte-for-byte from shared/test-vectors.json, which is the authoritative tie-breaker.
// Covers: codec round-trip, renderCue for all 9 effect vectors, gamma endpoints + midpoint,
// and the player state machine (auto-advance, manual hold, end-of-sequence stop, goto clamp).
#include <unity.h>
#include <string.h>
#include <stdlib.h>

#include "seq.h"
#include "effects.h"
#include "player.h"

void setUp(void) {}
void tearDown(void) {}

// ── Helpers ───────────────────────────────────────────────────────────────────
static void assertRenderEq(const Cue& cue, uint32_t elapsedMs,
                           uint8_t er, uint8_t eg, uint8_t eb) {
  RGB got = renderCue(cue, elapsedMs);
  TEST_ASSERT_EQUAL_UINT8(er, got.r);
  TEST_ASSERT_EQUAL_UINT8(eg, got.g);
  TEST_ASSERT_EQUAL_UINT8(eb, got.b);
}

// ── §2 Codec — the one worked example from test-vectors.json → codec ───────────
// sequence: 1 cue { effect 0, durationMs 5000, colorA [255,0,0], colorB [0,0,0],
//                   param1 0, param2 0, brightness 255 }
// bytes (21): [1,30,0,1,0,0,136,19,0,0,255,0,0,0,0,0,0,0,255,0,0]
void test_codec_encode_matches_vector(void) {
  Cue cue;
  cue.effect     = 0;
  cue.durationMs = 5000;
  cue.colorA.r = 255; cue.colorA.g = 0; cue.colorA.b = 0;
  cue.colorB.r = 0;   cue.colorB.g = 0; cue.colorB.b = 0;
  cue.param1 = 0;
  cue.param2 = 0;
  cue.brightness = 255;

  const uint8_t expected[21] = {
    1, 30, 0, 1, 0, 0, 136, 19, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0
  };

  uint8_t out[21];
  memset(out, 0xAA, sizeof(out));
  size_t n = encodeSequence(&cue, 1, out);

  TEST_ASSERT_EQUAL_size_t(21, n);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(expected, out, 21);
}

void test_codec_decode_matches_vector(void) {
  const uint8_t bytes[21] = {
    1, 30, 0, 1, 0, 0, 136, 19, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0
  };
  Cue cues[4];
  uint16_t count = 0;
  bool ok = decodeSequence(bytes, sizeof(bytes), cues, 4, count);

  TEST_ASSERT_TRUE(ok);
  TEST_ASSERT_EQUAL_UINT16(1, count);
  TEST_ASSERT_EQUAL_UINT8(0, cues[0].effect);
  TEST_ASSERT_EQUAL_UINT32(5000, cues[0].durationMs);
  TEST_ASSERT_EQUAL_UINT8(255, cues[0].colorA.r);
  TEST_ASSERT_EQUAL_UINT8(0,   cues[0].colorA.g);
  TEST_ASSERT_EQUAL_UINT8(0,   cues[0].colorA.b);
  TEST_ASSERT_EQUAL_UINT8(0,   cues[0].colorB.r);
  TEST_ASSERT_EQUAL_UINT8(0,   cues[0].colorB.g);
  TEST_ASSERT_EQUAL_UINT8(0,   cues[0].colorB.b);
  TEST_ASSERT_EQUAL_UINT8(0,   cues[0].param1);
  TEST_ASSERT_EQUAL_UINT8(0,   cues[0].param2);
  TEST_ASSERT_EQUAL_UINT8(255, cues[0].brightness);
}

void test_codec_roundtrip(void) {
  // Two varied cues → encode → decode → fields identical.
  Cue in[2];
  in[0].effect = EFFECT_FADE;   in[0].durationMs = 1234;
  in[0].colorA = {10, 20, 30};  in[0].colorB = {40, 50, 60};
  in[0].param1 = 7; in[0].param2 = 200; in[0].brightness = 111;
  in[1].effect = EFFECT_STROBE; in[1].durationMs = 4000000000u; // exercises full u32 LE
  in[1].colorA = {1, 2, 3};     in[1].colorB = {4, 5, 6};
  in[1].param1 = 100; in[1].param2 = 128; in[1].brightness = 255;

  uint8_t buf[HEADER_BYTES + CUE_BYTES * 2];
  size_t n = encodeSequence(in, 2, buf);
  TEST_ASSERT_EQUAL_size_t(sizeof(buf), n);

  Cue out[2];
  uint16_t count = 0;
  TEST_ASSERT_TRUE(decodeSequence(buf, n, out, 2, count));
  TEST_ASSERT_EQUAL_UINT16(2, count);
  for (int i = 0; i < 2; ++i) {
    TEST_ASSERT_EQUAL_UINT8(in[i].effect, out[i].effect);
    TEST_ASSERT_EQUAL_UINT32(in[i].durationMs, out[i].durationMs);
    TEST_ASSERT_EQUAL_UINT8(in[i].colorA.r, out[i].colorA.r);
    TEST_ASSERT_EQUAL_UINT8(in[i].colorA.g, out[i].colorA.g);
    TEST_ASSERT_EQUAL_UINT8(in[i].colorA.b, out[i].colorA.b);
    TEST_ASSERT_EQUAL_UINT8(in[i].colorB.r, out[i].colorB.r);
    TEST_ASSERT_EQUAL_UINT8(in[i].colorB.g, out[i].colorB.g);
    TEST_ASSERT_EQUAL_UINT8(in[i].colorB.b, out[i].colorB.b);
    TEST_ASSERT_EQUAL_UINT8(in[i].param1, out[i].param1);
    TEST_ASSERT_EQUAL_UINT8(in[i].param2, out[i].param2);
    TEST_ASSERT_EQUAL_UINT8(in[i].brightness, out[i].brightness);
  }
}

void test_codec_reject_bad_version(void) {
  uint8_t bytes[21] = {
    2, 30, 0, 1, 0, 0, 136, 19, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0
  };
  Cue cues[4]; uint16_t count = 99;
  TEST_ASSERT_FALSE(decodeSequence(bytes, sizeof(bytes), cues, 4, count));
}

void test_codec_reject_bad_length(void) {
  // Header claims 1 cue (needs 21 bytes) but we pass 20.
  uint8_t bytes[20] = {
    1, 30, 0, 1, 0, 0, 136, 19, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0
  };
  Cue cues[4]; uint16_t count = 99;
  TEST_ASSERT_FALSE(decodeSequence(bytes, sizeof(bytes), cues, 4, count));
}

void test_codec_reject_over_maxcues(void) {
  const uint8_t bytes[21] = {
    1, 30, 0, 1, 0, 0, 136, 19, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0
  };
  Cue cues[4]; uint16_t count = 99;
  TEST_ASSERT_FALSE(decodeSequence(bytes, sizeof(bytes), cues, /*maxCues=*/0, count));
}

void test_codec_pixelcount_not30_still_decodes(void) {
  // pixelCount = 16 (warn-but-play): decode must still succeed.
  uint8_t bytes[21] = {
    1, 16, 0, 1, 0, 0, 136, 19, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0
  };
  Cue cues[4]; uint16_t count = 0;
  TEST_ASSERT_TRUE(decodeSequence(bytes, sizeof(bytes), cues, 4, count));
  TEST_ASSERT_EQUAL_UINT16(1, count);
}

void test_crc32_matches_reference(void) {
  // Cross-check against the standard IEEE 802.3 value for the ASCII string
  // "123456789" (the canonical CRC-32 check value = 0xCBF43926).
  const uint8_t check[9] = { '1','2','3','4','5','6','7','8','9' };
  TEST_ASSERT_EQUAL_HEX32(0xCBF43926u, crc32(check, 9));
  // Empty input → init ^ finalXOR = 0.
  TEST_ASSERT_EQUAL_HEX32(0x00000000u, crc32(check, 0));
}

// ── §3 Effects — the 9 golden vectors (renderCue LINEAR output, exact) ─────────
void test_effect_solid_scales_by_brightness(void) {
  Cue c = {0, 1000, {255,0,0}, {0,0,0}, 0, 0, 128};
  assertRenderEq(c, 250, 128, 0, 0);
}
void test_effect_fade_start_is_colorA(void) {
  Cue c = {1, 1000, {255,0,0}, {0,0,255}, 0, 0, 255};
  assertRenderEq(c, 0, 255, 0, 0);
}
void test_effect_fade_mid_is_5050_lerp(void) {
  Cue c = {1, 1000, {255,0,0}, {0,0,255}, 0, 0, 255};
  assertRenderEq(c, 500, 128, 0, 128);
}
void test_effect_fade_end_is_colorB(void) {
  Cue c = {1, 1000, {255,0,0}, {0,0,255}, 0, 0, 255};
  assertRenderEq(c, 1000, 0, 0, 255);
}
void test_effect_breathe_trough_at_phase0(void) {
  Cue c = {2, 4000, {0,255,0}, {0,0,0}, 100, 0, 255};
  assertRenderEq(c, 0, 0, 0, 0);
}
void test_effect_breathe_peak_at_half_period(void) {
  Cue c = {2, 4000, {0,255,0}, {0,0,0}, 100, 0, 255};
  assertRenderEq(c, 500, 0, 255, 0);
}
void test_effect_breathe_half_at_quarter_period(void) {
  Cue c = {2, 4000, {0,255,0}, {0,0,0}, 100, 0, 255};
  assertRenderEq(c, 250, 0, 128, 0);
}
void test_effect_strobe_on_within_duty(void) {
  Cue c = {3, 4000, {255,255,255}, {0,0,0}, 100, 128, 255};
  assertRenderEq(c, 400, 255, 255, 255);
}
void test_effect_strobe_off_past_duty(void) {
  Cue c = {3, 4000, {255,255,255}, {0,0,0}, 100, 128, 255};
  assertRenderEq(c, 600, 0, 0, 0);
}

// ── §3 Gamma — endpoints exact, midpoint within tolerance 1 ───────────────────
void test_gamma_endpoints_and_midpoint(void) {
  TEST_ASSERT_EQUAL_UINT8(0,   gamma8(0));     // tolerance 0
  TEST_ASSERT_EQUAL_UINT8(255, gamma8(255));   // tolerance 0
  TEST_ASSERT_INT_WITHIN(1, 56, (int)gamma8(128)); // expected 56, tolerance 1
}

// ── §4 Player state machine ───────────────────────────────────────────────────
// Fixture: 3 solid cues, 1000ms each, distinct colours so the display frame is checkable.
static Cue makeSeq3(Cue* buf) {
  buf[0] = {EFFECT_SOLID, 1000, {255,0,0}, {0,0,0}, 0, 0, 255};
  buf[1] = {EFFECT_SOLID, 1000, {0,255,0}, {0,0,0}, 0, 0, 255};
  buf[2] = {EFFECT_SOLID, 1000, {0,0,255}, {0,0,0}, 0, 0, 255};
  return buf[0];
}

void test_player_auto_advance(void) {
  Cue cues[3]; makeSeq3(cues);
  Player p; p.setSequence(cues, 3);
  RGB frame[PIXEL_COUNT];

  p.play(MODE_AUTO, 0);
  TEST_ASSERT_TRUE(p.isPlaying());
  TEST_ASSERT_EQUAL_UINT16(0, p.currentCue());

  p.tick(500, frame);                            // mid cue 0 → still 0
  TEST_ASSERT_EQUAL_UINT16(0, p.currentCue());
  TEST_ASSERT_EQUAL_UINT8(255, frame[0].r);      // red, full brightness, gamma(255)=255

  p.tick(1000, frame);                           // elapsed==duration → advance to cue 1
  TEST_ASSERT_EQUAL_UINT16(1, p.currentCue());
  TEST_ASSERT_TRUE(p.isPlaying());
  TEST_ASSERT_EQUAL_UINT8(255, frame[0].g);      // green now
  TEST_ASSERT_EQUAL_UINT8(0,   frame[0].r);

  p.tick(2000, frame);                           // advance to cue 2
  TEST_ASSERT_EQUAL_UINT16(2, p.currentCue());
  TEST_ASSERT_TRUE(p.isPlaying());
}

void test_player_auto_end_stops_and_blacks_out(void) {
  Cue cues[3]; makeSeq3(cues);
  Player p; p.setSequence(cues, 3);
  RGB frame[PIXEL_COUNT];

  // tick advances at most ONE cue per call (single `if` per DATA-MODEL §4); at 30-60 FPS a
  // cue boundary is crossed on the tick where elapsed just reaches duration. Walk to the end.
  p.play(MODE_AUTO, 0);
  p.tick(1000, frame); TEST_ASSERT_EQUAL_UINT16(1, p.currentCue()); // cue 0 → 1
  p.tick(2000, frame); TEST_ASSERT_EQUAL_UINT16(2, p.currentCue()); // cue 1 → 2
  TEST_ASSERT_TRUE(p.isPlaying());
  p.tick(3000, frame);   // cue 2 ends → next() beyond last → stop() + blackout
  TEST_ASSERT_FALSE(p.isPlaying());
  for (uint16_t i = 0; i < PIXEL_COUNT; ++i) {
    TEST_ASSERT_EQUAL_UINT8(0, frame[i].r);
    TEST_ASSERT_EQUAL_UINT8(0, frame[i].g);
    TEST_ASSERT_EQUAL_UINT8(0, frame[i].b);
  }
}

void test_player_next_past_last_stops(void) {
  Cue cues[3]; makeSeq3(cues);
  Player p; p.setSequence(cues, 3);
  p.play(MODE_MANUAL, 0);
  p.next(10);   // → cue 1
  TEST_ASSERT_EQUAL_UINT16(1, p.currentCue());
  TEST_ASSERT_TRUE(p.isPlaying());
  p.next(20);   // → cue 2
  TEST_ASSERT_EQUAL_UINT16(2, p.currentCue());
  TEST_ASSERT_TRUE(p.isPlaying());
  p.next(30);   // past last → stop
  TEST_ASSERT_FALSE(p.isPlaying());
}

void test_player_manual_holds_cue(void) {
  Cue cues[3]; makeSeq3(cues);
  Player p; p.setSequence(cues, 3);
  RGB frame[PIXEL_COUNT];

  p.play(MODE_MANUAL, 0);
  p.tick(5000, frame);                       // manual NEVER auto-advances
  TEST_ASSERT_EQUAL_UINT16(0, p.currentCue());
  TEST_ASSERT_TRUE(p.isPlaying());

  p.next(5000);                              // NEXT is the only way forward
  TEST_ASSERT_EQUAL_UINT16(1, p.currentCue());
  p.tick(999999, frame);
  TEST_ASSERT_EQUAL_UINT16(1, p.currentCue());
}

void test_player_manual_breathe_animates_on_hold(void) {
  // A held BREATHE cue keeps animating from `elapsed` even though the cue never advances.
  Cue cues[1] = { {EFFECT_BREATHE, 4000, {0,255,0}, {0,0,0}, 100, 0, 255} };
  Player p; p.setSequence(cues, 1);
  RGB frame[PIXEL_COUNT];

  p.play(MODE_MANUAL, 0);
  p.tick(0, frame);      // phase 0 → trough → black
  TEST_ASSERT_EQUAL_UINT8(0, frame[0].g);
  p.tick(500, frame);    // half period → peak → full green (gamma(255)=255)
  TEST_ASSERT_EQUAL_UINT8(255, frame[0].g);
  TEST_ASSERT_EQUAL_UINT16(0, p.currentCue());  // still held on cue 0
}

void test_player_goto_clamps(void) {
  Cue cues[3]; makeSeq3(cues);
  Player p; p.setSequence(cues, 3);

  p.play(MODE_MANUAL, 0);
  p.goto_(1000, 0);                          // clamp above range → last cue
  TEST_ASSERT_EQUAL_UINT16(2, p.currentCue());
  p.goto_(1, 0);
  TEST_ASSERT_EQUAL_UINT16(1, p.currentCue());
}

void test_player_prev_floors_at_zero(void) {
  Cue cues[3]; makeSeq3(cues);
  Player p; p.setSequence(cues, 3);
  p.play(MODE_MANUAL, 0);
  p.goto_(2, 0);
  p.prev(0);  TEST_ASSERT_EQUAL_UINT16(1, p.currentCue());
  p.prev(0);  TEST_ASSERT_EQUAL_UINT16(0, p.currentCue());
  p.prev(0);  TEST_ASSERT_EQUAL_UINT16(0, p.currentCue());  // floors at 0
}

void test_player_stopped_tick_is_blackout(void) {
  Cue cues[3]; makeSeq3(cues);
  Player p; p.setSequence(cues, 3);
  RGB frame[PIXEL_COUNT];
  // Never played → stopped → blackout.
  p.tick(100, frame);
  TEST_ASSERT_EQUAL_UINT8(0, frame[0].r);
  TEST_ASSERT_EQUAL_UINT8(0, frame[0].g);
  TEST_ASSERT_EQUAL_UINT8(0, frame[0].b);
}

void test_player_master_brightness_scales_linear_before_gamma(void) {
  // Solid full-red cue at master=128. Pipeline: gamma8( 255 * 128/255 ) = gamma8(128) ≈ 56.
  Cue cues[1] = { {EFFECT_SOLID, 1000, {255,0,0}, {0,0,0}, 0, 0, 255} };
  Player p; p.setSequence(cues, 1);
  p.setMasterBrightness(128);
  TEST_ASSERT_EQUAL_UINT8(128, p.masterBrightness());

  RGB frame[PIXEL_COUNT];
  p.play(MODE_MANUAL, 0);
  p.tick(0, frame);
  TEST_ASSERT_INT_WITHIN(1, 56, (int)frame[0].r);   // gamma8(128) within tolerance 1
  TEST_ASSERT_EQUAL_UINT8(0, frame[0].g);
  TEST_ASSERT_EQUAL_UINT8(0, frame[0].b);
}

// ── Runner ────────────────────────────────────────────────────────────────────
int main(int, char**) {
  UNITY_BEGIN();

  // codec
  RUN_TEST(test_codec_encode_matches_vector);
  RUN_TEST(test_codec_decode_matches_vector);
  RUN_TEST(test_codec_roundtrip);
  RUN_TEST(test_codec_reject_bad_version);
  RUN_TEST(test_codec_reject_bad_length);
  RUN_TEST(test_codec_reject_over_maxcues);
  RUN_TEST(test_codec_pixelcount_not30_still_decodes);
  RUN_TEST(test_crc32_matches_reference);

  // effects
  RUN_TEST(test_effect_solid_scales_by_brightness);
  RUN_TEST(test_effect_fade_start_is_colorA);
  RUN_TEST(test_effect_fade_mid_is_5050_lerp);
  RUN_TEST(test_effect_fade_end_is_colorB);
  RUN_TEST(test_effect_breathe_trough_at_phase0);
  RUN_TEST(test_effect_breathe_peak_at_half_period);
  RUN_TEST(test_effect_breathe_half_at_quarter_period);
  RUN_TEST(test_effect_strobe_on_within_duty);
  RUN_TEST(test_effect_strobe_off_past_duty);

  // gamma
  RUN_TEST(test_gamma_endpoints_and_midpoint);

  // player
  RUN_TEST(test_player_auto_advance);
  RUN_TEST(test_player_auto_end_stops_and_blacks_out);
  RUN_TEST(test_player_next_past_last_stops);
  RUN_TEST(test_player_manual_holds_cue);
  RUN_TEST(test_player_manual_breathe_animates_on_hold);
  RUN_TEST(test_player_goto_clamps);
  RUN_TEST(test_player_prev_floors_at_zero);
  RUN_TEST(test_player_stopped_tick_is_blackout);
  RUN_TEST(test_player_master_brightness_scales_linear_before_gamma);

  return UNITY_END();
}

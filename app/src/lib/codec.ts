import { CUE_BYTES, HEADER_BYTES, PIXEL_COUNT, type Cue, type RGB, type Sequence } from '@/lib/types';

/**
 * Encode a Sequence to its little-endian binary wire format.
 * Layout: 5-byte header + 16 bytes per cue (see shared/DATA-MODEL.md section 2).
 */
export function encodeSequence(seq: Sequence): Uint8Array {
  const cueCount = seq.cues.length;
  const buf = new Uint8Array(HEADER_BYTES + CUE_BYTES * cueCount);
  const view = new DataView(buf.buffer);

  // Header (5 bytes)
  view.setUint8(0, seq.version & 0xff);
  // Always write the fixed contract pixel count (30), not seq.pixelCount, so the app
  // and firmware produce byte-identical blobs even if an in-memory Sequence carries a
  // stale value. Firmware encodeSequence hard-codes PIXEL_COUNT the same way.
  view.setUint16(1, PIXEL_COUNT, true);
  view.setUint16(3, cueCount, true);

  // Cues (16 bytes each)
  let off = HEADER_BYTES;
  for (const cue of seq.cues) {
    view.setUint8(off, cue.effect & 0xff);
    view.setUint32(off + 1, cue.durationMs >>> 0, true);
    buf[off + 5] = cue.colorA[0] & 0xff;
    buf[off + 6] = cue.colorA[1] & 0xff;
    buf[off + 7] = cue.colorA[2] & 0xff;
    buf[off + 8] = cue.colorB[0] & 0xff;
    buf[off + 9] = cue.colorB[1] & 0xff;
    buf[off + 10] = cue.colorB[2] & 0xff;
    buf[off + 11] = cue.param1 & 0xff;
    buf[off + 12] = cue.param2 & 0xff;
    buf[off + 13] = cue.brightness & 0xff;
    // off + 14, off + 15 are reserved (already zero)
    off += CUE_BYTES;
  }

  return buf;
}

/**
 * Decode a little-endian sequence blob back into a Sequence.
 * Rejects on version mismatch or a byte length that is not 5 + 16*cueCount.
 */
export function decodeSequence(bytes: Uint8Array): Sequence {
  if (bytes.length < HEADER_BYTES) {
    throw new Error(`sequence too short: ${bytes.length} bytes, need at least ${HEADER_BYTES}`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(0);
  const pixelCount = view.getUint16(1, true);
  const cueCount = view.getUint16(3, true);

  if (version !== 1) {
    throw new Error(`unsupported sequence version: ${version}`);
  }
  const expectedLen = HEADER_BYTES + CUE_BYTES * cueCount;
  if (bytes.length !== expectedLen) {
    throw new Error(`bad sequence length: ${bytes.length}, expected ${expectedLen} for ${cueCount} cues`);
  }
  if (pixelCount !== 30) {
    // Non-fatal per contract: warn but still play.
    // eslint-disable-next-line no-console
    console.warn(`unexpected pixelCount ${pixelCount}, expected 30`);
  }

  const cues: Cue[] = new Array(cueCount);
  let off = HEADER_BYTES;
  for (let i = 0; i < cueCount; i++) {
    const effect = view.getUint8(off);
    const durationMs = view.getUint32(off + 1, true);
    const colorA: RGB = [bytes[off + 5], bytes[off + 6], bytes[off + 7]];
    const colorB: RGB = [bytes[off + 8], bytes[off + 9], bytes[off + 10]];
    const param1 = bytes[off + 11];
    const param2 = bytes[off + 12];
    const brightness = bytes[off + 13];
    cues[i] = { effect, durationMs, colorA, colorB, param1, param2, brightness };
    off += CUE_BYTES;
  }

  return { version, pixelCount, cues };
}

// CRC32 lookup table (IEEE 802.3, reflected, poly 0xEDB88320), computed once.
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * CRC32, IEEE 802.3: poly 0xEDB88320, reflected, init 0xFFFFFFFF, final XOR
 * 0xFFFFFFFF. Returns an unsigned 32-bit integer.
 */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

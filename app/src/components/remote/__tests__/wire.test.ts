import { describe, expect, it } from 'vitest';
import {
  decodeCommand,
  encodeCommand,
  encodeStatus,
  parseStatus,
  type Command,
  type DeviceStatus,
} from '@/lib/ble';

// These tests assert the exact CMD + STATUS byte layouts from shared/PROTOCOL.md.
// They import only the pure wire codec, so they run without the other modules.

describe('encodeCommand — CMD characteristic byte layout', () => {
  it('play auto / manual', () => {
    expect(Array.from(encodeCommand({ op: 'play', mode: 'auto' }))).toEqual([0x01, 0x00]);
    expect(Array.from(encodeCommand({ op: 'play', mode: 'manual' }))).toEqual([0x01, 0x01]);
  });

  it('stop / next / prev / blackout', () => {
    expect(Array.from(encodeCommand({ op: 'stop' }))).toEqual([0x02]);
    expect(Array.from(encodeCommand({ op: 'next' }))).toEqual([0x03]);
    expect(Array.from(encodeCommand({ op: 'prev' }))).toEqual([0x04]);
    expect(Array.from(encodeCommand({ op: 'blackout' }))).toEqual([0x07]);
  });

  it('goto encodes cueIndex as u16 little-endian', () => {
    // 300 = 0x012C -> LE bytes 0x2C, 0x01
    expect(Array.from(encodeCommand({ op: 'goto', cueIndex: 300 }))).toEqual([0x05, 0x2c, 0x01]);
  });

  it('setBrightness clamps + rounds to a single byte', () => {
    expect(Array.from(encodeCommand({ op: 'setBrightness', value: 128 }))).toEqual([0x06, 0x80]);
    expect(Array.from(encodeCommand({ op: 'setBrightness', value: 999 }))).toEqual([0x06, 0xff]);
    expect(Array.from(encodeCommand({ op: 'setBrightness', value: -5 }))).toEqual([0x06, 0x00]);
  });

  it('setLoop encodes 0x08 + a bool byte', () => {
    expect(Array.from(encodeCommand({ op: 'setLoop', value: true }))).toEqual([0x08, 0x01]);
    expect(Array.from(encodeCommand({ op: 'setLoop', value: false }))).toEqual([0x08, 0x00]);
  });
});

describe('decodeCommand round-trips', () => {
  const cases: Command[] = [
    { op: 'play', mode: 'auto' },
    { op: 'play', mode: 'manual' },
    { op: 'stop' },
    { op: 'next' },
    { op: 'prev' },
    { op: 'goto', cueIndex: 513 },
    { op: 'setBrightness', value: 200 },
    { op: 'blackout' },
    { op: 'setLoop', value: true },
    { op: 'setLoop', value: false },
  ];
  it.each(cases)('%o survives encode -> decode', (cmd) => {
    expect(decodeCommand(encodeCommand(cmd))).toEqual(cmd);
  });

  it('rejects an unknown opcode', () => {
    expect(() => decodeCommand(Uint8Array.of(0x99))).toThrow();
  });
});

describe('STATUS 0x20 STATE layout', () => {
  it('encodes the 7-byte frame little-endian', () => {
    const s: DeviceStatus = {
      playing: true,
      mode: 'manual',
      cueIndex: 513, // 0x0201 -> LE 0x01, 0x02
      masterBrightness: 200,
      batteryPct: 255,
    };
    expect(Array.from(encodeStatus(s))).toEqual([0x20, 0x01, 0x01, 0x01, 0x02, 0xc8, 0xff]);
  });

  it('parses back to an equal status', () => {
    const s: DeviceStatus = {
      playing: false,
      mode: 'auto',
      cueIndex: 7,
      masterBrightness: 42,
      batteryPct: 90,
    };
    expect(parseStatus(encodeStatus(s))).toEqual(s);
  });
});

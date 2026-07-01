import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { decodeSequence, encodeSequence } from '@/lib/codec';
import { gamma8, renderCue } from '@/lib/effects';
import type { Cue, RGB, Sequence } from '@/lib/types';

interface EffectVector {
  name: string;
  cue: Cue;
  elapsedMs: number;
  expectedLinear: RGB;
}
interface GammaVector {
  in: number;
  out: number;
  tolerance: number;
}
interface TestVectors {
  codec: { sequence: Sequence; bytes: number[]; hex: string };
  effects: EffectVector[];
  gamma: GammaVector[];
}

// Read the frozen golden vectors from the repo-root shared/ contract.
const vectorsPath = resolve(__dirname, '../../../../shared/test-vectors.json');
const vectors = JSON.parse(readFileSync(vectorsPath, 'utf8')) as TestVectors;

describe('codec — matches the golden vector both directions', () => {
  it('encodeSequence produces the exact wire bytes', () => {
    const encoded = encodeSequence(vectors.codec.sequence);
    expect(Array.from(encoded)).toEqual(vectors.codec.bytes);
  });

  it('encoded bytes match the golden hex', () => {
    const encoded = encodeSequence(vectors.codec.sequence);
    const hex = Array.from(encoded)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    expect(hex).toBe(vectors.codec.hex);
  });

  it('decodeSequence reproduces the sequence', () => {
    const decoded = decodeSequence(new Uint8Array(vectors.codec.bytes));
    expect(decoded).toEqual(vectors.codec.sequence);
  });

  it('round-trips encode -> decode exactly', () => {
    const decoded = decodeSequence(encodeSequence(vectors.codec.sequence));
    expect(decoded).toEqual(vectors.codec.sequence);
  });

  it('rejects an unsupported version', () => {
    const bytes = new Uint8Array(vectors.codec.bytes);
    bytes[0] = 2;
    expect(() => decodeSequence(bytes)).toThrow();
  });

  it('rejects a truncated blob', () => {
    const bytes = new Uint8Array(vectors.codec.bytes).slice(0, -1);
    expect(() => decodeSequence(bytes)).toThrow();
  });
});

describe('effects — renderCue linear output matches every vector exactly', () => {
  for (const v of vectors.effects) {
    it(v.name, () => {
      const frame = renderCue(v.cue, v.elapsedMs);
      expect(frame).toHaveLength(30);
      // All 30 pixels share the same colour in v1.
      for (const px of frame) {
        expect(px).toEqual(v.expectedLinear);
      }
    });
  }
});

describe('gamma — endpoints exact, midpoint within tolerance', () => {
  for (const g of vectors.gamma) {
    it(`gamma8(${g.in}) ~= ${g.out} (+/-${g.tolerance})`, () => {
      const got = gamma8(g.in);
      expect(Math.abs(got - g.out)).toBeLessThanOrEqual(g.tolerance);
    });
  }
});

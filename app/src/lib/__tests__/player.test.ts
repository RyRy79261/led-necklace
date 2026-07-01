import { describe, expect, it } from 'vitest';

import { Player } from '@/lib/player';
import { Effect, type Cue, type Sequence } from '@/lib/types';

function solidCue(durationMs: number, colorA: [number, number, number] = [255, 0, 0]): Cue {
  return {
    effect: Effect.Solid,
    durationMs,
    colorA,
    colorB: [0, 0, 0],
    param1: 0,
    param2: 0,
    brightness: 255,
  };
}

function seqOf(...cues: Cue[]): Sequence {
  return { version: 1, pixelCount: 30, cues };
}

const isBlack = (frame: [number, number, number][]) =>
  frame.length === 30 && frame.every((px) => px[0] === 0 && px[1] === 0 && px[2] === 0);

describe('Player transport state machine', () => {
  it('starts stopped and ticks to a blackout frame', () => {
    const p = new Player(seqOf(solidCue(1000)));
    const frame = p.tick(0);
    expect(p.state.playing).toBe(false);
    expect(isBlack(frame)).toBe(true);
  });

  it('play(auto) resets to cue 0 and marks playing', () => {
    const p = new Player(seqOf(solidCue(1000), solidCue(1000)));
    p.tick(1000); // seed the internal clock
    p.play('auto');
    expect(p.state.mode).toBe('auto');
    expect(p.state.currentCue).toBe(0);
    expect(p.state.playing).toBe(true);
    expect(p.state.cueStartMs).toBe(1000);
  });

  it('auto mode advances when a cue duration elapses', () => {
    const p = new Player(seqOf(solidCue(1000), solidCue(1000)));
    p.tick(0);
    p.play('auto');

    p.tick(500);
    expect(p.state.currentCue).toBe(0);

    p.tick(1000); // elapsed == duration -> advance to cue 1
    expect(p.state.currentCue).toBe(1);
    expect(p.state.playing).toBe(true);
    expect(p.state.cueStartMs).toBe(1000);
  });

  it('auto mode stops (blackout) at end of sequence', () => {
    const p = new Player(seqOf(solidCue(1000), solidCue(1000)));
    p.tick(0);
    p.play('auto');
    p.tick(1000); // -> cue 1
    const frame = p.tick(2000); // past last cue -> stop
    expect(p.state.playing).toBe(false);
    expect(isBlack(frame)).toBe(true);
  });

  it('manual mode never auto-advances; NEXT is the only way forward', () => {
    const p = new Player(seqOf(solidCue(1000), solidCue(1000)));
    p.tick(0);
    p.play('manual');

    p.tick(5000); // long past duration, but manual holds
    expect(p.state.currentCue).toBe(0);
    expect(p.state.playing).toBe(true);

    p.next(); // internal clock is now 5000
    expect(p.state.currentCue).toBe(1);
    expect(p.state.cueStartMs).toBe(5000);
  });

  it('manual NEXT past the last cue stops', () => {
    const p = new Player(seqOf(solidCue(1000), solidCue(1000)));
    p.tick(0);
    p.play('manual');
    p.next(); // -> cue 1
    p.next(); // -> past end -> stop
    expect(p.state.playing).toBe(false);
  });

  it('prev steps back and clamps at 0', () => {
    const p = new Player(seqOf(solidCue(1000), solidCue(1000), solidCue(1000)));
    p.tick(0);
    p.play('manual');
    p.next();
    p.next();
    expect(p.state.currentCue).toBe(2);
    p.prev();
    expect(p.state.currentCue).toBe(1);
    p.prev();
    p.prev();
    expect(p.state.currentCue).toBe(0);
  });

  it('goto clamps the index into range', () => {
    const p = new Player(seqOf(solidCue(1000), solidCue(1000), solidCue(1000)));
    p.tick(0);
    p.play('auto');

    p.goto(99);
    expect(p.state.currentCue).toBe(2); // last index

    p.goto(-5);
    expect(p.state.currentCue).toBe(0);

    p.goto(1);
    expect(p.state.currentCue).toBe(1);
  });

  it('stop() blacks out output', () => {
    const p = new Player(seqOf(solidCue(1000)));
    p.tick(0);
    p.play('auto');
    p.stop();
    expect(p.state.playing).toBe(false);
    expect(isBlack(p.tick(10))).toBe(true);
  });

  it('renders a non-black frame while a solid cue plays', () => {
    const p = new Player(seqOf(solidCue(1000, [255, 0, 0])));
    p.tick(0);
    p.play('auto');
    const frame = p.tick(10);
    expect(isBlack(frame)).toBe(false);
    // gamma8(255) == 255, so full red survives the display pipeline.
    expect(frame[0]).toEqual([255, 0, 0]);
  });

  it('masterBrightness scales output in the linear domain before gamma', () => {
    const p = new Player(seqOf(solidCue(1000, [255, 0, 0])));
    p.tick(0);
    p.play('auto');
    p.setBrightness(0);
    expect(isBlack(p.tick(10))).toBe(true);
  });
});

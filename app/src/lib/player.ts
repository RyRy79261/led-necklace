import { PIXEL_COUNT, type RGB, type Sequence } from '@/lib/types';
import { applyDisplay, renderCue } from '@/lib/effects';

export type PlayMode = 'auto' | 'manual';

/** Player state machine, per shared/DATA-MODEL.md section 4. */
export interface PlayerState {
  sequence: Sequence;
  mode: PlayMode;
  currentCue: number;
  cueStartMs: number;
  playing: boolean;
}

function blackout(): RGB[] {
  const frame: RGB[] = new Array(PIXEL_COUNT);
  for (let i = 0; i < PIXEL_COUNT; i++) frame[i] = [0, 0, 0];
  return frame;
}

export class Player {
  private sequence: Sequence;
  private mode: PlayMode = 'auto';
  private currentCue = 0;
  private cueStartMs = 0;
  private playing = false;
  // Loop flag (DATA-MODEL §4 "v2 loop flag"): when set, next() past the last cue wraps to 0
  // instead of stopping. Off by default; an explicit stop() still stops.
  private looping = false;
  // masterBrightness is a runtime global (BLE SET_BRIGHTNESS), default 255.
  private masterBrightness = 255;
  // Internal clock: the most recent time seen by tick(). Transitions anchor
  // cueStartMs to this, since their signatures (per the frozen contract) take
  // no `now` argument. A continuously-running tick loop keeps it fresh.
  private lastNow = 0;
  // Whether tick() has seen a real timestamp yet. Until it has, the frozen no-arg
  // transition methods can only anchor cueStartMs to a stale lastNow (0); the first
  // tick rebases so a command issued before the clock started can't skip cue 0.
  private clockStarted = false;

  constructor(sequence: Sequence) {
    this.sequence = sequence;
  }

  /** Readable snapshot of the current player state. */
  get state(): PlayerState {
    return {
      sequence: this.sequence,
      mode: this.mode,
      currentCue: this.currentCue,
      cueStartMs: this.cueStartMs,
      playing: this.playing,
    };
  }

  /** Runtime master brightness (0..255), applied in the display pipeline. */
  setBrightness(value: number): void {
    this.masterBrightness = value < 0 ? 0 : value > 255 ? 255 : value;
  }

  /** Loop flag: when set, the sequence wraps to cue 0 at the end instead of stopping. */
  setLoop(enabled: boolean): void {
    this.looping = enabled;
  }
  get loop(): boolean {
    return this.looping;
  }

  /** Set mode, reset to first cue, mark playing. */
  play(mode: PlayMode): void {
    this.mode = mode;
    this.currentCue = 0;
    this.cueStartMs = this.lastNow;
    this.playing = true;
  }

  /** Stop playback (output blackout). */
  stop(): void {
    this.playing = false;
  }

  /** Advance one cue; at the end wrap to 0 if looping, else stop. */
  next(): void {
    this.currentCue += 1;
    this.cueStartMs = this.lastNow;
    if (this.currentCue >= this.sequence.cues.length) {
      if (this.looping && this.sequence.cues.length > 0) {
        this.currentCue = 0; // loop flag: wrap instead of stopping
      } else {
        this.stop();
      }
    }
  }

  /** Step back one cue (min 0). */
  prev(): void {
    this.currentCue = Math.max(0, this.currentCue - 1);
    this.cueStartMs = this.lastNow;
  }

  /** Jump to a clamped cue index. */
  goto(i: number): void {
    const last = this.sequence.cues.length - 1;
    this.currentCue = last < 0 ? 0 : Math.min(Math.max(i, 0), last);
    this.cueStartMs = this.lastNow;
  }

  /** Advance the clock and return the display-pipeline frame (or blackout). */
  tick(nowMs: number): RGB[] {
    if (!this.clockStarted) {
      // First real timestamp: adopt it and rebase the current cue so elapsed starts
      // at 0 (matches the firmware, which stamps a real `now` on every transition).
      this.clockStarted = true;
      this.cueStartMs = nowMs;
    }
    this.lastNow = nowMs;
    if (!this.playing) return blackout();

    const cues = this.sequence.cues;
    if (cues.length === 0) {
      this.stop();
      return blackout();
    }

    if (this.mode === 'auto') {
      // Walk durations. next() re-anchors cueStartMs to nowMs, so elapsed resets
      // to 0 after each advance; the loop only continues through zero-duration
      // cues and terminates at end-of-sequence (which stops playback, unless looping).
      let advanced = 0;
      while (this.playing) {
        const cue = cues[this.currentCue];
        const elapsed = nowMs - this.cueStartMs;
        if (elapsed >= cue.durationMs) {
          this.next();
          // Guard: an all-zero-duration sequence under loop would spin forever. Cap advances at
          // cueCount per tick, then render whatever cue we landed on. (Never triggers for a
          // sequence with any positive-duration cue, so real content stays bit-identical.)
          if (++advanced > cues.length) break;
        } else {
          break;
        }
      }
      if (!this.playing) return blackout();
    }

    const cue = cues[this.currentCue];
    const elapsed = nowMs - this.cueStartMs;
    const frame = renderCue(cue, elapsed);
    return applyDisplay(frame, this.masterBrightness);
  }
}

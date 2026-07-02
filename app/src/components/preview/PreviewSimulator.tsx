'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { applyDisplay } from '@/lib/effects';
import { Player, type PlayMode } from '@/lib/player';
import { Effect, type Sequence } from '@/lib/types';
import {
  loadSequence,
  type SequenceSource,
} from '@/components/preview/demoSequence';
import {
  NecklaceCanvas,
  type NecklaceCanvasHandle,
} from '@/components/preview/NecklaceCanvas';

const EFFECT_NAMES: Record<Effect, string> = {
  [Effect.Solid]: 'Solid',
  [Effect.Fade]: 'Fade',
  [Effect.Breathe]: 'Breathe',
  [Effect.Strobe]: 'Strobe',
};

export function PreviewSimulator() {
  // --- UI state (re-renders the controls, not the canvas) ---
  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [source, setSource] = useState<SequenceSource>('demo');
  const [mode, setMode] = useState<PlayMode>('auto');
  const [playing, setPlaying] = useState(false);
  const [masterBrightness, setMasterBrightness] = useState(255);
  const [cueIndex, setCueIndex] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  // --- imperative refs read/written by the animation loop ---
  const playerRef = useRef<Player | null>(null);
  const canvasRef = useRef<NecklaceCanvasHandle | null>(null);
  const brightnessRef = useRef(masterBrightness);
  const rafRef = useRef<number | null>(null);

  // Mirrors so the loop can detect changes without depending on state.
  const playingRef = useRef(false);
  const cueIndexRef = useRef(0);
  const elapsedTenthRef = useRef(-1);

  useEffect(() => {
    brightnessRef.current = masterBrightness;
  }, [masterBrightness]);

  const resetReadouts = useCallback(() => {
    playingRef.current = false;
    cueIndexRef.current = 0;
    elapsedTenthRef.current = -1;
    setPlaying(false);
    setCueIndex(0);
    setElapsedMs(0);
  }, []);

  // Boot: load the sequence, build the player, run the render loop.
  useEffect(() => {
    const loaded = loadSequence();
    playerRef.current = new Player(loaded.sequence);
    playerRef.current.setLoop(loaded.sequence.loop ?? true);
    setSequence(loaded.sequence);
    setSource(loaded.source);

    const loop = () => {
      const player = playerRef.current;
      if (player) {
        const now = performance.now();
        // Player.tick returns the linear (pre-gamma, pre-master) frame or a
        // blackout; the master-brightness slider is applied here via
        // applyDisplay before it hits the canvas.
        const frame = player.tick(now);
        const display = applyDisplay(frame, brightnessRef.current);
        canvasRef.current?.draw(display);

        const st = player.state;
        if (st.playing !== playingRef.current) {
          playingRef.current = st.playing;
          setPlaying(st.playing);
        }
        if (st.currentCue !== cueIndexRef.current) {
          cueIndexRef.current = st.currentCue;
          setCueIndex(st.currentCue);
        }
        const tenth = st.playing
          ? Math.floor(Math.max(0, now - st.cueStartMs) / 100)
          : 0;
        if (tenth !== elapsedTenthRef.current) {
          elapsedTenthRef.current = tenth;
          setElapsedMs(tenth * 100);
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handlePlay = useCallback(() => {
    playerRef.current?.play(mode);
  }, [mode]);

  const handleStop = useCallback(() => {
    playerRef.current?.stop();
  }, []);

  const handleNext = useCallback(() => {
    playerRef.current?.next();
  }, []);

  const handlePrev = useCallback(() => {
    playerRef.current?.prev();
  }, []);

  const handleModeChange = useCallback((next: PlayMode) => {
    setMode(next);
    const player = playerRef.current;
    // Mode only changes via play(); re-apply live if already running.
    if (player && player.state.playing) player.play(next);
  }, []);

  const handleReload = useCallback(() => {
    const loaded = loadSequence();
    playerRef.current = new Player(loaded.sequence);
    playerRef.current.setLoop(loaded.sequence.loop ?? true);
    setSequence(loaded.sequence);
    setSource(loaded.source);
    resetReadouts();
  }, [resetReadouts]);

  const cueCount = sequence?.cues.length ?? 0;
  const currentCue =
    sequence && cueIndex < sequence.cues.length
      ? sequence.cues[cueIndex]
      : null;

  return (
    <div className="space-y-5">
      <NecklaceCanvas ref={canvasRef} />

      {/* Transport */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handlePlay}
          className="rounded-md bg-stage-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          {playing ? 'Restart' : 'Play'}
        </button>
        <button
          type="button"
          onClick={handleStop}
          disabled={!playing}
          className="rounded-md border border-stage-border bg-stage-panel px-4 py-2 text-sm font-medium text-neutral-200 transition-colors hover:border-stage-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          Stop
        </button>
        <button
          type="button"
          onClick={handlePrev}
          disabled={!playing}
          className="rounded-md border border-stage-border bg-stage-panel px-4 py-2 text-sm font-medium text-neutral-200 transition-colors hover:border-stage-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          Prev
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={!playing}
          className="rounded-md border border-stage-border bg-stage-panel px-4 py-2 text-sm font-medium text-neutral-200 transition-colors hover:border-stage-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>

        {/* Auto / Manual */}
        <div
          role="radiogroup"
          aria-label="Playback mode"
          className="ml-auto flex overflow-hidden rounded-md border border-stage-border"
        >
          {(['auto', 'manual'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => handleModeChange(m)}
              className={`px-3 py-2 text-sm font-medium capitalize transition-colors ${
                mode === m
                  ? 'bg-stage-accent text-white'
                  : 'bg-stage-panel text-neutral-300 hover:text-white'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Master brightness */}
      <div className="rounded-lg border border-stage-border bg-stage-panel p-4">
        <label
          htmlFor="master-brightness"
          className="flex items-center justify-between text-sm text-neutral-300"
        >
          <span>Master brightness</span>
          <span className="font-mono text-neutral-100">{masterBrightness}</span>
        </label>
        <input
          id="master-brightness"
          type="range"
          min={0}
          max={255}
          step={1}
          value={masterBrightness}
          onChange={(e) => setMasterBrightness(Number(e.target.value))}
          className="mt-3 w-full accent-stage-accent"
        />
      </div>

      {/* Readouts */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Status" value={playing ? 'Playing' : 'Stopped'} />
        <Stat
          label="Cue"
          value={cueCount > 0 ? `${cueIndex + 1} / ${cueCount}` : '—'}
        />
        <Stat
          label="Effect"
          value={currentCue ? EFFECT_NAMES[currentCue.effect] : '—'}
        />
        <Stat label="Elapsed" value={`${(elapsedMs / 1000).toFixed(1)}s`} />
      </dl>

      {/* Source */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
        <span>
          Source:{' '}
          <span className="text-neutral-300">
            {source === 'stored'
              ? "localStorage ('necklace.sequence')"
              : 'built-in demo'}
          </span>
          {sequence ? (
            <>
              {' '}
              · v{sequence.version} · {sequence.pixelCount} px · {cueCount} cue
              {cueCount === 1 ? '' : 's'}
            </>
          ) : null}
        </span>
        <button
          type="button"
          onClick={handleReload}
          className="rounded border border-stage-border px-2 py-1 text-neutral-300 transition-colors hover:border-stage-accent hover:text-white"
        >
          Reload sequence
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stage-border bg-stage-panel px-3 py-2">
      <dt className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-sm text-neutral-100">{value}</dd>
    </div>
  );
}

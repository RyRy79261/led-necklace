'use client';

interface ControlPadProps {
  connected: boolean;
  playing: boolean;
  onPlay: () => void;
  onStop: () => void;
  onNext: () => void;
  onBlackout: () => void;
}

/** The big live-control buttons: START/STOP, NEXT, and a BLACKOUT panic. */
export function ControlPad({
  connected,
  playing,
  onPlay,
  onStop,
  onNext,
  onBlackout,
}: ControlPadProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onPlay}
          disabled={!connected}
          aria-pressed={playing}
          className={
            'flex h-28 items-center justify-center rounded-xl text-2xl font-bold uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-40 ' +
            (playing
              ? 'border border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
              : 'bg-emerald-500 text-white hover:bg-emerald-400')
          }
        >
          Start
        </button>
        <button
          type="button"
          onClick={onStop}
          disabled={!connected}
          className="flex h-28 items-center justify-center rounded-xl bg-neutral-700 text-2xl font-bold uppercase tracking-wide text-white transition-colors hover:bg-neutral-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Stop
        </button>
      </div>

      <button
        type="button"
        onClick={onNext}
        disabled={!connected}
        className="flex h-16 w-full items-center justify-center rounded-xl border border-stage-border bg-stage-panel text-lg font-semibold uppercase tracking-wide text-white transition-colors hover:border-stage-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next ▸
      </button>

      <button
        type="button"
        onClick={onBlackout}
        disabled={!connected}
        className="flex h-16 w-full items-center justify-center rounded-xl bg-red-600 text-lg font-bold uppercase tracking-widest text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Blackout
      </button>
    </div>
  );
}

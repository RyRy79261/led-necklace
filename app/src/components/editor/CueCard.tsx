'use client';

import { Effect, type Cue, type RGB } from '@/lib/types';
import { rgbCss } from './color';
import {
  EFFECTS,
  effectMeta,
  periodMs,
  dutyFraction,
  breathePeriodMs,
  breatheParams,
  defaultParamsForEffect,
  BREATHE_PERIOD_MIN_MS,
  BREATHE_PERIOD_MAX_MS,
} from './effect-meta';
import { ByteSlider, ColorField, DurationInput, PeriodSlider } from './fields';

interface CueCardProps {
  index: number;
  total: number;
  cue: Cue;
  expanded: boolean;
  onToggle: () => void;
  onChange: (cue: Cue) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/** A small square that hints at what the cue looks like. */
function Swatch({ cue }: { cue: Cue }) {
  const style =
    cue.effect === Effect.Fade
      ? { backgroundImage: `linear-gradient(90deg, ${rgbCss(cue.colorA)}, ${rgbCss(cue.colorB)})` }
      : { backgroundColor: rgbCss(cue.colorA) };
  return (
    <span
      aria-hidden
      className="h-7 w-7 shrink-0 rounded-md border border-stage-border"
      style={style}
    />
  );
}

function summary(cue: Cue): string {
  const parts: string[] = [`${cue.durationMs} ms`];
  if (cue.effect === Effect.Fade) parts.push('A → B');
  if (cue.effect === Effect.Breathe)
    parts.push(`${(breathePeriodMs(cue.param1, cue.param2) / 1000).toFixed(1)} s breathe`);
  if (cue.effect === Effect.Strobe)
    parts.push(`${periodMs(cue.param1)} ms · ${Math.round(dutyFraction(cue.param2) * 100)}% duty`);
  parts.push(`bright ${cue.brightness}`);
  return parts.join(' · ');
}

const iconBtn =
  'flex h-9 min-w-[2.25rem] items-center justify-center rounded-md border border-stage-border ' +
  'bg-stage-bg px-2 text-sm text-neutral-300 transition-colors hover:enabled:border-stage-accent ' +
  'hover:enabled:text-white disabled:cursor-not-allowed disabled:opacity-30';

export function CueCard({
  index,
  total,
  cue,
  expanded,
  onToggle,
  onChange,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onDelete,
}: CueCardProps) {
  const meta = effectMeta(cue.effect);
  const set = <K extends keyof Cue>(key: K, value: Cue[K]) => onChange({ ...cue, [key]: value });

  const param1Hint = meta.usesParam1 ? `= ${periodMs(cue.param1)} ms` : 'unused for this effect';
  const param2Hint = meta.usesParam2
    ? `= ${Math.round(dutyFraction(cue.param2) * 100)}% on`
    : 'unused for this effect';

  return (
    <div className="overflow-hidden rounded-lg border border-stage-border bg-stage-panel">
      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-stage-bg text-xs font-semibold text-neutral-400">
            {index + 1}
          </span>
          <Swatch cue={cue} />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-white">{meta.label}</span>
            <span className="block truncate text-xs text-neutral-400">{summary(cue)}</span>
          </span>
          <span className="ml-1 text-neutral-500" aria-hidden>
            {expanded ? '▾' : '▸'}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" className={iconBtn} onClick={onMoveUp} disabled={index === 0} aria-label="Move cue up" title="Move up">
            ↑
          </button>
          <button
            type="button"
            className={iconBtn}
            onClick={onMoveDown}
            disabled={index === total - 1}
            aria-label="Move cue down"
            title="Move down"
          >
            ↓
          </button>
          <button type="button" className={iconBtn} onClick={onDuplicate} aria-label="Duplicate cue" title="Duplicate">
            ⧉
          </button>
          <button
            type="button"
            className={`${iconBtn} hover:enabled:!border-red-500 hover:enabled:!text-red-400`}
            onClick={onDelete}
            aria-label="Delete cue"
            title="Delete"
          >
            ✕
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="space-y-4 border-t border-stage-border p-4">
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">Effect</div>
            <select
              value={cue.effect}
              onChange={(e) => {
                const effect = Number(e.target.value) as Effect;
                // param1/param2 mean different things per effect (esp. BREATHE now uses param2 as
                // its period high byte) — reset to sane defaults on switch to avoid stale values.
                onChange({ ...cue, effect, ...defaultParamsForEffect(effect) });
              }}
              aria-label="Effect"
              className="w-full rounded-md border border-stage-border bg-stage-bg px-2.5 py-2 text-sm text-neutral-100 focus:border-stage-accent focus:outline-none"
            >
              {EFFECTS.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-neutral-500">{meta.blurb}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField label="Colour A" hint="primary" value={cue.colorA} onChange={(v: RGB) => set('colorA', v)} />
            <ColorField
              label="Colour B"
              hint="fade only"
              value={cue.colorB}
              disabled={!meta.usesColorB}
              onChange={(v: RGB) => set('colorB', v)}
            />
          </div>

          <DurationInput
            label="Duration"
            hint="held in AUTO mode"
            value={cue.durationMs}
            onChange={(v) => set('durationMs', v)}
          />

          {cue.effect === Effect.Breathe ? (
            <PeriodSlider
              label="Breathe period"
              hint={`${(breathePeriodMs(cue.param1, cue.param2) / 1000).toFixed(1)} s per breath`}
              valueMs={breathePeriodMs(cue.param1, cue.param2)}
              minMs={BREATHE_PERIOD_MIN_MS}
              maxMs={BREATHE_PERIOD_MAX_MS}
              onChangeMs={(ms) => onChange({ ...cue, ...breatheParams(ms) })}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <ByteSlider
                label={meta.param1Label}
                hint={param1Hint}
                value={cue.param1}
                disabled={!meta.usesParam1}
                onChange={(v) => set('param1', v)}
              />
              <ByteSlider
                label={meta.param2Label}
                hint={param2Hint}
                value={cue.param2}
                disabled={!meta.usesParam2}
                onChange={(v) => set('param2', v)}
              />
            </div>
          )}

          <ByteSlider
            label="Brightness"
            hint="per-cue max (0–255)"
            value={cue.brightness}
            onChange={(v) => set('brightness', v)}
          />
        </div>
      ) : null}
    </div>
  );
}

'use client';

import type { ReactNode } from 'react';
import type { RGB } from '@/lib/types';
import { hexToRgb, rgbToHex } from './color';
import { clampByte, clampU32 } from './sequence-storage';

interface FieldShellProps {
  label: string;
  hint?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}

/** Consistent label + hint wrapper for a single control. */
function FieldShell({ label, hint, disabled, children }: FieldShellProps) {
  return (
    <div className={disabled ? 'opacity-40' : undefined}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</span>
        {hint ? <span className="text-[11px] leading-tight text-neutral-500">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

const inputClass =
  'w-full rounded-md border border-stage-border bg-stage-bg px-2.5 py-2 text-sm text-neutral-100 ' +
  'focus:border-stage-accent focus:outline-none disabled:cursor-not-allowed';

/** Slider + number spinner for a u8 (0..255) value. */
export function ByteSlider({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: ReactNode;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <FieldShell label={label} hint={hint} disabled={disabled}>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={255}
          step={1}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(clampByte(Number(e.target.value)))}
          aria-label={label}
          className="h-2 flex-1 cursor-pointer accent-stage-accent disabled:cursor-not-allowed"
        />
        <input
          type="number"
          min={0}
          max={255}
          step={1}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(clampByte(Number(e.target.value)))}
          aria-label={`${label} value`}
          className="w-16 rounded-md border border-stage-border bg-stage-bg px-2 py-1.5 text-right text-sm text-neutral-100 focus:border-stage-accent focus:outline-none disabled:cursor-not-allowed"
        />
      </div>
    </FieldShell>
  );
}

/** Plain non-negative integer input (used for durationMs). */
export function DurationInput({
  label,
  hint,
  value,
  onChange,
  step = 100,
}: {
  label: string;
  hint?: ReactNode;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <FieldShell label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          step={step}
          value={value}
          onChange={(e) => onChange(clampU32(Number(e.target.value)))}
          aria-label={label}
          className={inputClass}
        />
        <span className="shrink-0 text-xs text-neutral-500">ms</span>
      </div>
    </FieldShell>
  );
}

/** Native colour picker + read-only hex/rgb readout for an RGB triple. */
export function ColorField({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: ReactNode;
  value: RGB;
  onChange: (v: RGB) => void;
  disabled?: boolean;
}) {
  const hex = rgbToHex(value);
  return (
    <FieldShell label={label} hint={hint} disabled={disabled}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={hex}
          disabled={disabled}
          onChange={(e) => {
            const rgb = hexToRgb(e.target.value);
            if (rgb) onChange(rgb);
          }}
          aria-label={label}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-stage-border bg-stage-bg disabled:cursor-not-allowed"
        />
        <div className="flex flex-col leading-tight">
          <span className="font-mono text-sm uppercase text-neutral-200">{hex}</span>
          <span className="text-[11px] text-neutral-500">rgb({value.join(', ')})</span>
        </div>
      </div>
    </FieldShell>
  );
}

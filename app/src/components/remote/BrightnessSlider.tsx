'use client';

interface BrightnessSliderProps {
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}

/** Master-brightness control (SET_BRIGHT, 0..255) with a live percentage. */
export function BrightnessSlider({ value, disabled, onChange }: BrightnessSliderProps) {
  const pct = Math.round((value / 255) * 100);
  return (
    <div className="space-y-2 rounded-lg border border-stage-border bg-stage-panel p-4">
      <div className="flex items-center justify-between">
        <label htmlFor="master-brightness" className="text-sm font-medium text-white">
          Master brightness
        </label>
        <span className="tabular-nums text-sm text-neutral-300">
          {pct}% <span className="text-neutral-500">({value})</span>
        </span>
      </div>
      <input
        id="master-brightness"
        type="range"
        min={0}
        max={255}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={`${pct} percent`}
        className="w-full accent-stage-accent disabled:cursor-not-allowed disabled:opacity-40"
      />
    </div>
  );
}

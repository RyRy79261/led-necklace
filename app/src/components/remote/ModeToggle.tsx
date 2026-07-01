'use client';

import type { TransportMode } from '@/lib/ble';

interface ModeToggleProps {
  mode: TransportMode;
  onChange: (mode: TransportMode) => void;
}

const OPTIONS: Array<{ value: TransportMode; label: string; hint: string }> = [
  { value: 'mock', label: 'Mock', hint: 'Simulated device, no board' },
  { value: 'ble', label: 'BLE', hint: 'Real necklace over Bluetooth' },
];

/** Mock/BLE segmented toggle so the remote runs with or without hardware. */
export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Transport"
      className="inline-flex rounded-lg border border-stage-border bg-stage-bg p-1"
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === mode;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.hint}
            onClick={() => onChange(opt.value)}
            className={
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors ' +
              (active
                ? 'bg-stage-accent text-white'
                : 'text-neutral-400 hover:text-white')
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

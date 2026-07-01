'use client';

import type { DeviceStatus } from '@/lib/ble';

interface StatusReadoutProps {
  connected: boolean;
  status: DeviceStatus | null;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-stage-border bg-stage-bg px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="text-sm font-medium text-white">{value}</div>
    </div>
  );
}

/** Read-only mirror of the device's reported state (from STATUS notifications). */
export function StatusReadout({ connected, status }: StatusReadoutProps) {
  const playing = connected && status ? (status.playing ? 'Playing' : 'Stopped') : '—';
  const mode = connected && status ? (status.mode === 'auto' ? 'Auto' : 'Manual') : '—';
  const cue = connected && status ? `#${status.cueIndex}` : '—';
  const battery =
    connected && status
      ? status.batteryPct === 255
        ? 'Unknown'
        : `${status.batteryPct}%`
      : '—';

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Field label="State" value={playing} />
      <Field label="Mode" value={mode} />
      <Field label="Cue" value={cue} />
      <Field label="Battery" value={battery} />
    </div>
  );
}

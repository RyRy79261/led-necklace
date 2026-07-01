'use client';

interface ConnectionBarProps {
  connected: boolean;
  connecting: boolean;
  deviceName: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

/** Live connection indicator + device name + connect/disconnect control. */
export function ConnectionBar({
  connected,
  connecting,
  deviceName,
  onConnect,
  onDisconnect,
}: ConnectionBarProps) {
  const dotClass = connected
    ? 'bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.7)]'
    : connecting
      ? 'bg-amber-400 animate-pulse'
      : 'bg-neutral-600';

  const statusLabel = connected
    ? 'Connected'
    : connecting
      ? 'Connecting…'
      : 'Disconnected';

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-stage-border bg-stage-panel px-4 py-3">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={'inline-block h-3 w-3 shrink-0 rounded-full ' + dotClass}
        />
        <div className="leading-tight">
          <div className="text-sm font-medium text-white">
            {deviceName ?? 'No device'}
          </div>
          <div
            className="text-xs text-neutral-400"
            aria-live="polite"
            role="status"
          >
            {statusLabel}
          </div>
        </div>
      </div>

      {connected ? (
        <button
          type="button"
          onClick={onDisconnect}
          className="rounded-md border border-stage-border px-3 py-1.5 text-sm font-medium text-neutral-200 transition-colors hover:border-neutral-500 hover:text-white"
        >
          Disconnect
        </button>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          disabled={connecting}
          className="rounded-md bg-stage-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#8f74ff] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {connecting ? 'Connecting…' : 'Connect'}
        </button>
      )}
    </div>
  );
}

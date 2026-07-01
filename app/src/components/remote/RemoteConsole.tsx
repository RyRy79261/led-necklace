'use client';

import { BrightnessSlider } from '@/components/remote/BrightnessSlider';
import { ConnectionBar } from '@/components/remote/ConnectionBar';
import { ControlPad } from '@/components/remote/ControlPad';
import { ModeToggle } from '@/components/remote/ModeToggle';
import { StatusReadout } from '@/components/remote/StatusReadout';
import { useRemote } from '@/components/remote/useRemote';

/** Live remote for the necklace: play/stop/next/blackout, brightness, link. */
export function RemoteConsole() {
  const remote = useRemote();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Remote</h1>
          <p className="text-sm text-neutral-400">
            Drive the necklace live. Works against a real board over BLE or a
            local mock with no hardware.
          </p>
        </div>
        <ModeToggle mode={remote.mode} onChange={remote.setMode} />
      </header>

      <ConnectionBar
        connected={remote.connected}
        connecting={remote.connecting}
        deviceName={remote.deviceName}
        onConnect={remote.connect}
        onDisconnect={remote.disconnect}
      />

      {remote.error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          <span>{remote.error}</span>
          <button
            type="button"
            onClick={remote.clearError}
            className="shrink-0 text-red-300 hover:text-white"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      <StatusReadout connected={remote.connected} status={remote.status} />

      <ControlPad
        connected={remote.connected}
        playing={Boolean(remote.status?.playing)}
        onPlay={remote.play}
        onStop={remote.stop}
        onNext={remote.next}
        onBlackout={remote.blackout}
      />

      <BrightnessSlider
        value={remote.brightness}
        disabled={!remote.connected}
        onChange={remote.setBrightness}
      />
    </div>
  );
}

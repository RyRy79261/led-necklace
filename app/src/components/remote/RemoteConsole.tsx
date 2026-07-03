'use client';

import { BrightnessSlider } from '@/components/remote/BrightnessSlider';
import { ConnectionBar } from '@/components/remote/ConnectionBar';
import { ControlPad } from '@/components/remote/ControlPad';
import { ModeToggle } from '@/components/remote/ModeToggle';
import { StatusReadout } from '@/components/remote/StatusReadout';
import { useState } from 'react';
import { useRemote } from '@/components/remote/RemoteProvider';

/** Live remote for the necklace: play/stop/next/blackout, brightness, link. */
export function RemoteConsole() {
  const remote = useRemote();
  const [loop, setLoop] = useState(true);

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

      <label className="flex items-center gap-3 rounded-lg border border-stage-border bg-stage-panel px-4 py-3 text-sm text-neutral-200">
        <input
          type="checkbox"
          checked={loop}
          disabled={!remote.connected}
          onChange={(e) => {
            setLoop(e.target.checked);
            remote.setLoop(e.target.checked);
          }}
          className="accent-stage-accent"
        />
        Loop the show (repeat at the end instead of stopping)
      </label>
    </div>
  );
}

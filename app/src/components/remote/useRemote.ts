'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createTransport,
  type Command,
  type ConnectedDevice,
  type DeviceStatus,
  type NecklaceTransport,
  type TransportMode,
} from '@/lib/ble';

const LS_MODE = 'necklace.remote.mode';
const LS_DEVICE_ID = 'necklace.remote.deviceId';
const LS_DEVICE_NAME = 'necklace.remote.deviceName';
const LS_BRIGHTNESS = 'necklace.remote.brightness';

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;
const BRIGHTNESS_THROTTLE_MS = 60;
// While the user is actively dragging the slider, ignore inbound brightness so
// the device's echo cannot fight the control.
const BRIGHTNESS_ECHO_LOCKOUT_MS = 500;

function readLocal(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / storage disabled */
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : 'Something went wrong';
}

export interface UseRemote {
  mode: TransportMode;
  setMode: (mode: TransportMode) => void;
  connected: boolean;
  connecting: boolean;
  deviceName: string | null;
  status: DeviceStatus | null;
  brightness: number;
  error: string | null;
  clearError: () => void;
  connect: () => void;
  disconnect: () => void;
  play: () => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  goto: (cueIndex: number) => void;
  blackout: () => void;
  setBrightness: (value: number) => void;
  setLoop: (value: boolean) => void;
  uploadSequence: (bytes: Uint8Array, onProgress?: (frac: number) => void) => Promise<void>;
}

// The transport-owning controller. Instantiated ONCE by RemoteProvider so the whole app shares a
// single BLE connection (the device is single-connection). Components call useRemote() (the
// context consumer in RemoteProvider) rather than this directly.
export function useRemoteController(): UseRemote {
  const [mode, setModeState] = useState<TransportMode>('mock');
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [device, setDevice] = useState<ConnectedDevice | null>(null);
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [brightness, setBrightnessState] = useState(255);
  const [error, setError] = useState<string | null>(null);
  // Last known device name (persisted), so the label survives disconnects.
  const [savedName, setSavedName] = useState<string | null>(null);

  const transportRef = useRef<NecklaceTransport | null>(null);
  // True when the user explicitly disconnected — suppresses auto-reconnect.
  const intentionalRef = useRef(false);
  // Latest brightness, so callbacks can push it without stale closures.
  const brightnessRef = useRef(255);
  const lastBrightnessTouchRef = useRef(0);
  const pendingBrightnessRef = useRef<number | null>(null);
  const brightnessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate persisted mode + brightness after mount (avoids SSR mismatch).
  useEffect(() => {
    const savedMode = readLocal(LS_MODE);
    if (savedMode === 'ble' || savedMode === 'mock') setModeState(savedMode);
    setSavedName(readLocal(LS_DEVICE_NAME));
    const savedBrightness = Number(readLocal(LS_BRIGHTNESS));
    if (Number.isFinite(savedBrightness) && savedBrightness >= 0 && savedBrightness <= 255) {
      brightnessRef.current = savedBrightness;
      setBrightnessState(savedBrightness);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Own the transport lifecycle for the active mode. Recreated on mode change.
  useEffect(() => {
    const transport = createTransport(mode);
    transportRef.current = transport;
    intentionalRef.current = false;

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    setStatus(null);
    setConnected(false);
    setDevice(null);

    const scheduleReconnect = () => {
      if (cancelled || mode !== 'ble' || intentionalRef.current) return;
      const savedId = readLocal(LS_DEVICE_ID);
      if (!savedId || attempts >= MAX_RECONNECT_ATTEMPTS) return;
      attempts += 1;
      reconnectTimer = setTimeout(() => {
        if (cancelled) return;
        transport.reconnect(savedId).catch(() => scheduleReconnect());
      }, RECONNECT_DELAY_MS);
    };

    const offStatus = transport.onStatus((s) => {
      if (cancelled) return;
      setStatus(s);
      if (Date.now() - lastBrightnessTouchRef.current > BRIGHTNESS_ECHO_LOCKOUT_MS) {
        brightnessRef.current = s.masterBrightness;
        setBrightnessState(s.masterBrightness);
      }
    });

    const offConn = transport.onConnectionChange((isConn, dev) => {
      if (cancelled) return;
      setConnected(isConn);
      setDevice(dev);
      if (isConn) {
        attempts = 0;
        if (dev) {
          writeLocal(LS_DEVICE_ID, dev.id);
          writeLocal(LS_DEVICE_NAME, dev.name);
          setSavedName(dev.name);
        }
        // Push our persisted master brightness so the device matches the UI.
        transport
          .sendCommand({ op: 'setBrightness', value: brightnessRef.current })
          .catch(() => {});
      } else {
        scheduleReconnect();
      }
    });

    // Initial auto-connect: mock connects instantly; BLE silently reconnects to
    // the last device id if one is remembered.
    void (async () => {
      try {
        if (mode === 'mock') {
          setConnecting(true);
          await transport.connect();
        } else {
          const savedId = readLocal(LS_DEVICE_ID);
          if (savedId) {
            setConnecting(true);
            await transport.reconnect(savedId);
          }
        }
      } catch {
        // Auto attempts fail silently; the user can press Connect.
      } finally {
        if (!cancelled) setConnecting(false);
      }
    })();

    return () => {
      cancelled = true;
      intentionalRef.current = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      offStatus();
      offConn();
      transport.disconnect().catch(() => {});
      if (transportRef.current === transport) transportRef.current = null;
    };
  }, [mode]);

  const setMode = useCallback(
    (next: TransportMode) => {
      if (next === mode) return;
      writeLocal(LS_MODE, next);
      setModeState(next);
    },
    [mode],
  );

  const connect = useCallback(async () => {
    const transport = transportRef.current;
    if (!transport) return;
    intentionalRef.current = false;
    setError(null);
    setConnecting(true);
    try {
      await transport.connect();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const transport = transportRef.current;
    if (!transport) return;
    intentionalRef.current = true;
    try {
      await transport.disconnect();
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  const send = useCallback((cmd: Command) => {
    const transport = transportRef.current;
    if (!transport || !transport.isConnected()) return;
    transport.sendCommand(cmd).catch((err) => setError(errorMessage(err)));
  }, []);

  const play = useCallback(() => send({ op: 'play', mode: 'auto' }), [send]);
  const stop = useCallback(() => send({ op: 'stop' }), [send]);
  const next = useCallback(() => send({ op: 'next' }), [send]);
  const prev = useCallback(() => send({ op: 'prev' }), [send]);
  const goto = useCallback((cueIndex: number) => send({ op: 'goto', cueIndex }), [send]);
  const blackout = useCallback(() => send({ op: 'blackout' }), [send]);
  const setLoop = useCallback((value: boolean) => send({ op: 'setLoop', value }), [send]);

  const uploadSequence = useCallback(
    async (bytes: Uint8Array, onProgress?: (frac: number) => void) => {
      const transport = transportRef.current;
      if (!transport || !transport.isConnected()) throw new Error('Necklace not connected');
      await transport.uploadSequence(bytes, onProgress);
    },
    [],
  );

  // Trailing throttle: fire immediately, then at most once per window with the
  // latest value, so a fast drag never floods the link but always lands final.
  const flushBrightness = useCallback(() => {
    brightnessTimerRef.current = null;
    const value = pendingBrightnessRef.current;
    const transport = transportRef.current;
    if (value == null || !transport || !transport.isConnected()) return;
    pendingBrightnessRef.current = null;
    transport.sendCommand({ op: 'setBrightness', value }).catch((err) => setError(errorMessage(err)));
    brightnessTimerRef.current = setTimeout(flushBrightness, BRIGHTNESS_THROTTLE_MS);
  }, []);

  const setBrightness = useCallback(
    (value: number) => {
      brightnessRef.current = value;
      lastBrightnessTouchRef.current = Date.now();
      setBrightnessState(value);
      writeLocal(LS_BRIGHTNESS, String(value));
      pendingBrightnessRef.current = value;
      if (!brightnessTimerRef.current) flushBrightness();
    },
    [flushBrightness],
  );

  // Clean up the throttle timer on unmount.
  useEffect(() => {
    return () => {
      if (brightnessTimerRef.current) clearTimeout(brightnessTimerRef.current);
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    mode,
    setMode,
    connected,
    connecting,
    deviceName: device?.name ?? savedName,
    status,
    brightness,
    error,
    clearError,
    connect,
    disconnect,
    play,
    stop,
    next,
    prev,
    goto,
    blackout,
    setBrightness,
    setLoop,
    uploadSequence,
  };
}

import {
  BleClient,
  ConnectionPriority,
  type BleDevice,
} from '@capacitor-community/bluetooth-le';
import { crc32, decodeSequence } from '@/lib/codec';
import { Player } from '@/lib/player';
import { Effect, PIXEL_COUNT, type Sequence } from '@/lib/types';

// ---------------------------------------------------------------------------
// Frozen contract (shared/PROTOCOL.md) — do NOT change these shapes.
// ---------------------------------------------------------------------------
export type Command =
  | { op: 'play'; mode: 'auto' | 'manual' }
  | { op: 'stop' }
  | { op: 'next' }
  | { op: 'prev' }
  | { op: 'goto'; cueIndex: number }
  | { op: 'setBrightness'; value: number }
  | { op: 'blackout' };

export interface DeviceStatus {
  playing: boolean; mode: 'auto' | 'manual';
  cueIndex: number; masterBrightness: number; batteryPct: number; // 255 = unknown
}

export interface Transport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  sendCommand(cmd: Command): Promise<void>;
  uploadSequence(bytes: Uint8Array, onProgress?: (frac: number) => void): Promise<void>;
  onStatus(cb: (s: DeviceStatus) => void): () => void; // returns unsubscribe
}

// ---------------------------------------------------------------------------
// GATT identifiers (shared/PROTOCOL.md → UUIDs)
// ---------------------------------------------------------------------------
export const NECKLACE_SERVICE = '5d3a1000-1f2b-4c6a-9e10-000000000001';
export const CMD_CHAR = '5d3a1000-1f2b-4c6a-9e10-000000000002'; // Write / Write-No-Response
export const UPLOAD_CHAR = '5d3a1000-1f2b-4c6a-9e10-000000000003'; // Write-No-Response
export const STATUS_CHAR = '5d3a1000-1f2b-4c6a-9e10-000000000004'; // Notify

// CMD opcodes (app -> device)
const OP_PLAY = 0x01;
const OP_STOP = 0x02;
const OP_NEXT = 0x03;
const OP_PREV = 0x04;
const OP_GOTO = 0x05;
const OP_SET_BRIGHT = 0x06;
const OP_BLACKOUT = 0x07;

// UPLOAD opcodes (app -> device)
const UP_BEGIN = 0x10;
const UP_CHUNK = 0x11;
const UP_END = 0x12;

// STATUS opcodes (device -> app)
const ST_STATE = 0x20;
const ST_UP_ACK = 0x21;

const MODE_MANUAL = 1;
const MODE_AUTO = 0;
const DEFAULT_MTU = 23; // ATT default when no negotiation happened

// ---------------------------------------------------------------------------
// Small numeric helpers — little-endian, round-half-up clamp per DATA-MODEL.md.
// ---------------------------------------------------------------------------
function clampByte(v: number): number {
  const r = Math.round(v);
  return r < 0 ? 0 : r > 255 ? 255 : r;
}

function clampU16(v: number): number {
  const r = Math.round(v);
  return r < 0 ? 0 : r > 0xffff ? 0xffff : r;
}

function toDataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

// ---------------------------------------------------------------------------
// Wire codec for CMD + STATUS. Exported so both transports (and tests) share
// exactly one implementation of the byte layout.
// ---------------------------------------------------------------------------

/** Encode a Command to the CMD-characteristic byte layout (opcode-first, LE). */
export function encodeCommand(cmd: Command): Uint8Array {
  switch (cmd.op) {
    case 'play':
      return Uint8Array.of(OP_PLAY, cmd.mode === 'manual' ? MODE_MANUAL : MODE_AUTO);
    case 'stop':
      return Uint8Array.of(OP_STOP);
    case 'next':
      return Uint8Array.of(OP_NEXT);
    case 'prev':
      return Uint8Array.of(OP_PREV);
    case 'goto': {
      const out = new Uint8Array(3);
      const dv = new DataView(out.buffer);
      dv.setUint8(0, OP_GOTO);
      dv.setUint16(1, clampU16(cmd.cueIndex), true);
      return out;
    }
    case 'setBrightness':
      return Uint8Array.of(OP_SET_BRIGHT, clampByte(cmd.value));
    case 'blackout':
      return Uint8Array.of(OP_BLACKOUT);
  }
}

/** Decode CMD bytes back into a Command (used by the mock device). */
export function decodeCommand(bytes: Uint8Array): Command {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const op = dv.getUint8(0);
  switch (op) {
    case OP_PLAY:
      return { op: 'play', mode: dv.getUint8(1) === MODE_MANUAL ? 'manual' : 'auto' };
    case OP_STOP:
      return { op: 'stop' };
    case OP_NEXT:
      return { op: 'next' };
    case OP_PREV:
      return { op: 'prev' };
    case OP_GOTO:
      return { op: 'goto', cueIndex: dv.getUint16(1, true) };
    case OP_SET_BRIGHT:
      return { op: 'setBrightness', value: dv.getUint8(1) };
    case OP_BLACKOUT:
      return { op: 'blackout' };
    default:
      throw new Error(`Unknown CMD opcode 0x${op.toString(16)}`);
  }
}

/** Encode a DeviceStatus to the STATUS notification byte layout (0x20 STATE). */
export function encodeStatus(s: DeviceStatus): Uint8Array {
  const out = new Uint8Array(7);
  const dv = new DataView(out.buffer);
  dv.setUint8(0, ST_STATE);
  dv.setUint8(1, s.playing ? 1 : 0);
  dv.setUint8(2, s.mode === 'manual' ? MODE_MANUAL : MODE_AUTO);
  dv.setUint16(3, clampU16(s.cueIndex), true);
  dv.setUint8(5, clampByte(s.masterBrightness));
  dv.setUint8(6, clampByte(s.batteryPct));
  return out;
}

/** Parse a 0x20 STATE notification payload into a DeviceStatus. */
export function parseStatus(bytes: Uint8Array): DeviceStatus {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    playing: dv.getUint8(1) !== 0,
    mode: dv.getUint8(2) === MODE_MANUAL ? 'manual' : 'auto',
    cueIndex: dv.getUint16(3, true),
    masterBrightness: dv.getUint8(5),
    batteryPct: dv.getUint8(6),
  };
}

function uploadAckMessage(status: number): string {
  switch (status) {
    case 1:
      return 'Upload rejected: CRC mismatch';
    case 2:
      return 'Upload rejected: length mismatch';
    case 3:
      return 'Upload rejected: storage failure';
    default:
      return `Upload rejected: status ${status}`;
  }
}

// ---------------------------------------------------------------------------
// Extended transport surface the remote UI drives. This keeps the frozen
// `Transport` interface intact while adding the ergonomics the UI needs
// (silent reconnect, connection events, the connected device's identity).
// ---------------------------------------------------------------------------
export interface ConnectedDevice {
  id: string;
  name: string;
}

export type TransportMode = 'mock' | 'ble';

export interface NecklaceTransport extends Transport {
  /** Reconnect to a previously-known device id without prompting the user. */
  reconnect(deviceId: string): Promise<void>;
  /** The currently connected device, or null when disconnected. */
  getDevice(): ConnectedDevice | null;
  /** Subscribe to connect/disconnect edges. Returns an unsubscribe fn. */
  onConnectionChange(
    cb: (connected: boolean, device: ConnectedDevice | null) => void,
  ): () => void;
}

/** Minimal typed listener set. */
class Emitter<T> {
  private listeners = new Set<(value: T) => void>();
  add(cb: (value: T) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  emit(value: T): void {
    for (const cb of [...this.listeners]) cb(value);
  }
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// A small demo show so the remote is fully exercisable with no hardware. The
// mock runs the real Player over these cues, so START/STOP/NEXT and the auto
// walk all behave exactly like the firmware would.
const DEMO_SEQUENCE: Sequence = {
  version: 1,
  pixelCount: PIXEL_COUNT,
  cues: [
    { effect: Effect.Solid, durationMs: 2000, colorA: [255, 0, 0], colorB: [0, 0, 0], param1: 0, param2: 0, brightness: 255 },
    { effect: Effect.Fade, durationMs: 3000, colorA: [255, 0, 0], colorB: [0, 0, 255], param1: 0, param2: 0, brightness: 255 },
    { effect: Effect.Breathe, durationMs: 4000, colorA: [0, 255, 0], colorB: [0, 0, 0], param1: 100, param2: 0, brightness: 255 },
    { effect: Effect.Strobe, durationMs: 3000, colorA: [255, 255, 255], colorB: [0, 0, 0], param1: 50, param2: 128, brightness: 255 },
  ],
};

// ---------------------------------------------------------------------------
// MockTransport — drives a local Player, actually encoding/decoding the real
// command + status byte layouts so it exercises the wire format end to end.
// ---------------------------------------------------------------------------
export class MockTransport implements NecklaceTransport {
  private connected = false;
  private player: Player | null = null;
  private masterBrightness = 255;
  private batteryPct = 87;
  private device: ConnectedDevice = { id: 'mock-necklace', name: 'Necklace (Mock)' };
  private statusEmitter = new Emitter<DeviceStatus>();
  private connEmitter = new Emitter<{ connected: boolean; device: ConnectedDevice | null }>();
  private ticker: ReturnType<typeof setInterval> | null = null;
  private lastSignature = '';

  async connect(): Promise<void> {
    this.player = new Player(DEMO_SEQUENCE);
    this.masterBrightness = 255;
    this.connected = true;
    this.lastSignature = '';
    this.startTicker();
    this.connEmitter.emit({ connected: true, device: this.device });
    this.emitStatus(true); // STATUS once on connect
  }

  async reconnect(deviceId: string): Promise<void> {
    this.device = { id: deviceId || this.device.id, name: 'Necklace (Mock)' };
    await this.connect();
  }

  async disconnect(): Promise<void> {
    this.stopTicker();
    this.connected = false;
    this.player = null;
    this.connEmitter.emit({ connected: false, device: null });
  }

  isConnected(): boolean {
    return this.connected;
  }

  getDevice(): ConnectedDevice | null {
    return this.connected ? this.device : null;
  }

  async sendCommand(cmd: Command): Promise<void> {
    if (!this.connected || !this.player) throw new Error('Mock device not connected');
    // Round-trip through the real wire bytes so the codec is exercised.
    const decoded = decodeCommand(encodeCommand(cmd));
    this.applyCommand(decoded);
    this.emitStatus(true); // device applies immediately and emits STATUS
  }

  async uploadSequence(
    bytes: Uint8Array,
    onProgress?: (frac: number) => void,
  ): Promise<void> {
    if (!this.connected) throw new Error('Mock device not connected');
    const total = bytes.length;
    const chunk = 180;
    for (let off = 0; off < total; off += chunk) {
      await delay(6);
      onProgress?.(Math.min(1, (off + chunk) / total));
    }
    onProgress?.(1);
    // Verify + commit exactly as the firmware would (exercises the codec).
    crc32(bytes);
    const seq = decodeSequence(bytes);
    this.player = new Player(seq);
    this.emitStatus(true);
  }

  onStatus(cb: (s: DeviceStatus) => void): () => void {
    return this.statusEmitter.add(cb);
  }

  onConnectionChange(
    cb: (connected: boolean, device: ConnectedDevice | null) => void,
  ): () => void {
    return this.connEmitter.add(({ connected, device }) => cb(connected, device));
  }

  private applyCommand(cmd: Command): void {
    if (!this.player) return;
    switch (cmd.op) {
      case 'play':
        this.player.play(cmd.mode);
        break;
      case 'stop':
        this.player.stop();
        break;
      case 'next':
        this.player.next();
        break;
      case 'prev':
        this.player.prev();
        break;
      case 'goto':
        this.player.goto(cmd.cueIndex);
        break;
      case 'setBrightness':
        this.masterBrightness = cmd.value;
        break;
      case 'blackout':
        this.player.stop();
        break;
    }
  }

  private currentStatus(): DeviceStatus {
    const s = this.player!.state;
    return {
      playing: s.playing,
      mode: s.mode,
      cueIndex: s.currentCue,
      masterBrightness: this.masterBrightness,
      batteryPct: this.batteryPct,
    };
  }

  private emitStatus(force = false): void {
    if (!this.player) return;
    // Encode then decode so subscribers receive exactly what the wire carries.
    const decoded = parseStatus(encodeStatus(this.currentStatus()));
    const signature = JSON.stringify(decoded);
    if (!force && signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.statusEmitter.emit(decoded);
  }

  private startTicker(): void {
    this.stopTicker();
    // Simulate the autonomous board: advance the auto walk and push STATUS on
    // every state change (cue advance, end-of-show stop).
    this.ticker = setInterval(() => {
      if (!this.player) return;
      try {
        this.player.tick(Date.now());
      } catch {
        return;
      }
      this.emitStatus();
    }, 150);
  }

  private stopTicker(): void {
    if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }
}

// ---------------------------------------------------------------------------
// BleTransport — @capacitor-community/bluetooth-le. Identical Transport surface;
// encodes commands to the wire layouts, writes CMD/UPLOAD, parses STATUS.
// ---------------------------------------------------------------------------
export class BleTransport implements NecklaceTransport {
  private connected = false;
  private device: BleDevice | null = null;
  private mtu = DEFAULT_MTU;
  private initialized = false;
  private statusEmitter = new Emitter<DeviceStatus>();
  private connEmitter = new Emitter<{ connected: boolean; device: ConnectedDevice | null }>();
  private pendingAck: { resolve: () => void; reject: (e: Error) => void } | null = null;

  async connect(): Promise<void> {
    await this.ensureInitialized();
    // Interactive: filter the chooser to our service so only necklaces show.
    const device = await BleClient.requestDevice({
      services: [NECKLACE_SERVICE],
      optionalServices: [NECKLACE_SERVICE],
    });
    await this.attach(device);
  }

  async reconnect(deviceId: string): Promise<void> {
    await this.ensureInitialized();
    let device: BleDevice | undefined;
    try {
      const known = await BleClient.getDevices([deviceId]);
      device = known[0];
    } catch {
      device = undefined;
    }
    // On Android the raw device id (MAC) can be connected directly.
    if (!device) device = { deviceId };
    await this.attach(device);
  }

  async disconnect(): Promise<void> {
    const id = this.device?.deviceId;
    this.connected = false;
    this.failPendingAck(new Error('Disconnected'));
    if (id) {
      try {
        await BleClient.stopNotifications(id, NECKLACE_SERVICE, STATUS_CHAR);
      } catch {
        /* not subscribed / already gone */
      }
      try {
        await BleClient.disconnect(id);
      } catch {
        /* already disconnected */
      }
    }
    this.device = null;
    this.connEmitter.emit({ connected: false, device: null });
  }

  isConnected(): boolean {
    return this.connected;
  }

  getDevice(): ConnectedDevice | null {
    if (!this.connected || !this.device) return null;
    return { id: this.device.deviceId, name: this.deviceName() };
  }

  async sendCommand(cmd: Command): Promise<void> {
    const id = this.requireDeviceId();
    // Write-No-Response so control feels instant (no round-trip wait).
    await BleClient.writeWithoutResponse(
      id,
      NECKLACE_SERVICE,
      CMD_CHAR,
      toDataView(encodeCommand(cmd)),
    );
  }

  async uploadSequence(
    bytes: Uint8Array,
    onProgress?: (frac: number) => void,
  ): Promise<void> {
    const id = this.requireDeviceId();
    const crc = crc32(bytes) >>> 0;

    // 0x10 BEGIN [totalLen u32 LE][crc32 u32 LE]
    const begin = new Uint8Array(9);
    const bdv = new DataView(begin.buffer);
    bdv.setUint8(0, UP_BEGIN);
    bdv.setUint32(1, bytes.length >>> 0, true);
    bdv.setUint32(5, crc, true);
    await BleClient.writeWithoutResponse(id, NECKLACE_SERVICE, UPLOAD_CHAR, toDataView(begin));

    // 0x11 CHUNK [offset u16 LE][payload...]; payload <= negotiatedMTU - 6.
    const maxPayload = Math.max(1, (this.mtu || DEFAULT_MTU) - 6);
    for (let off = 0; off < bytes.length; off += maxPayload) {
      const end = Math.min(off + maxPayload, bytes.length);
      const slice = bytes.subarray(off, end);
      const frame = new Uint8Array(3 + slice.length);
      const fdv = new DataView(frame.buffer);
      fdv.setUint8(0, UP_CHUNK);
      fdv.setUint16(1, off, true);
      frame.set(slice, 3);
      await BleClient.writeWithoutResponse(id, NECKLACE_SERVICE, UPLOAD_CHAR, toDataView(frame));
      onProgress?.(Math.min(1, end / bytes.length));
    }
    if (bytes.length === 0) onProgress?.(1);

    // 0x12 END → wait for the 0x21 UP_ACK notification before resolving.
    const ack = new Promise<void>((resolve, reject) => {
      this.pendingAck = { resolve, reject };
      setTimeout(() => {
        if (this.pendingAck) {
          this.pendingAck = null;
          reject(new Error('Upload ACK timed out'));
        }
      }, 5000);
    });
    await BleClient.writeWithoutResponse(
      id,
      NECKLACE_SERVICE,
      UPLOAD_CHAR,
      toDataView(Uint8Array.of(UP_END)),
    );
    await ack;
  }

  onStatus(cb: (s: DeviceStatus) => void): () => void {
    return this.statusEmitter.add(cb);
  }

  onConnectionChange(
    cb: (connected: boolean, device: ConnectedDevice | null) => void,
  ): () => void {
    return this.connEmitter.add(({ connected, device }) => cb(connected, device));
  }

  // ---- internals -----------------------------------------------------------

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await BleClient.initialize({ androidNeverForLocation: true });
    this.initialized = true;
  }

  private deviceName(): string {
    return this.device?.name?.trim() || 'Necklace';
  }

  private requireDeviceId(): string {
    if (!this.connected || !this.device) throw new Error('BLE device not connected');
    return this.device.deviceId;
  }

  private async attach(device: BleDevice): Promise<void> {
    this.device = device;
    await BleClient.connect(device.deviceId, (id) => this.handleDisconnect(id));
    // Read the negotiated MTU (plugin auto-requests a large MTU on connect).
    try {
      this.mtu = await BleClient.getMtu(device.deviceId);
    } catch {
      this.mtu = DEFAULT_MTU;
    }
    // Ask for a low-latency connection so live control feels instant.
    try {
      await BleClient.requestConnectionPriority(
        device.deviceId,
        ConnectionPriority.CONNECTION_PRIORITY_HIGH,
      );
    } catch {
      /* unsupported on web; ignore */
    }
    await BleClient.startNotifications(
      device.deviceId,
      NECKLACE_SERVICE,
      STATUS_CHAR,
      (value) => this.handleNotification(value),
    );
    this.connected = true;
    this.connEmitter.emit({
      connected: true,
      device: { id: device.deviceId, name: this.deviceName() },
    });
  }

  private handleDisconnect(_deviceId: string): void {
    this.connected = false;
    this.failPendingAck(new Error('Disconnected during upload'));
    this.connEmitter.emit({ connected: false, device: null });
  }

  private handleNotification(value: DataView): void {
    if (value.byteLength < 1) return;
    const op = value.getUint8(0);
    if (op === ST_STATE) {
      if (value.byteLength < 7) return;
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      this.statusEmitter.emit(parseStatus(bytes));
    } else if (op === ST_UP_ACK) {
      const status = value.byteLength >= 2 ? value.getUint8(1) : 0;
      const pending = this.pendingAck;
      if (!pending) return;
      this.pendingAck = null;
      if (status === 0) pending.resolve();
      else pending.reject(new Error(uploadAckMessage(status)));
    }
  }

  private failPendingAck(err: Error): void {
    if (this.pendingAck) {
      const pending = this.pendingAck;
      this.pendingAck = null;
      pending.reject(err);
    }
  }
}

/** Construct the transport for a given mode. */
export function createTransport(mode: TransportMode): NecklaceTransport {
  return mode === 'ble' ? new BleTransport() : new MockTransport();
}

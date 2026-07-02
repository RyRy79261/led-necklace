# BLE Protocol — AUTHORITATIVE CONTRACT

One custom GATT service. App is central (client), necklace is peripheral (server).
BLE is used for **authoring/upload + live control** only — never live frame streaming.
The board plays autonomously; the phone only needs a link at the moment of a command.

Advertised name: `Necklace` (or `Necklace-XXXX` with last 2 MAC bytes). Design for a
single connection at a time.

## UUIDs
```
SERVICE : 5d3a1000-1f2b-4c6a-9e10-000000000001
CMD     : 5d3a1000-1f2b-4c6a-9e10-000000000002   (Write / Write-No-Response)
UPLOAD  : 5d3a1000-1f2b-4c6a-9e10-000000000003   (Write-No-Response)
STATUS  : 5d3a1000-1f2b-4c6a-9e10-000000000004   (Notify)
```

## CMD characteristic (app → device) — first byte is the opcode
```
0x01 PLAY      [mode u8]        mode: 0=auto, 1=manual
0x02 STOP
0x03 NEXT
0x04 PREV
0x05 GOTO      [cueIndex u16 LE]
0x06 SET_BRIGHT[u8]             masterBrightness 0..255
0x07 BLACKOUT                   stop + all pixels off immediately (panic)
0x08 SET_LOOP  [u8]            0=off, 1=on. Loop the show at end-of-sequence. Persisted; default on.
```
All commands are idempotent-safe to resend. Device applies immediately and emits STATUS.

## UPLOAD characteristic (app → device) — chunked, framed, CRC-checked
Sequences are tiny (≈ 5 + 16·cueCount bytes; a 10-min show is ~1–2 KB) so this is a
handful of writes. Resume-on-disconnect is v2; v1 restarts the transfer.
```
0x10 BEGIN [totalLen u32 LE][crc32 u32 LE]   device allocates a buffer of totalLen
0x11 CHUNK [offset u16 LE][payload...]        payload ≤ (negotiatedMTU - 6)
0x12 END                                      device verifies len + crc32, commits
```
- **CRC32**: standard IEEE 802.3 (poly 0xEDB88320, reflected, init 0xFFFFFFFF, final XOR
  0xFFFFFFFF) over the full reassembled sequence blob. App and firmware MUST use the same
  algorithm — the cross-check is that both compute the identical value; no hard-coded CRC
  in the vectors.
- On END: validate `receivedLen == totalLen` and `crc == expected`. On success, persist to
  LittleFS at `/seq.bin` and reload the player. Emit UPLOAD_ACK.
- Negotiate MTU up on connect (request 247+). If small MTU, chunk size shrinks; still works.

## STATUS characteristic (device → app, Notify)
Device pushes on every state change (and once on connect):
```
[0x20 STATE ]  [playing u8][mode u8][cueIndex u16 LE][masterBright u8][battPct u8]
[0x21 UP_ACK]  [status u8]   0=ok, 1=crc_fail, 2=len_fail, 3=storage_fail
```
`battPct` = 255 if unknown/unmeasured.

## TypeScript command model (`src/lib/ble.ts`)
```ts
export type Command =
  | { op: 'play'; mode: 'auto' | 'manual' }
  | { op: 'stop' }
  | { op: 'next' }
  | { op: 'prev' }
  | { op: 'goto'; cueIndex: number }
  | { op: 'setBrightness'; value: number }
  | { op: 'blackout' }
  | { op: 'setLoop'; value: boolean };

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
```
Two Transport implementations:
- **MockTransport** — no hardware. Runs the real player state machine locally so the
  remote UI + STATUS feedback work fully in a browser. Encodes/decodes real command bytes
  so it exercises the codec.
- **BleTransport** — `@capacitor-community/bluetooth-le`. Same interface. Encodes commands
  to the byte layouts above and writes to CMD/UPLOAD; subscribes to STATUS notifications.

## Firmware side
NimBLE-Arduino server exposing the service. CMD/UPLOAD write callbacks decode opcodes;
STATUS is a notify characteristic pushed from the player. Keep the physical button (D2)
and its start/stop on a path independent of the BLE stack.

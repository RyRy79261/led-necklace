'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CUE_BYTES, HEADER_BYTES, PIXEL_COUNT, type Cue, type Sequence } from '@/lib/types';
import { encodeSequence } from '@/lib/codec';
import { CueCard } from './CueCard';
import { loadSequence, makeCue, sanitizeSequence, saveSequence } from './sequence-storage';

/**
 * Minimal structural view of a transport, so the editor never has to import the
 * BLE module directly. The editor page renders without one, so the upload button
 * is disabled until a transport is wired in later.
 */
export interface EditorUploader {
  isConnected?(): boolean;
  uploadSequence(bytes: Uint8Array, onProgress?: (frac: number) => void): Promise<void>;
}

export interface CueListEditorProps {
  uploader?: EditorUploader | null;
}

interface CueItem {
  id: string;
  cue: Cue;
}

let idSeq = 0;
function newId(): string {
  idSeq += 1;
  return `cue-${Date.now().toString(36)}-${idSeq.toString(36)}`;
}

function toItems(cues: Cue[]): CueItem[] {
  return cues.map((cue) => ({ id: newId(), cue }));
}

type Notice = { kind: 'info' | 'error' | 'success'; text: string } | null;

export function CueListEditor({ uploader = null }: CueListEditorProps) {
  const [items, setItems] = useState<CueItem[]>([]);
  const [pixelCount, setPixelCount] = useState<number>(PIXEL_COUNT);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [uploadState, setUploadState] = useState<'idle' | 'busy'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load persisted sequence once, on the client, to avoid SSR hydration drift.
  useEffect(() => {
    const seq = loadSequence();
    setItems(toItems(seq.cues));
    setPixelCount(seq.pixelCount);
    setExpandedId(null);
    setHydrated(true);
  }, []);

  const sequence: Sequence = useMemo(
    () => ({ version: 1, pixelCount, cues: items.map((i) => i.cue) }),
    [pixelCount, items],
  );

  // Persist whenever the working sequence changes (after initial hydration).
  useEffect(() => {
    if (!hydrated) return;
    saveSequence(sequence);
  }, [hydrated, sequence]);

  const byteSize = useMemo(() => {
    try {
      return encodeSequence(sequence).length;
    } catch {
      // Codec not wired yet: fall back to the documented layout size.
      return HEADER_BYTES + CUE_BYTES * items.length;
    }
  }, [sequence, items.length]);

  const totalMs = useMemo(() => items.reduce((sum, i) => sum + i.cue.durationMs, 0), [items]);

  const addCue = useCallback(() => {
    const item: CueItem = { id: newId(), cue: makeCue() };
    setItems((prev) => [...prev, item]);
    setExpandedId(item.id);
    setNotice(null);
  }, []);

  const duplicateCue = useCallback((id: string) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === id);
      if (idx === -1) return prev;
      const copy: CueItem = { id: newId(), cue: { ...prev[idx].cue, colorA: [...prev[idx].cue.colorA], colorB: [...prev[idx].cue.colorB] } };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      setExpandedId(copy.id);
      return next;
    });
    setNotice(null);
  }, []);

  const deleteCue = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setExpandedId((cur) => (cur === id ? null : cur));
    setNotice(null);
  }, []);

  const moveCue = useCallback((id: string, dir: -1 | 1) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === id);
      const target = idx + dir;
      if (idx === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
    setNotice(null);
  }, []);

  const changeCue = useCallback((id: string, cue: Cue) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, cue } : i)));
  }, []);

  const toggleCue = useCallback((id: string) => {
    setExpandedId((cur) => (cur === id ? null : id));
  }, []);

  const handleExport = useCallback(() => {
    try {
      const blob = new Blob([JSON.stringify(sequence, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'necklace-sequence.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setNotice({ kind: 'success', text: 'Exported necklace-sequence.json' });
    } catch {
      setNotice({ kind: 'error', text: 'Export failed.' });
    }
  }, [sequence]);

  const handleImportFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onerror = () => setNotice({ kind: 'error', text: 'Could not read that file.' });
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const seq = sanitizeSequence(parsed);
        setItems(toItems(seq.cues));
        setPixelCount(seq.pixelCount);
        setExpandedId(null);
        setNotice({ kind: 'success', text: `Imported ${seq.cues.length} cue${seq.cues.length === 1 ? '' : 's'}.` });
      } catch {
        setNotice({ kind: 'error', text: 'That file is not valid sequence JSON.' });
      }
    };
    reader.readAsText(file);
  }, []);

  const handleUpload = useCallback(async () => {
    if (!uploader) return;
    let bytes: Uint8Array;
    try {
      bytes = encodeSequence(sequence);
    } catch {
      setNotice({ kind: 'error', text: 'Could not encode the sequence for upload.' });
      return;
    }
    setUploadState('busy');
    setNotice({ kind: 'info', text: 'Uploading to device…' });
    try {
      await uploader.uploadSequence(bytes);
      setNotice({ kind: 'success', text: `Uploaded ${bytes.length} bytes to the necklace.` });
    } catch {
      setNotice({ kind: 'error', text: 'Upload failed.' });
    } finally {
      setUploadState('idle');
    }
  }, [uploader, sequence]);

  const uploadReady = Boolean(uploader && (uploader.isConnected?.() ?? true));
  const uploadDisabled = !uploadReady || items.length === 0 || uploadState === 'busy';

  const btn =
    'rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40';
  const btnDefault = `${btn} border-stage-border bg-stage-bg text-neutral-200 hover:enabled:border-stage-accent hover:enabled:text-white`;
  const btnPrimary = `${btn} border-stage-accent bg-stage-accent text-white hover:enabled:brightness-110`;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-stage-border bg-stage-panel p-3">
        <button type="button" className={btnPrimary} onClick={addCue}>
          + Add cue
        </button>
        <button type="button" className={btnDefault} onClick={() => fileInputRef.current?.click()}>
          Import JSON
        </button>
        <button type="button" className={btnDefault} onClick={handleExport} disabled={items.length === 0}>
          Export JSON
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportFile(file);
            e.target.value = '';
          }}
        />
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className={btnDefault}
            onClick={handleUpload}
            disabled={uploadDisabled}
            title={
              uploader
                ? uploadReady
                  ? 'Upload the encoded sequence to the connected necklace'
                  : 'Device is not connected'
                : 'Connect a device on the Remote screen to enable upload'
            }
          >
            {uploadState === 'busy' ? 'Uploading…' : 'Upload to device'}
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-stage-border bg-stage-panel px-4 py-3 text-sm">
        <span className="text-neutral-400">
          Cues: <span className="font-medium text-neutral-100">{items.length}</span>
        </span>
        <span className="text-neutral-400">
          Auto runtime: <span className="font-medium text-neutral-100">{(totalMs / 1000).toFixed(1)} s</span>
        </span>
        <span className="text-neutral-400">
          Pixels: <span className="font-medium text-neutral-100">{pixelCount}</span>
        </span>
        <span className="text-neutral-400">
          Encoded size: <span className="font-medium text-neutral-100">{byteSize} B</span>
          <span className="ml-1 text-xs text-neutral-500">({HEADER_BYTES} B header + {CUE_BYTES} B/cue)</span>
        </span>
      </div>

      {notice ? (
        <div
          role="status"
          className={
            'rounded-lg border px-4 py-2.5 text-sm ' +
            (notice.kind === 'error'
              ? 'border-red-500/40 bg-red-500/10 text-red-300'
              : notice.kind === 'success'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-stage-border bg-stage-panel text-neutral-300')
          }
        >
          {notice.text}
        </div>
      ) : null}

      {/* Cue list */}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stage-border bg-stage-panel/50 p-10 text-center">
          <p className="text-sm text-neutral-400">No cues yet.</p>
          <button type="button" className={`${btnPrimary} mt-3`} onClick={addCue}>
            + Add your first cue
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item, index) => (
            <li key={item.id}>
              <CueCard
                index={index}
                total={items.length}
                cue={item.cue}
                expanded={expandedId === item.id}
                onToggle={() => toggleCue(item.id)}
                onChange={(cue) => changeCue(item.id, cue)}
                onMoveUp={() => moveCue(item.id, -1)}
                onMoveDown={() => moveCue(item.id, 1)}
                onDuplicate={() => duplicateCue(item.id)}
                onDelete={() => deleteCue(item.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

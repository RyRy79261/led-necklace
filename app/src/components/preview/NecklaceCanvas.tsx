'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { PIXEL_COUNT, type RGB } from '@/lib/types';

export interface NecklaceCanvasHandle {
  /** Paint one display-domain (post-gamma) frame of PIXEL_COUNT colours. */
  draw(colors: RGB[]): void;
}

// Physical layout: a rigid rectangular LED PANEL — 3 daisy-chained strips of 10, arranged
// as 3 columns × 10 rows (a 3-wide, 10-tall grid). Data chains strip→strip, so pixel index
// maps as: strip (column) = floor(i / PER_STRIP), row = i % PER_STRIP, top → bottom.
// (If the physical strips are wired serpentine, only future per-pixel effects would care;
// v1 effects are spatially uniform.)
const STRIPS = 3;
const PER_STRIP = PIXEL_COUNT / STRIPS; // 10

const LOGICAL_W = 640;
const LOGICAL_H = 460;
const PITCH = 40; // centre-to-centre spacing of pixels
const CELL = 28; // rounded-square side of one pixel
const CELL_RADIUS = 7;
const BEZEL = 16; // panel padding around the outermost pixels

interface Point {
  x: number;
  y: number;
}

/** Centre of each pixel, laid out as a 3×10 grid centred in the canvas. */
function computeCells(): Point[] {
  const pts: Point[] = [];
  const gridW = (STRIPS - 1) * PITCH;
  const gridH = (PER_STRIP - 1) * PITCH;
  const x0 = LOGICAL_W / 2 - gridW / 2;
  const y0 = LOGICAL_H / 2 - gridH / 2;
  for (let i = 0; i < PIXEL_COUNT; i++) {
    const col = Math.floor(i / PER_STRIP);
    const row = i % PER_STRIP;
    pts.push({ x: x0 + col * PITCH, y: y0 + row * PITCH });
  }
  return pts;
}

// Static geometry — depends only on constants, safe at module scope.
const CELLS = computeCells();
const OFF_FRAME: RGB[] = Array.from({ length: PIXEL_COUNT }, () => [0, 0, 0]);

// Panel body rectangle enclosing the grid + bezel.
const PANEL = (() => {
  const pad = CELL / 2 + BEZEL;
  const left = LOGICAL_W / 2 - ((STRIPS - 1) * PITCH) / 2 - pad;
  const top = LOGICAL_H / 2 - ((PER_STRIP - 1) * PITCH) / 2 - pad;
  const w = (STRIPS - 1) * PITCH + 2 * pad;
  const h = (PER_STRIP - 1) * PITCH + 2 * pad;
  return { left, top, w, h };
})();

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function paint(ctx: CanvasRenderingContext2D, colors: RGB[]): void {
  ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

  // Subtle stage vignette for depth.
  const bg = ctx.createRadialGradient(
    LOGICAL_W / 2,
    LOGICAL_H / 2,
    40,
    LOGICAL_W / 2,
    LOGICAL_H / 2,
    LOGICAL_W * 0.6,
  );
  bg.addColorStop(0, 'rgba(28,28,38,0.6)');
  bg.addColorStop(1, 'rgba(8,8,11,0)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  // The panel body — a solid rounded rectangle (the front face), with a soft top-lit
  // gradient and a rim so it reads as a physical panel.
  const face = ctx.createLinearGradient(0, PANEL.top, 0, PANEL.top + PANEL.h);
  face.addColorStop(0, '#1b1b22');
  face.addColorStop(1, '#101015');
  roundRectPath(ctx, PANEL.left, PANEL.top, PANEL.w, PANEL.h, 14);
  ctx.fillStyle = face;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(120,120,140,0.35)';
  ctx.stroke();

  // The pixels — a 3×10 grid of rounded-square LEDs.
  for (let i = 0; i < PIXEL_COUNT; i++) {
    const p = CELLS[i];
    const c = colors[i] ?? OFF_FRAME[i];
    const r = c[0] ?? 0;
    const g = c[1] ?? 0;
    const b = c[2] ?? 0;
    const lit = r + g + b > 8;
    const x = p.x - CELL / 2;
    const y = p.y - CELL / 2;

    if (lit) {
      const peak = Math.max(r, g, b) / 255;
      // Colored glow.
      ctx.save();
      ctx.shadowBlur = 20;
      ctx.shadowColor = `rgb(${r},${g},${b})`;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      roundRectPath(ctx, x, y, CELL, CELL, CELL_RADIUS);
      ctx.fill();
      ctx.restore();
      // Hot white-ish core, stronger the brighter the LED.
      ctx.fillStyle = `rgba(255,255,255,${(0.1 + 0.45 * peak).toFixed(3)})`;
      roundRectPath(ctx, x + CELL * 0.28, y + CELL * 0.28, CELL * 0.44, CELL * 0.44, 3);
      ctx.fill();
    } else {
      // Unlit LED so the panel grid is always visible.
      roundRectPath(ctx, x, y, CELL, CELL, CELL_RADIUS);
      ctx.fillStyle = '#17171d';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#2c2c36';
      ctx.stroke();
    }
  }
}

/**
 * Imperative canvas: the render loop calls `ref.current.draw(frame)` every
 * animation frame. No per-frame React re-render.
 */
export const NecklaceCanvas = forwardRef<NecklaceCanvasHandle>(
  function NecklaceCanvas(_props, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
      canvas.width = Math.round(LOGICAL_W * dpr);
      canvas.height = Math.round(LOGICAL_H * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctxRef.current = ctx;
      paint(ctx, OFF_FRAME);
    }, []);

    useImperativeHandle(ref, () => ({
      draw(colors: RGB[]) {
        const ctx = ctxRef.current;
        if (ctx) paint(ctx, colors);
      },
    }), []);

    return (
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Simulated 30-pixel LED panel — 3 strips of 10"
        className="mx-auto block h-auto w-full max-w-sm rounded-lg border border-stage-border bg-stage-bg"
        style={{ aspectRatio: `${LOGICAL_W} / ${LOGICAL_H}` }}
      />
    );
  },
);

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

const LOGICAL_W = 720;
const LOGICAL_H = 380;
const DOT_RADIUS = 8;

interface Point {
  x: number;
  y: number;
}

/** Lay the 30 pixels along a downward necklace arc (part of a circle). */
function computePoints(): Point[] {
  const pts: Point[] = [];
  const cx = LOGICAL_W / 2;
  const cy = 55;
  const r = 270;
  const startDeg = 155;
  const endDeg = 25;
  const span = PIXEL_COUNT > 1 ? PIXEL_COUNT - 1 : 1;
  for (let i = 0; i < PIXEL_COUNT; i++) {
    const t = i / span;
    const deg = startDeg + (endDeg - startDeg) * t;
    const rad = (deg * Math.PI) / 180;
    pts.push({ x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) });
  }
  return pts;
}

// Static geometry — depends only on constants, safe at module scope.
const POINTS = computePoints();
const OFF_FRAME: RGB[] = Array.from({ length: PIXEL_COUNT }, () => [0, 0, 0]);

function paint(ctx: CanvasRenderingContext2D, colors: RGB[]): void {
  ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

  // Subtle stage vignette for depth.
  const bg = ctx.createRadialGradient(
    LOGICAL_W / 2,
    LOGICAL_H * 0.55,
    40,
    LOGICAL_W / 2,
    LOGICAL_H * 0.55,
    LOGICAL_W * 0.7,
  );
  bg.addColorStop(0, 'rgba(28,28,38,0.6)');
  bg.addColorStop(1, 'rgba(8,8,11,0)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  // The cord: a dim line through every pixel, with tails toward the neck.
  const first = POINTS[0];
  const last = POINTS[POINTS.length - 1];
  ctx.save();
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(130,130,150,0.22)';
  ctx.beginPath();
  ctx.moveTo(first.x - 42, first.y - 96);
  for (const p of POINTS) ctx.lineTo(p.x, p.y);
  ctx.lineTo(last.x + 42, last.y - 96);
  ctx.stroke();
  ctx.restore();

  // The pixels.
  for (let i = 0; i < PIXEL_COUNT; i++) {
    const p = POINTS[i];
    const c = colors[i] ?? OFF_FRAME[i];
    const r = c[0] ?? 0;
    const g = c[1] ?? 0;
    const b = c[2] ?? 0;
    const lit = r + g + b > 8;

    if (lit) {
      const peak = Math.max(r, g, b) / 255;
      // Colored glow.
      ctx.save();
      ctx.shadowBlur = 22;
      ctx.shadowColor = `rgb(${r},${g},${b})`;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Hot white-ish core, stronger the brighter the LED.
      ctx.beginPath();
      ctx.fillStyle = `rgba(255,255,255,${(0.12 + 0.5 * peak).toFixed(3)})`;
      ctx.arc(p.x, p.y, DOT_RADIUS * 0.42, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Unlit LED so the necklace shape is always visible.
      ctx.beginPath();
      ctx.fillStyle = '#17171d';
      ctx.arc(p.x, p.y, DOT_RADIUS * 0.72, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.5;
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
        aria-label="Simulated 30-pixel LED necklace"
        className="block w-full rounded-lg border border-stage-border bg-stage-bg"
        style={{ aspectRatio: `${LOGICAL_W} / ${LOGICAL_H}` }}
      />
    );
  },
);

import type { RGB } from '@/lib/types';

/** [r,g,b] (0..255) -> "#rrggbb" (lowercase). */
export function rgbToHex([r, g, b]: RGB): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** "#rrggbb" | "rrggbb" -> [r,g,b]; returns null when not a valid 6-digit hex. */
export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

/** CSS colour string for previews. */
export function rgbCss([r, g, b]: RGB): string {
  return `rgb(${r}, ${g}, ${b})`;
}

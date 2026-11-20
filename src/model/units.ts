import type { Fit, Frame, Specs, Unit } from './types';

export const MM_PER_IN = 25.4;

export interface CardPreset {
  id: string;
  label: string;
  w: number;
  h: number;
}

export const CARD_PRESETS: CardPreset[] = [
  { id: 'tcg-standard', label: 'Standard TCG / Sports 2.5″ × 3.5″ (63.5 × 88.9 mm)', w: 63.5, h: 88.9 },
  { id: 'tcg-63x88', label: 'Poker / TCG 63 × 88 mm', w: 63, h: 88 },
  { id: 'japanese-mini', label: 'Japanese mini 59 × 86 mm', w: 59, h: 86 },
  { id: 'bridge', label: 'Bridge 57 × 89 mm', w: 57, h: 89 },
  { id: 'tarot', label: 'Tarot 70 × 120 mm', w: 70, h: 120 },
  { id: 'custom', label: 'Tuỳ chỉnh', w: 63.5, h: 88.9 },
];

export const docSizeMm = (s: Specs) => ({ w: s.widthMm + 2 * s.bleedMm, h: s.heightMm + 2 * s.bleedMm });

/** Pixel frame for a side given a target height in px (preview) or dpi (export). */
export function frameForHeight(s: Specs, heightPx: number): Frame {
  const doc = docSizeMm(s);
  const ppmm = heightPx / doc.h;
  return makeFrame(s, ppmm);
}

export function frameForDpi(s: Specs, dpi: number): Frame {
  return makeFrame(s, dpi / MM_PER_IN);
}

function makeFrame(s: Specs, ppmm: number): Frame {
  const doc = docSizeMm(s);
  const w = Math.max(1, Math.round(doc.w * ppmm));
  const h = Math.max(1, Math.round(doc.h * ppmm));
  const bx = Math.round(s.bleedMm * ppmm);
  return { w, h, ppmm, trim: { x: bx, y: bx, w: w - 2 * bx, h: h - 2 * bx } };
}

/** Decide whether an image covers the bleed box or only the trim box. */
export function resolveFit(fit: Fit, imgW: number, imgH: number, s: Specs): 'bleed' | 'trim' {
  if (fit !== 'auto') return fit;
  const a = imgW / imgH;
  const doc = docSizeMm(s);
  const aBleed = doc.w / doc.h;
  const aTrim = s.widthMm / s.heightMm;
  if (s.bleedMm <= 0) return 'bleed';
  return Math.abs(a - aBleed) <= Math.abs(a - aTrim) ? 'bleed' : 'trim';
}

export function toUnit(mm: number, unit: Unit, dpi: number): number {
  if (unit === 'in') return mm / MM_PER_IN;
  if (unit === 'px') return (mm / MM_PER_IN) * dpi;
  return mm;
}

export function fromUnit(v: number, unit: Unit, dpi: number): number {
  if (unit === 'in') return v * MM_PER_IN;
  if (unit === 'px') return (v / dpi) * MM_PER_IN;
  return v;
}

export function fmtUnit(mm: number, unit: Unit, dpi: number): string {
  const v = toUnit(mm, unit, dpi);
  const digits = unit === 'px' ? 0 : unit === 'in' ? 3 : 2;
  return `${+v.toFixed(digits)} ${unit}`;
}

export const mmToPt = (mm: number) => (mm / MM_PER_IN) * 72;

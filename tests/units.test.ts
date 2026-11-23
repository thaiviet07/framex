import { describe, expect, it } from 'vitest';
import { encodeTiff } from '../src/imaging/tiff';
import { docSizeMm, fmtUnit, frameForDpi, frameForHeight, fromUnit, resolveFit, toUnit } from '../src/model/units';
import { debounce } from '../src/core/math';
import type { Specs } from '../src/model/types';

const specs = { widthMm: 63.5, heightMm: 88.9, bleedMm: 3, safeMm: 3, cornerMm: 0, dpi: 300, plateDpi: 600 } as unknown as Specs;

describe('model/units', () => {
  it('docSize adds bleed on both sides', () => {
    expect(docSizeMm(specs)).toEqual({ w: 69.5, h: 94.9 });
  });

  it('frameForDpi yields correct pixel size and trim box at 300 DPI', () => {
    const f = frameForDpi(specs, 300);
    expect(f.w).toBe(Math.round((69.5 / 25.4) * 300));
    expect(f.h).toBe(Math.round((94.9 / 25.4) * 300));
    const bleedPx = Math.round((3 / 25.4) * 300);
    expect(f.trim).toEqual({ x: bleedPx, y: bleedPx, w: f.w - 2 * bleedPx, h: f.h - 2 * bleedPx });
  });

  it('frameForHeight honors the requested height', () => {
    expect(frameForHeight(specs, 900).h).toBe(900);
  });

  it('unit conversions round-trip', () => {
    for (const u of ['mm', 'in', 'px'] as const) {
      expect(fromUnit(toUnit(12.7, u, 300), u, 300)).toBeCloseTo(12.7, 6);
    }
    expect(fmtUnit(25.4, 'in', 300)).toBe('1 in');
    expect(fmtUnit(25.4, 'px', 300)).toBe('300 px');
  });

  it('resolveFit picks bleed vs trim by aspect ratio', () => {
    expect(resolveFit('auto', 695, 949, specs)).toBe('bleed');
    expect(resolveFit('auto', 635, 889, specs)).toBe('trim');
    expect(resolveFit('trim', 695, 949, specs)).toBe('trim');
  });
});

describe('imaging/tiff', () => {
  it('writes a little-endian baseline TIFF with pixel data', () => {
    const px = new Uint8Array([1, 2, 3, 4]);
    const tif = encodeTiff(px, 2, 2, 1, 600);
    expect(tif[0]).toBe(0x49); // 'I'
    expect(tif[1]).toBe(0x49); // 'I'
    expect(new DataView(tif.buffer, tif.byteOffset).getUint16(2, true)).toBe(42);
    expect(tif.length).toBeGreaterThan(px.length + 8);
  });
});

describe('core/debounce', () => {
  it('flush runs the pending call immediately exactly once', () => {
    let calls = 0;
    const d = debounce(() => calls++, 10_000);
    d();
    d();
    d.flush();
    d.flush();
    expect(calls).toBe(1);
  });
});

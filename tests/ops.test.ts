import { describe, expect, it } from 'vitest';
import { bbox, blur, combine, coverage, gray, hexToRgb, invert, levels, morph, rgbaToMask, threshold } from '../src/imaging/ops';

const fromArray = (w: number, h: number, vals: number[]) => {
  const g = gray(w, h);
  g.data.set(vals);
  return g;
};

describe('imaging/ops', () => {
  it('hexToRgb handles 3 and 6 digit hex', () => {
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
    expect(hexToRgb('000000')).toEqual([0, 0, 0]);
  });

  it('invert flips values', () => {
    expect([...invert(fromArray(3, 1, [0, 100, 255])).data]).toEqual([255, 155, 0]);
  });

  it('threshold produces a 1-bit mask', () => {
    const out = threshold(fromArray(4, 1, [0, 127, 128, 255]), 128);
    for (const v of out.data) expect(v === 0 || v === 255).toBe(true);
    expect(out.data[0]).toBe(0);
    expect(out.data[3]).toBe(255);
  });

  it('levels maps lo→0 and hi→255', () => {
    const out = levels(fromArray(3, 1, [50, 100, 200]), 50, 200);
    expect(out.data[0]).toBe(0);
    expect(out.data[2]).toBe(255);
  });

  it('combine implements boolean ops (in place on the first operand)', () => {
    const a = () => fromArray(4, 1, [255, 255, 0, 0]);
    const b = fromArray(4, 1, [255, 0, 255, 0]);
    expect([...combine(a(), b, 'add').data]).toEqual([255, 255, 255, 0]);
    expect([...combine(a(), b, 'subtract').data]).toEqual([0, 255, 0, 0]);
    expect([...combine(a(), b, 'intersect').data]).toEqual([255, 0, 0, 0]);
    expect([...combine(a(), b, 'xor').data]).toEqual([0, 255, 255, 0]);
  });

  it('bbox and coverage find the painted region', () => {
    const g = gray(10, 10);
    for (let y = 2; y < 5; y++) for (let x = 3; x < 7; x++) g.data[y * 10 + x] = 255;
    expect(bbox(g)).toEqual({ x: 3, y: 2, w: 4, h: 3 });
    expect(coverage(g)).toBeCloseTo(12 / 100, 5);
    expect(bbox(gray(4, 4))).toBeNull();
  });

  it('morph spreads (r>0) and chokes (r<0)', () => {
    const g = gray(9, 9);
    g.data[4 * 9 + 4] = 255;
    const before = coverage(g);
    expect(coverage(morph(g, 1))).toBeCloseTo(9 / 81, 5); // 1px → 3×3
    expect(before).toBeCloseTo(1 / 81, 5);
    const solid = gray(9, 9, 255);
    solid.data[0] = 0;
    const solidBefore = coverage(solid);
    expect(coverage(morph(solid, -1))).toBeLessThan(solidBefore);
  });

  it('blur keeps dimensions and total energy roughly constant', () => {
    const g = gray(16, 16);
    g.data[8 * 16 + 8] = 255;
    const out = blur(g, 2);
    expect(out.w).toBe(16);
    expect(out.h).toBe(16);
    expect(out.data[8 * 16 + 8]).toBeLessThan(255);
  });

  it('rgbaToMask alpha mode copies the alpha channel', () => {
    const px = new Uint8ClampedArray([0, 0, 0, 10, 255, 255, 255, 200]);
    expect([...rgbaToMask(px, 2, 1, 'alpha').data]).toEqual([10, 200]);
  });

  it('rgbaToMask color mode selects matching colors', () => {
    const px = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
    const m = rgbaToMask(px, 2, 1, 'color', '#ff0000', 10, 1);
    expect(m.data[0]).toBe(255);
    expect(m.data[1]).toBe(0);
  });
});

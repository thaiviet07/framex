/**
 * Minimal baseline TIFF encoder (uncompressed, single strip, little endian).
 * Supports 8-bit grayscale (MinIsBlack) and 8-bit RGB, with DPI tags so
 * prepress software opens plates at the correct physical size.
 */
export function encodeTiff(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: 1 | 3,
  dpi: number,
  software = 'FX Studio by @stoopiducky',
): Uint8Array {
  const tags: { tag: number; type: number; count: number; value: number | number[] | string }[] = [];
  const SHORT = 3, LONG = 4, RATIONAL = 5, ASCII = 2;
  const dataLen = width * height * channels;

  tags.push({ tag: 256, type: LONG, count: 1, value: width });
  tags.push({ tag: 257, type: LONG, count: 1, value: height });
  tags.push({ tag: 258, type: SHORT, count: channels, value: channels === 3 ? [8, 8, 8] : 8 });
  tags.push({ tag: 259, type: SHORT, count: 1, value: 1 });
  tags.push({ tag: 262, type: SHORT, count: 1, value: channels === 3 ? 2 : 1 });
  tags.push({ tag: 273, type: LONG, count: 1, value: 0 }); // patched
  tags.push({ tag: 277, type: SHORT, count: 1, value: channels });
  tags.push({ tag: 278, type: LONG, count: 1, value: height });
  tags.push({ tag: 279, type: LONG, count: 1, value: dataLen });
  tags.push({ tag: 282, type: RATIONAL, count: 1, value: [dpi, 1] });
  tags.push({ tag: 283, type: RATIONAL, count: 1, value: [dpi, 1] });
  tags.push({ tag: 284, type: SHORT, count: 1, value: 1 });
  tags.push({ tag: 296, type: SHORT, count: 1, value: 2 });
  tags.push({ tag: 305, type: ASCII, count: software.length + 1, value: software });

  const typeSize: Record<number, number> = { [SHORT]: 2, [LONG]: 4, [RATIONAL]: 8, [ASCII]: 1 };
  const headerLen = 8;
  const ifdLen = 2 + tags.length * 12 + 4;
  let extraLen = 0;
  const extraOffsets: number[] = [];
  for (const t of tags) {
    const size = typeSize[t.type] * t.count;
    if (size > 4) {
      extraOffsets.push(headerLen + ifdLen + extraLen);
      extraLen += size + (size % 2);
    } else extraOffsets.push(-1);
  }
  const dataOffset = headerLen + ifdLen + extraLen;
  const buf = new Uint8Array(dataOffset + dataLen);
  const dv = new DataView(buf.buffer);
  dv.setUint16(0, 0x4949, false); // "II"
  dv.setUint16(2, 42, true);
  dv.setUint32(4, headerLen, true);
  dv.setUint16(headerLen, tags.length, true);
  tags.forEach((t, i) => {
    if (t.tag === 273) t.value = dataOffset;
    const p = headerLen + 2 + i * 12;
    dv.setUint16(p, t.tag, true);
    dv.setUint16(p + 2, t.type, true);
    dv.setUint32(p + 4, t.count, true);
    const extra = extraOffsets[i];
    const writeVals = (at: number) => {
      if (t.type === ASCII) {
        const s = t.value as string;
        for (let k = 0; k < s.length; k++) buf[at + k] = s.charCodeAt(k) & 127;
        buf[at + s.length] = 0;
      } else if (t.type === RATIONAL) {
        const [n, d] = t.value as number[];
        dv.setUint32(at, n, true);
        dv.setUint32(at + 4, d, true);
      } else {
        const vals = Array.isArray(t.value) ? t.value : [t.value as number];
        vals.forEach((v, k) => (t.type === SHORT ? dv.setUint16(at + k * 2, v, true) : dv.setUint32(at + k * 4, v, true)));
      }
    };
    if (extra >= 0) {
      dv.setUint32(p + 8, extra, true);
      writeVals(extra);
    } else writeVals(p + 8);
  });
  dv.setUint32(headerLen + 2 + tags.length * 12, 0, true);
  buf.set(pixels.subarray(0, dataLen), dataOffset);
  return buf;
}

import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  StandardFonts,
  rgb,
  cmyk,
  pushGraphicsState,
  popGraphicsState,
  moveTo,
  lineTo,
  appendBezierCurve,
  closePath,
  stroke,
  setLineWidth,
  concatTransformationMatrix,
  drawObject,
} from 'pdf-lib';
import { zipSync, strToU8 } from 'fflate';
import type { Project, Side, Specs } from '../model/types';
import { docSizeMm, frameForDpi, mmToPt } from '../model/units';
import { imaging } from '../imaging/client';
import { TECHS } from '../model/techniques';
import { assets } from '../model/assets';
import { ENGINES, STYLES } from '../card/styles';
import type { PreflightIssue } from '../preflight/preflight';

export interface ExportOptions {
  pdf: boolean;
  tiffs: boolean;
  holoPattern: boolean;
  dieline: boolean;
  mockup: boolean;
  specSheet: boolean;
  preflight?: PreflightIssue[];
  mockupBlob?: Blob | null;
  mockupVideo?: { blob: Blob; ext: 'mp4' | 'webm' } | null;
  onProgress?: (pct: number, label: string) => void;
}

const SLUG_MM = 12;

/** Convert raw RGB Uint8Array to a PNG Blob via canvas for clean PDF embedding. */
async function rgbToPngBytes(rgbData: Uint8Array, w: number, h: number): Promise<Uint8Array> {
  const cv = new OffscreenCanvas(w, h);
  const ctx = cv.getContext('2d')!;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = rgbData[i * 3];
    rgba[i * 4 + 1] = rgbData[i * 3 + 1];
    rgba[i * 4 + 2] = rgbData[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
  const blob = await cv.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Create a PDF /Separation ColorSpace mapped to CMYK alternate via a Type 2 tint function
 * so Adobe Acrobat Output Preview recognizes real Spot Color separations.
 */
function addSeparationColorSpace(
  doc: PDFDocument,
  spotName: string,
  altCmyk: [number, number, number, number],
) {
  const ctx = doc.context;
  const fn = ctx.obj({
    FunctionType: 2,
    Domain: [0, 1],
    C0: [0, 0, 0, 0],
    C1: altCmyk,
    N: 1,
  });
  const fnRef = ctx.register(fn);
  const cs = ctx.obj([PDFName.of('Separation'), PDFName.of(spotName), PDFName.of('DeviceCMYK'), fnRef]);
  return ctx.register(cs);
}

/**
 * Embed an 8-bit grayscale tint buffer as a Separation-colored Image XObject in PDF
 * (each byte 0..255 = 0..100% spot ink tint!).
 */
function embedSpotMaskXObject(
  doc: PDFDocument,
  tint: Uint8Array,
  w: number,
  h: number,
  csRef: ReturnType<PDFDocument['context']['register']>,
) {
  const stream = doc.context.flateStream(tint, {
    Type: 'XObject',
    Subtype: 'Image',
    Width: w,
    Height: h,
    ColorSpace: csRef,
    BitsPerComponent: 8,
  });
  return doc.context.register(stream);
}

function drawMarksAndSlug(
  page: ReturnType<PDFDocument['addPage']>,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  specs: Specs,
  projectName: string,
  pageTitle: string,
) {
  const docMm = docSizeMm(specs);
  const slug = mmToPt(SLUG_MM);
  const bleedW = mmToPt(docMm.w);
  const bleedH = mmToPt(docMm.h);
  const bleedPt = mmToPt(specs.bleedMm);
  const trimX = slug + bleedPt;
  const trimY = slug + bleedPt;
  const trimW = mmToPt(specs.widthMm);
  const trimH = mmToPt(specs.heightMm);

  // Set official PDF boxes
  page.setBleedBox(slug, slug, bleedW, bleedH);
  page.setTrimBox(trimX, trimY, trimW, trimH);

  // Crop marks (registration black 100% CMYK)
  const regColor = cmyk(1, 1, 1, 1);
  const mLen = mmToPt(5);
  const mOff = mmToPt(Math.max(2, specs.bleedMm + 1));
  const corners: [number, number, number, number][] = [
    [trimX - mOff - mLen, trimY, trimX - mOff, trimY],
    [trimX, trimY - mOff - mLen, trimX, trimY - mOff],
    [trimX + trimW + mOff, trimY, trimX + trimW + mOff + mLen, trimY],
    [trimX + trimW, trimY - mOff - mLen, trimX + trimW, trimY - mOff],
    [trimX - mOff - mLen, trimY + trimH, trimX - mOff, trimY + trimH],
    [trimX, trimY + trimH + mOff, trimX, trimY + trimH + mOff + mLen],
    [trimX + trimW + mOff, trimY + trimH, trimX + trimW + mOff + mLen, trimY + trimH],
    [trimX + trimW, trimY + trimH + mOff, trimX + trimW, trimY + trimH + mOff + mLen],
  ];
  for (const [x1, y1, x2, y2] of corners) {
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.4, color: regColor });
  }

  // Registration targets (4 edge midpoints)
  const rMid = mmToPt(1.5);
  const targets: [number, number][] = [
    [slug + bleedW / 2, slug - mmToPt(5)],
    [slug + bleedW / 2, slug + bleedH + mmToPt(5)],
    [slug - mmToPt(5), slug + bleedH / 2],
    [slug + bleedW + mmToPt(5), slug + bleedH / 2],
  ];
  for (const [cx, cy] of targets) {
    page.drawCircle({ x: cx, y: cy, size: rMid, borderColor: regColor, borderWidth: 0.4 });
    page.drawLine({ start: { x: cx - rMid * 1.6, y: cy }, end: { x: cx + rMid * 1.6, y: cy }, thickness: 0.35, color: regColor });
    page.drawLine({ start: { x: cx, y: cy - rMid * 1.6 }, end: { x: cx, y: cy + rMid * 1.6 }, thickness: 0.35, color: regColor });
  }

  // Mini color bar (top-left slug)
  const patches = [cmyk(1, 0, 0, 0), cmyk(0, 1, 0, 0), cmyk(0, 0, 1, 0), cmyk(0, 0, 0, 1), cmyk(0.5, 0, 0, 0), cmyk(0, 0.5, 0, 0), cmyk(0, 0, 0.5, 0), cmyk(0, 0, 0, 0.5)];
  const pw = mmToPt(3.2);
  const ph = mmToPt(2.4);
  patches.forEach((col, i) => {
    page.drawRectangle({ x: trimX + i * (pw + 1), y: slug + bleedH + mmToPt(4), width: pw, height: ph, color: col });
  });

  // Slug label (bottom)
  const safeText = `${projectName} | ${pageTitle} | Trim ${specs.widthMm}x${specs.heightMm}mm | Bleed ${specs.bleedMm}mm | R${specs.cornerMm}mm`.replace(/[^\x20-\x7E]/g, '?');
  page.drawText(safeText, { x: trimX, y: mmToPt(3.2), size: 6.5, font, color: cmyk(0, 0, 0, 0.85) });
}

function buildDielineSvg(specs: Specs): string {
  const doc = docSizeMm(specs);
  const b = specs.bleedMm;
  const s = specs.safeMm;
  const r = specs.cornerMm;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${doc.w}mm" height="${doc.h}mm" viewBox="0 0 ${doc.w} ${doc.h}">
  <title>FramigosX Die-line (${specs.widthMm}x${specs.heightMm}mm)</title>
  <g id="BleedBox" fill="none" stroke="#0066ff" stroke-width="0.2" stroke-dasharray="1.5 1">
    <rect x="0" y="0" width="${doc.w}" height="${doc.h}" />
  </g>
  <g id="CutContour" fill="none" stroke="#ff00aa" stroke-width="0.25">
    <rect x="${b}" y="${b}" width="${specs.widthMm}" height="${specs.heightMm}" rx="${r}" ry="${r}" />
  </g>
  <g id="SafeZone" fill="none" stroke="#00aa55" stroke-width="0.2" stroke-dasharray="1 1">
    <rect x="${b + s}" y="${b + s}" width="${Math.max(0, specs.widthMm - 2 * s)}" height="${Math.max(0, specs.heightMm - 2 * s)}" />
  </g>
</svg>
`;
}

async function buildSpecSheetPdf(p: Project, preflight: PreflightIssue[], attachedPatterns: string[] = []): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const clean = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '');

  let y = 795;
  const line = (text: string, size = 10, isBold = false, color = rgb(0.12, 0.14, 0.16)) => {
    page.drawText(clean(text), { x: 48, y, size, font: isBold ? bold : font, color });
    y -= size + 6;
  };

  line('FRAMIGOSX HOLO STUDIO — PRODUCTION JOB TICKET', 14, true);
  line(`Project: ${p.name}    Date: ${new Date().toISOString().slice(0, 10)}`, 9, false, rgb(0.4, 0.42, 0.45));
  y -= 8;
  page.drawLine({ start: { x: 48, y }, end: { x: 547, y }, thickness: 0.75, color: rgb(0.75, 0.77, 0.75) });
  y -= 18;

  const s = p.specs;
  const docMm = docSizeMm(s);
  line('1. PHYSICAL SPECIFICATIONS', 11, true);
  line(`Trim Size: ${s.widthMm} x ${s.heightMm} mm   |   Bleed Size: ${docMm.w.toFixed(2)} x ${docMm.h.toFixed(2)} mm (Bleed ${s.bleedMm} mm)`);
  line(`Safe Zone: ${s.safeMm} mm   |   Corner Radius: ${s.cornerMm} mm   |   Substrate: ${s.substrate.toUpperCase()}`);
  line(`Artwork DPI: ${s.dpi} DPI (RGB sRGB — convert to house CMYK profile at RIP)   |   Plate DPI: ${s.plateDpi} DPI`);
  y -= 10;

  line('2. HOLO PATTERN SPECIFICATIONS (MULTI-LAYER)', 11, true);
  const visHolos = p.holo.enabled ? p.holo.layers.filter((hl) => hl.visible) : [];
  if (!visHolos.length) {
    line('Holo Pattern: Disabled');
  } else {
    for (const hl of visHolos) {
      const st = STYLES.find((x) => x.id === hl.styleId);
      const engLabel = st ? ENGINES[st.engine].label : 'Custom';
      const foilMeta = assets.meta(hl.foilId);
      line(
        `[${hl.name}] Preset: ${st?.label ?? hl.styleId} (${engLabel}) | Foil: ${foilMeta ? foilMeta.name : 'Preset/Procedural'}`,
        9,
        true,
      );
      line(
        `   Optics: Angle ${hl.optical.angle}deg, Space ${hl.optical.space}%, Scanline ${hl.optical.scanlineMm}mm, Shine ${Math.round(hl.optical.shineIntensity * 100)}%, Blend ${hl.optical.blendMode}`,
        8.5,
      );
      line(
        `   Masking: Scope=${hl.masking.scope}, Invert=${hl.masking.invert}, Choke=${hl.masking.chokeMm}mm, Feather=${hl.masking.featherMm}mm (${hl.masks.length} masks)`,
        8.5,
      );
    }
    if (attachedPatterns.length) {
      line(`Attached Pattern Files: ${attachedPatterns.join(', ')}`, 8.5);
    }
  }
  y -= 8;

  line('3. PRINTING PLATES / FINISHING TECHNIQUES', 11, true);
  const active = p.layers.filter((l) => l.visible && l.masks.length > 0);
  if (!active.length) {
    line('No special finishing plates configured.');
  } else {
    for (const l of active) {
      const def = TECHS[l.kind];
      const spot = def.spot(l);
      const paramStr = Object.entries(l.params)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      line(`[${l.side.toUpperCase()}] ${spot} (${l.name}) — Opacity ${Math.round(l.opacity * 100)}%, Choke ${l.chokeMm}mm | ${paramStr}`, 9);
    }
  }
  y -= 8;

  line('4. PREFLIGHT SUMMARY', 11, true);
  if (!preflight.length) {
    line('Preflight was not run prior to export.');
  } else {
    for (const item of preflight.slice(0, 16)) {
      const tag = item.severity === 'error' ? '[ERROR]' : item.severity === 'warn' ? '[WARN]' : '[OK]';
      const col = item.severity === 'error' ? rgb(0.75, 0.1, 0.1) : item.severity === 'warn' ? rgb(0.7, 0.45, 0.0) : rgb(0.1, 0.55, 0.25);
      line(`${tag} ${item.titleEn || item.title} — ${item.detailEn || item.detail}`, 8.5, false, col);
      if (y < 60) break;
    }
  }

  return doc.save();
}

export async function exportProductionZip(p: Project, opt: ExportOptions): Promise<{ blob: Blob; filename: string }> {
  const report = opt.onProgress ?? (() => {});
  const files: Record<string, Uint8Array> = {};
  const specs = p.specs;
  const artFrame = frameForDpi(specs, specs.dpi);
  const plateFrame = frameForDpi(specs, specs.plateDpi);
  const activeLayers = p.layers.filter((l) => l.visible && l.masks.length > 0);

  const holoExportLayers = p.holo.enabled
    ? p.holo.layers.filter((hl) => hl.visible && (opt.holoPattern || hl.masking.exportAsPlate))
    : [];
  const totalSteps = 2 + activeLayers.length + holoExportLayers.length * 2 + (opt.pdf ? 2 : 0) + (opt.specSheet ? 1 : 0);
  let step = 0;
  const tick = (label: string) => report(Math.min(98, Math.round((++step / totalSteps) * 100)), label);

  // 1. Render Front & Back artwork
  const artData: Record<Side, { rgb: Uint8Array; tiff: Uint8Array; w: number; h: number }> = {} as any;
  for (const side of ['front', 'back'] as Side[]) {
    tick(`Đang xuất artwork ${side === 'front' ? 'mặt trước' : 'mặt sau'} (${specs.dpi} DPI)...`);
    const src = imaging.sourceSpec(p, side);
    const res = await imaging.artworkExport(src, artFrame, specs.dpi);
    artData[side] = res;
    if (opt.tiffs) files[`${side}_artwork.tif`] = res.tiff;
  }

  // 2. Render plates (+ optional HoloFoil spot plate)
  const plates: {
    side: Side;
    name: string;
    kind: string;
    spot: string;
    cmyk: [number, number, number, number];
    opacity: number;
    chokeMm: number;
    params: Record<string, number | string>;
    tint: Uint8Array;
    tiff: Uint8Array;
    w: number;
    h: number;
  }[] = [];

  const attachedPatternFiles: string[] = [];
  const exportedHoloPlatePaths: string[] = [];
  const seenPresetFiles = new Set<string>();

  for (let hi = 0; hi < holoExportLayers.length; hi++) {
    const hl = holoExportLayers[hi];
    const safeTag = hl.name.replace(/[^a-zA-Z0-9_-]+/g, '_') || `Holo_${hi + 1}`;
    const suffix = holoExportLayers.length > 1 ? `_${safeTag}` : '';
    const useMask = hl.masks.length > 0 && hl.masking.scope !== 'none';
    const holoSpec = useMask ? imaging.holoMaskSpec(p, hl) : { refs: [], invert: true, chokeMm: 0, blurMm: 0 };

    // 2a. Holo Mask Plate
    tick(`Exporting FRONT Holo Mask — ${hl.name} (${specs.plateDpi} DPI)...`);
    const maskRes = await imaging.plate(holoSpec, plateFrame, specs.plateDpi);
    const maskPath = `plates/plate_front_HoloMask${suffix}.tif`;
    plates.push({
      side: 'front',
      name: `${hl.name} Mask (${hl.styleId})`,
      kind: 'holo-mask',
      spot: `HoloFoil${suffix}`,
      cmyk: [0.25, 0, 0.15, 0.1],
      opacity: 1,
      chokeMm: hl.masking.chokeMm,
      params: { style: hl.styleId, scope: hl.masking.scope },
      tint: maskRes.tint,
      tiff: maskRes.tiff,
      w: maskRes.w,
      h: maskRes.h,
    });
    if (opt.tiffs || opt.holoPattern) {
      files[maskPath] = maskRes.tiff;
      exportedHoloPlatePaths.push(maskPath);
    }

    // Fetch preset primary pattern texture blob
    const presetStyle = STYLES.find((x) => x.id === hl.styleId);
    let primaryPresetBlob: Blob | null = null;
    if (presetStyle?.patterns[0]) {
      try {
        const r = await fetch(presetStyle.patterns[0]);
        if (r.ok) primaryPresetBlob = await r.blob();
      } catch { /* ignore */ }
    }

    // 2b. Holo Pattern Plate
    tick(`Exporting FRONT Holo Pattern — ${hl.name} (${specs.plateDpi} DPI)...`);
    const patRes = await imaging.holoPatternPlate(
      hl.styleId,
      hl.foilId,
      primaryPresetBlob,
      useMask ? holoSpec : null,
      hl.optical.angle,
      hl.optical.space,
      hl.optical.scanlineMm,
      plateFrame,
      specs.plateDpi,
    );
    const patPath = `plates/plate_front_HoloPattern${suffix}.tif`;
    plates.push({
      side: 'front',
      name: `${hl.name} Pattern (${hl.styleId})`,
      kind: 'holo-pattern',
      spot: `HoloPattern${suffix}`,
      cmyk: [0.45, 0.1, 0, 0.05],
      opacity: 1,
      chokeMm: hl.masking.chokeMm,
      params: {
        style: hl.styleId,
        angle: hl.optical.angle,
        space: hl.optical.space,
        scanlineMm: hl.optical.scanlineMm,
        blendMode: hl.optical.blendMode,
      },
      tint: patRes.tint,
      tiff: patRes.tiff,
      w: patRes.w,
      h: patRes.h,
    });
    if (opt.tiffs || opt.holoPattern) {
      files[patPath] = patRes.tiff;
      exportedHoloPlatePaths.push(patPath);
    }

    // 2c. Attach real preset Holo Pattern texture files + custom foil source
    if (presetStyle && opt.holoPattern) {
      const presetSlug = presetStyle.id.replace(/[^a-zA-Z0-9_-]+/g, '_');
      for (const patFile of presetStyle.patterns) {
        const base = patFile.split('/').pop() || 'pattern.png';
        const outPath = `holo/${presetSlug}/${base}`;
        if (seenPresetFiles.has(outPath)) continue;
        try {
          const res = await fetch(patFile);
          if (!res.ok) continue;
          files[outPath] = new Uint8Array(await res.arrayBuffer());
          seenPresetFiles.add(outPath);
          attachedPatternFiles.push(outPath);
        } catch { /* ignore */ }
      }
    }

    const foilAsset = assets.get(hl.foilId);
    if (foilAsset && opt.holoPattern) {
      const ext = (foilAsset.name.split('.').pop() || 'png').replace(/[^a-zA-Z0-9]/g, '');
      const outPath = `holo/custom_foil${suffix}.${ext}`;
      files[outPath] = new Uint8Array(await foilAsset.blob.arrayBuffer());
      attachedPatternFiles.push(outPath);
    }
  }
  (opt as any)._attachedPatternFiles = attachedPatternFiles;

  for (const l of activeLayers) {
    const def = TECHS[l.kind];
    const spot = def.spot(l);
    tick(`Đang xuất bản in ${l.side.toUpperCase()} — ${spot} (${specs.plateDpi} DPI)...`);
    const isRelief = l.kind === 'emboss' || l.kind === 'deboss';
    const spec = imaging.layerSpec(p, l, {
      binary: l.kind === 'foil-hot' || l.kind === 'foil-cold' || l.kind === 'spot-uv',
      blurMm: isRelief && l.params.profile === 'single' ? Number(l.params.bevelMm ?? 0) * 0.5 : 0,
    });
    const res = await imaging.plate(spec, plateFrame, specs.plateDpi);
    plates.push({
      side: l.side,
      name: l.name,
      kind: l.kind,
      spot,
      cmyk: def.cmyk(l),
      opacity: l.opacity,
      chokeMm: l.chokeMm,
      params: l.params,
      tint: res.tint,
      tiff: res.tiff,
      w: res.w,
      h: res.h,
    });
    if (opt.tiffs) {
      const safeName = `${l.side}_${spot}_${l.name}`.replace(/[^a-zA-Z0-9_-]+/g, '_');
      files[`plates/plate_${safeName}.tif`] = res.tiff;
    }
  }

  // 3. Build multi-page print_ready.pdf with real Spot Color separations
  if (opt.pdf) {
    tick('Đang tạo print_ready.pdf (TrimBox, BleedBox, Spot Colors)...');
    const pdf = await PDFDocument.create();
    pdf.setTitle(`${p.name} — Print Ready`);
    pdf.setCreator('FramigosX Holo Studio');
    const font = await pdf.embedFont(StandardFonts.Helvetica);

    const docMm = docSizeMm(specs);
    const slug = mmToPt(SLUG_MM);
    const bleedW = mmToPt(docMm.w);
    const bleedH = mmToPt(docMm.h);
    const pageW = bleedW + slug * 2;
    const pageH = bleedH + slug * 2;

    // Front & Back pages
    for (const side of ['front', 'back'] as Side[]) {
      const page = pdf.addPage([pageW, pageH]);
      const pngBytes = await rgbToPngBytes(artData[side].rgb, artData[side].w, artData[side].h);
      const img = await pdf.embedPng(pngBytes);
      page.drawImage(img, { x: slug, y: slug, width: bleedW, height: bleedH });
      drawMarksAndSlug(page, font, specs, p.name, `${side.toUpperCase()} ARTWORK`);
    }

    // Die-line page with CutContour spot color
    {
      const page = pdf.addPage([pageW, pageH]);
      const cutCs = addSeparationColorSpace(pdf, 'CutContour', [0, 1, 0, 0]);
      const csKey = PDFName.of('CS_CutContour');
      let resources = page.node.Resources();
      if (!resources) {
        resources = pdf.context.obj({});
        page.node.set(PDFName.of('Resources'), resources);
      }
      let csDict = resources.lookup(PDFName.of('ColorSpace'));
      if (!(csDict instanceof PDFDict)) {
        csDict = pdf.context.obj({});
        resources.set(PDFName.of('ColorSpace'), csDict);
      }
      (csDict as PDFDict).set(csKey, cutCs);

      const tx = slug + mmToPt(specs.bleedMm);
      const ty = slug + mmToPt(specs.bleedMm);
      const tw = mmToPt(specs.widthMm);
      const th = mmToPt(specs.heightMm);
      const r = mmToPt(specs.cornerMm);
      const k = r * 0.55228475;
      const ops: any[] = [
        pushGraphicsState(),
        PDFOperator.of(PDFOperatorNames.StrokingColorspace, [csKey]),
        PDFOperator.of(PDFOperatorNames.StrokingColorN, [PDFNumber.of(1)]),
        setLineWidth(0.5),
      ];
      if (r <= 0.1) {
        ops.push(moveTo(tx, ty), lineTo(tx + tw, ty), lineTo(tx + tw, ty + th), lineTo(tx, ty + th), closePath(), stroke());
      } else {
        ops.push(
          moveTo(tx + r, ty),
          lineTo(tx + tw - r, ty),
          appendBezierCurve(tx + tw - r + k, ty, tx + tw, ty + r - k, tx + tw, ty + r),
          lineTo(tx + tw, ty + th - r),
          appendBezierCurve(tx + tw, ty + th - r + k, tx + tw - r + k, ty + th, tx + tw - r, ty + th),
          lineTo(tx + r, ty + th),
          appendBezierCurve(tx + r - k, ty + th, tx, ty + th - r + k, tx, ty + th - r),
          lineTo(tx, ty + r),
          appendBezierCurve(tx, ty + r - k, tx + r - k, ty, tx + r, ty),
          closePath(),
          stroke(),
        );
      }
      ops.push(popGraphicsState());
      page.pushOperators(...ops);
      drawMarksAndSlug(page, font, specs, p.name, 'DIELINE (CutContour)');
    }

    // Spot Color separation plate pages
    for (let i = 0; i < plates.length; i++) {
      const pl = plates[i];
      const page = pdf.addPage([pageW, pageH]);
      const csRef = addSeparationColorSpace(pdf, pl.spot, pl.cmyk);
      const xobjRef = embedSpotMaskXObject(pdf, pl.tint, pl.w, pl.h, csRef);
      const xName = PDFName.of(`Plate_${i}`);
      let resources = page.node.Resources();
      if (!resources) {
        resources = pdf.context.obj({});
        page.node.set(PDFName.of('Resources'), resources);
      }
      let xDict = resources.lookup(PDFName.of('XObject'));
      if (!(xDict instanceof PDFDict)) {
        xDict = pdf.context.obj({});
        resources.set(PDFName.of('XObject'), xDict);
      }
      (xDict as PDFDict).set(xName, xobjRef);

      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(bleedW, 0, 0, bleedH, slug, slug),
        drawObject(xName),
        popGraphicsState(),
      );
      drawMarksAndSlug(page, font, specs, p.name, `PLATE ${pl.side.toUpperCase()} — ${pl.spot}`);
    }

    tick('Đang nén print_ready.pdf...');
    files['print_ready.pdf'] = await pdf.save();
  }

  // 4. Die-line SVG
  if (opt.dieline) files['dieline.svg'] = strToU8(buildDielineSvg(specs));

  // 5. Mockup PNG & 3D Full HD 1080p Proof Video (10s, 2 loops)
  if (opt.mockup && opt.mockupBlob) {
    files['preview_mockup.png'] = new Uint8Array(await opt.mockupBlob.arrayBuffer());
  }
  if (opt.mockup && opt.mockupVideo) {
    files[`preview_mockup_3d_1080p.${opt.mockupVideo.ext}`] = new Uint8Array(await opt.mockupVideo.blob.arrayBuffer());
  }

  // 6. Spec JSON + Spec Sheet PDF (always English)
  const specJson = {
    generator: 'FramigosX Holo Studio 2.0',
    exportedAt: new Date().toISOString(),
    project: p.name,
    specs: p.specs,
    holo: {
      enabled: p.holo.enabled,
      layers: p.holo.layers.map((hl) => {
        const st = STYLES.find((x) => x.id === hl.styleId);
        const fm = assets.meta(hl.foilId);
        return {
          name: hl.name,
          visible: hl.visible,
          styleId: hl.styleId,
          presetName: st?.label ?? hl.styleId,
          engine: st ? ENGINES[st.engine].label : 'custom',
          foilSource: fm ? fm.name : 'preset/procedural',
          optical: hl.optical,
          masking: {
            scope: hl.masking.scope,
            invert: hl.masking.invert,
            chokeMm: hl.masking.chokeMm,
            featherMm: hl.masking.featherMm,
            maskCount: hl.masks.length,
          },
        };
      }),
      exportedPlates: exportedHoloPlatePaths,
      attachedPatternFiles,
    },
    plates: plates.map((pl) => ({
      side: pl.side,
      name: pl.name,
      technique: pl.kind,
      spotColor: pl.spot,
      opacity: pl.opacity,
      chokeMm: pl.chokeMm,
      params: pl.params,
      dpi: specs.plateDpi,
    })),
    preflight: (opt.preflight ?? []).map((it) => ({
      severity: it.severity,
      side: it.side ?? null,
      title: it.titleEn || it.title,
      detail: it.detailEn || it.detail,
    })),
  };
  files['spec.json'] = strToU8(JSON.stringify(specJson, null, 2));

  if (opt.specSheet) {
    tick('Đang tạo spec_sheet.pdf...');
    files['spec_sheet.pdf'] = await buildSpecSheetPdf(p, opt.preflight ?? [], ((opt as any)._attachedPatternFiles as string[] | undefined) ?? []);
  }

  report(99, 'Đang đóng gói ZIP...');
  const zipped = zipSync(files, { level: 6 });
  const slugName = p.name.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_|_$/g, '') || 'card';
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  report(100, 'Hoàn tất!');
  return {
    blob: new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' }),
    filename: `FXH_${slugName}_${dateStr}.zip`,
  };
}

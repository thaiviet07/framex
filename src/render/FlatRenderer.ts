import type { Frame, Layer, Specs } from '../model/types';
import { TECHS } from '../model/techniques';
import { hexToRgb } from '../imaging/ops';
import type { LayerDraw } from './TechRenderer';

export interface FlatOptions {
  frame: Frame;
  specs: Specs;
  artwork: { data: Uint8ClampedArray; w: number; h: number } | null;
  draws: LayerDraw[];
  hiddenPlates: Set<string>;
  showArtwork: boolean;
  showGuides: boolean;
  highlight: { x: number; y: number; w: number; h: number } | null;
  layerMaskOverlay?: { mask: Uint8Array; w: number; h: number } | null;
}

/**
 * 2D Flat Prepress Separation Viewer:
 * renders bleed box, dimmed artwork, colour-coded plate overlays, trim/safe/die-line
 * guides, crop marks, and optional preflight highlight box.
 */
export function renderFlat(canvas: HTMLCanvasElement, opt: FlatOptions) {
  const { frame, specs, artwork, draws, hiddenPlates, showArtwork, showGuides, highlight, layerMaskOverlay } = opt;
  const pad = 34; // space around bleed box for crop marks & labels
  const cw = frame.w + pad * 2;
  const ch = frame.h + pad * 2;
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, cw, ch);

  // Paper / bleed backdrop
  ctx.fillStyle = specs.substrate === 'metallic' ? '#c8ced4' : '#ffffff';
  ctx.fillRect(pad, pad, frame.w, frame.h);

  // Artwork
  if (showArtwork && artwork) {
    const tmp = document.createElement('canvas');
    tmp.width = artwork.w;
    tmp.height = artwork.h;
    tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(artwork.data), artwork.w, artwork.h), 0, 0);
    ctx.save();
    ctx.globalAlpha = draws.some((d) => d.layer.visible && !hiddenPlates.has(d.layer.id)) ? 0.55 : 1;
    ctx.drawImage(tmp, pad, pad, frame.w, frame.h);
    ctx.restore();
  }

  // Plate separation overlays
  const scratch = document.createElement('canvas');
  scratch.width = frame.w;
  scratch.height = frame.h;
  const sctx = scratch.getContext('2d')!;
  const imgData = sctx.createImageData(frame.w, frame.h);

  for (const d of draws) {
    const l: Layer = d.layer;
    if (!l.visible || hiddenPlates.has(l.id)) continue;
    const [r, g, b] = hexToRgb(TECHS[l.kind].view);
    const dst = imgData.data;
    const src = d.mask;
    const alphaScale = 0.62 * l.opacity;
    for (let i = 0; i < src.length; i++) {
      const o = i * 4;
      dst[o] = r;
      dst[o + 1] = g;
      dst[o + 2] = b;
      dst[o + 3] = src[i] * alphaScale;
    }
    sctx.putImageData(imgData, 0, 0);
    ctx.drawImage(scratch, pad, pad);
  }

  // Selected Layer Mask Overlay (high-contrast diagonal rubylith hatch across full bleed + trim)
  if (layerMaskOverlay) {
    const ov = document.createElement('canvas');
    ov.width = layerMaskOverlay.w;
    ov.height = layerMaskOverlay.h;
    const octx = ov.getContext('2d')!;
    const oImg = octx.createImageData(ov.width, ov.height);
    const dst = oImg.data;
    const src = layerMaskOverlay.mask;
    for (let y = 0; y < ov.height; y++) {
      const row = y * ov.width;
      for (let x = 0; x < ov.width; x++) {
        const m = src[row + x];
        if (m < 4) continue;
        const stripe = ((x + y) >> 3) & 1;
        const o = (row + x) * 4;
        if (stripe === 0) {
          dst[o] = 255; dst[o + 1] = 59; dst[o + 2] = 129;
        } else {
          dst[o] = 0; dst[o + 1] = 212; dst[o + 2] = 255;
        }
        dst[o + 3] = Math.round(m * 0.62);
      }
    }
    octx.putImageData(oImg, 0, 0);
    ctx.drawImage(ov, pad, pad, frame.w, frame.h);
  }

  // Guides: bleed, trim (with corner radius), safe zone, crop marks
  if (showGuides) {
    const tx = pad + frame.trim.x;
    const ty = pad + frame.trim.y;
    const tw = frame.trim.w;
    const th = frame.trim.h;
    const cr = specs.cornerMm * frame.ppmm;
    const safePx = specs.safeMm * frame.ppmm;

    ctx.save();
    // Bleed box (blue dashed)
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(pad + 0.5, pad + 0.5, frame.w - 1, frame.h - 1);

    // Trim / Die-cut line (magenta solid)
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([]);
    roundRectPath(ctx, tx, ty, tw, th, cr);
    ctx.stroke();

    // Safe zone (green dashed)
    if (safePx > 0) {
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(tx + safePx, ty + safePx, Math.max(0, tw - safePx * 2), Math.max(0, th - safePx * 2));
    }

    // Crop marks at trim corners
    ctx.strokeStyle = '#1b2126';
    if (document.documentElement.dataset.scheme === 'dark') ctx.strokeStyle = '#e4e6dd';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([]);
    const mLen = 16;
    const gap = Math.max(6, frame.trim.x + 4);
    const marks: [number, number, number, number][] = [
      [tx - gap - mLen, ty, tx - gap, ty],
      [tx, ty - gap - mLen, tx, ty - gap],
      [tx + tw + gap, ty, tx + tw + gap + mLen, ty],
      [tx + tw, ty - gap - mLen, tx + tw, ty - gap],
      [tx - gap - mLen, ty + th, tx - gap, ty + th],
      [tx, ty + th + gap, tx, ty + th + gap + mLen],
      [tx + tw + gap, ty + th, tx + tw + gap + mLen, ty + th],
      [tx + tw, ty + th + gap, tx + tw, ty + th + gap + mLen],
    ];
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of marks) {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();

    // Dimension label
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = '500 12px "Zen Kaku Gothic New", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      `Trim ${specs.widthMm}×${specs.heightMm} mm • Bleed ${specs.bleedMm} mm • Safe ${specs.safeMm} mm • Corner R${specs.cornerMm} mm`,
      cw / 2,
      ch - 10,
    );
    ctx.restore();
  }

  // Preflight highlight box
  if (highlight) {
    ctx.save();
    ctx.strokeStyle = '#ef4444';
    ctx.fillStyle = 'rgba(239, 68, 68, 0.14)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 4]);
    ctx.fillRect(pad + highlight.x, pad + highlight.y, highlight.w, highlight.h);
    ctx.strokeRect(pad + highlight.x, pad + highlight.y, highlight.w, highlight.h);
    ctx.restore();
  }
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (rad <= 0.1) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

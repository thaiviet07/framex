import type { Frame, HoloLayer, Project } from '../model/types';
import type { CardState } from '../card/HoloCard';
import { STYLES } from '../card/styles';

export interface ExportHoloLayer {
  layer: HoloLayer;
  mask: { data: Uint8Array; w: number; h: number } | null;
  foilImg: HTMLImageElement | null;
}

/**
 * Presets whose CSS renders a built-in pattern texture even when `.masked` is active
 * (as opposed to full-art/ultra-rare presets that only load `illusion.png`/`trainerbg.png`
 * inside `:not(.masked)` when no custom foil is set).
 */
export function presetUsesBuiltInTextureWhenMasked(styleId: string): boolean {
  return /(cosmos-holo|v-max|tg-vmax|tg-secret|pokeball-holo|masterball-holo|double-rare|special-illustration-rare|hyper-rare|amazing-rare|rainbow-alt|shiny-vmax)$/.test(
    styleId,
  );
}

/**
 * Whether a preset falls back to a tiled (33%) texture in CSS when unmasked and no custom foil is provided.
 */
function presetUsesTiledFallbackWhenUnmasked(styleId: string): boolean {
  return /(ultra-rare|v-full-art|trainer-full-art|shiny-rare|shiny-v|v-star|secret-rare|rainbow-holo|swsh-pikachu)$/.test(
    styleId,
  );
}

export function isVerticalHoloStyle(styleId: string): boolean {
  return /regular-holo|tg-holo|reverse-holo|:v$|tg-v$/.test(styleId);
}

export function isCrosshatchHoloStyle(styleId: string): boolean {
  return /radiant/.test(styleId);
}

export function makeMaskCanvas(
  mask: { data: Uint8Array; w: number; h: number } | null,
  frame: Frame,
  tw: number,
  th: number,
): HTMLCanvasElement | null {
  if (!mask) return null;
  const tmp = document.createElement('canvas');
  tmp.width = mask.w;
  tmp.height = mask.h;
  const tctx = tmp.getContext('2d')!;
  const img = tctx.createImageData(mask.w, mask.h);
  for (let i = 0; i < mask.data.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = mask.data[i];
  }
  tctx.putImageData(img, 0, 0);
  const out = document.createElement('canvas');
  out.width = tw;
  out.height = th;
  const octx = out.getContext('2d')!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(tmp, frame.trim.x, frame.trim.y, frame.trim.w, frame.trim.h, 0, 0, tw, th);
  return out;
}

export interface PreparedHoloLayer {
  hl: HoloLayer;
  isVertical: boolean;
  isCross: boolean;
  maskCv: HTMLCanvasElement | null;
  scanlinePat: CanvasPattern | null;
  foilImg: HTMLImageElement | null;
  presetPatImg: HTMLImageElement | null;
  tilePreset: boolean;
  label: string;
}

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

export async function prepareExportHoloLayers(
  p: Project,
  holoLayers: ExportHoloLayer[],
  frame: Frame,
  cardW: number,
  cardH: number,
  hCtx: CanvasRenderingContext2D,
): Promise<PreparedHoloLayer[]> {
  if (!p.holo.enabled) return [];

  return Promise.all(
    holoLayers.map(async (item) => {
      const hl = item.layer;
      const stObj = STYLES.find((s) => s.id === hl.styleId);
      const isVertical = isVerticalHoloStyle(hl.styleId);
      const isCross = isCrosshatchHoloStyle(hl.styleId);
      const maskCv = hl.masking.scope !== 'none' ? makeMaskCanvas(item.mask, frame, cardW, cardH) : null;
      const hasMask = !!maskCv;

      let scanlinePat: CanvasPattern | null = null;
      if (isVertical) {
        const periodPx = Math.max(2, Math.round(((hl.optical.scanlineMm || 0.7) / Math.max(10, p.specs.widthMm)) * cardW));
        const half = Math.max(1, Math.round(periodPx / 2));
        const tile = document.createElement('canvas');
        tile.width = periodPx;
        tile.height = 4;
        const tctx = tile.getContext('2d')!;
        tctx.fillStyle = '#000000';
        tctx.fillRect(0, 0, half, 4);
        tctx.fillStyle = '#666666';
        tctx.fillRect(half, 0, periodPx - half, 4);
        scanlinePat = hCtx.createPattern(tile, 'repeat');
      }

      // Match CSS: only use built-in preset texture if the CSS actually displays it for this masked/unmasked state
      let presetPatImg: HTMLImageElement | null = null;
      let tilePreset = false;
      const hasCustomFoil = !!(item.foilImg && item.foilImg.complete && item.foilImg.naturalWidth > 0);
      if (!hasCustomFoil && !isVertical && !isCross && stObj?.patterns[0]) {
        if (presetUsesBuiltInTextureWhenMasked(hl.styleId)) {
          presetPatImg = await loadImg(stObj.patterns[0]);
          tilePreset = /glitter|pokeball|masterball|birthday/.test(stObj.patterns[0]);
        } else if (!hasMask && presetUsesTiledFallbackWhenUnmasked(hl.styleId)) {
          presetPatImg = await loadImg(stObj.patterns[0]);
          tilePreset = true;
        }
      }

      return {
        hl,
        isVertical,
        isCross,
        maskCv,
        scanlinePat,
        foilImg: hasCustomFoil ? item.foilImg : null,
        presetPatImg,
        tilePreset,
        label: stObj?.label ?? hl.styleId,
      };
    }),
  );
}

function drawTiledTexture(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number, scaleFrac = 0.33) {
  const tw = Math.max(32, Math.round(w * scaleFrac));
  const th = Math.max(32, Math.round((img.naturalHeight / Math.max(1, img.naturalWidth)) * tw));
  const tile = document.createElement('canvas');
  tile.width = tw;
  tile.height = th;
  tile.getContext('2d')!.drawImage(img, 0, 0, tw, th);
  const pat = ctx.createPattern(tile, 'repeat');
  if (pat) {
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, w, h);
  }
}

/**
 * Draw all visible Holo layers onto `fCtx` matching the CSS pokemon-cards-css / 151 shaders:
 * - Regular Holo: 110deg rainbow + vertical scanlines + dual moving vertical beams + radial luminosity spotlight + glare
 * - Full-Art / Ultra-Rare: smooth sunpillar rainbow + dual counter-moving diagonal metallic shimmer ridges + radial spotlight + glare (no unintended wavy foil when masked!)
 * - Radiant: 45deg crosshatch + sunpillar + spotlight + glare
 * - Custom / Built-in Foil: properly tiled or covered with soft-light
 */
export function compositeHoloLayers(
  fCtx: CanvasRenderingContext2D,
  hCtx: CanvasRenderingContext2D,
  holoLayerCv: HTMLCanvasElement,
  preparedHolos: PreparedHoloLayer[],
  crossPat: CanvasPattern | null,
  cardW: number,
  cardH: number,
  state: CardState,
) {
  const { px, py } = state;
  const distFromCenter = Math.min(1, Math.hypot((px - 50) / 50, (py - 50) / 50));
  const gx = (px / 100) * cardW;
  const gy = (py / 100) * cardH;

  for (const ph of preparedHolos) {
    const opt = ph.hl.optical;
    hCtx.clearRect(0, 0, cardW, cardH);
    hCtx.save();

    if (ph.isVertical) {
      // 1. Regular Holo: 110deg rainbow + vertical scanlines + dual moving vertical beams + radial luminosity
      const ang = (110 * Math.PI) / 180;
      const dx = Math.cos(ang) * cardW * 1.1;
      const dy = Math.sin(ang) * cardH * 1.1;
      const shift = ((50 - px) / 50) * 0.65 + ((50 - py) / 50) * 0.45;
      const grad = hCtx.createLinearGradient(cardW / 2 - dx, cardH / 2 - dy, cardW / 2 + dx, cardH / 2 + dy);
      const stops = 15;
      for (let s = 0; s <= stops; s++) {
        const pos = s / stops;
        const hue = (((pos * 360 * 2.2 + shift * 220 + opt.hue) % 360) + 360) % 360;
        grad.addColorStop(pos, `hsla(${hue}, ${Math.round(85 * opt.saturation)}%, 54%, 0.85)`);
      }
      hCtx.fillStyle = grad;
      hCtx.fillRect(0, 0, cardW, cardH);

      if (ph.scanlinePat) {
        hCtx.globalCompositeOperation = 'overlay';
        hCtx.fillStyle = ph.scanlinePat;
        hCtx.fillRect(0, 0, cardW, cardH);
      }

      // Dual counter-moving vertical light beams (:before)
      hCtx.globalCompositeOperation = 'hard-light';
      const drawVerticalBeams = (offsetPx: number, period: number, alpha: number) => {
        const bGrad = hCtx.createLinearGradient(0, 0, period, 0);
        bGrad.addColorStop(0.0, 'rgba(0,0,0,0)');
        bGrad.addColorStop(0.16, 'rgba(0,0,0,0)');
        bGrad.addColorStop(0.22, `rgba(215,215,215,${alpha})`);
        bGrad.addColorStop(0.27, 'rgba(0,0,0,0)');
        bGrad.addColorStop(0.32, `rgba(230,230,230,${alpha * 0.9})`);
        bGrad.addColorStop(0.39, 'rgba(0,0,0,0)');
        bGrad.addColorStop(1.0, 'rgba(0,0,0,0)');
        hCtx.fillStyle = bGrad;
        const start = ((offsetPx % period) + period) % period - period;
        for (let bx = start; bx < cardW + period; bx += period) {
          hCtx.save();
          hCtx.translate(bx, 0);
          hCtx.fillRect(0, 0, period, cardH);
          hCtx.restore();
        }
      };
      drawVerticalBeams((50 - px) * (cardW * 0.008) + (py - 50) * (cardW * 0.002), Math.round(cardW * 0.38), 0.72);
      drawVerticalBeams((px - 50) * (cardW * 0.005) - (py - 50) * (cardW * 0.003), Math.round(cardW * 0.28), 0.58);

      // Radial luminosity falloff (:after) — keeps beam crisp near pointer and dark at far corners
      hCtx.globalCompositeOperation = 'multiply';
      const lum = hCtx.createRadialGradient(gx, gy, cardW * 0.04, gx, gy, cardW * 0.95);
      lum.addColorStop(0, 'rgba(255,255,255,1)');
      lum.addColorStop(0.35, 'rgba(185,185,185,1)');
      lum.addColorStop(0.85, 'rgba(42,42,42,1)');
      lum.addColorStop(1, 'rgba(18,18,18,1)');
      hCtx.fillStyle = lum;
      hCtx.fillRect(0, 0, cardW, cardH);
      hCtx.globalCompositeOperation = 'source-over';
    } else {
      // 2. Full-Art / Ultra-Rare / Radiant / Foil presets (matches ex-full-art.css / v-full-art.css / trainer-full-art.css)
      const sunGrad = hCtx.createLinearGradient(0, 0, 0, cardH);
      const yShift = ((py - 50) / 50) * 0.45;
      const sunStops = 12;
      const cycle = Math.max(0.5, 5 / Math.max(1.5, opt.space));
      for (let s = 0; s <= sunStops; s++) {
        const pos = s / sunStops;
        const hue = (((pos * 360 * cycle * 0.85 + yShift * 180 + opt.hue) % 360) + 360) % 360;
        sunGrad.addColorStop(pos, `hsla(${hue}, ${Math.round(72 * opt.saturation)}%, 54%, 0.72)`);
      }
      hCtx.fillStyle = sunGrad;
      hCtx.fillRect(0, 0, cardW, cardH);

      // Diagonal metallic shimmer ridges (matches repeating-linear-gradient(var(--angle), #0e152e, hsl(180,29%,66%), #0e152e))
      const drawDiagonalShimmer = (angleDeg: number, phaseOffset: number, op: GlobalCompositeOperation, alpha: number) => {
        const rad = (angleDeg * Math.PI) / 180;
        const diag = Math.hypot(cardW, cardH);
        const period = Math.max(80, Math.round(diag * 0.24));
        const dx = Math.cos(rad) * period;
        const dy = Math.sin(rad) * period;

        hCtx.save();
        hCtx.globalCompositeOperation = op;
        hCtx.globalAlpha = alpha;
        // Draw parallel diagonal metallic bands across the card
        hCtx.translate(cardW / 2, cardH / 2);
        hCtx.rotate(rad);
        const span = diag * 1.2;
        const shiftPx = ((phaseOffset % period) + period) % period;
        for (let x = -span + shiftPx - period; x < span + period; x += period) {
          const bGrad = hCtx.createLinearGradient(x, 0, x + period, 0);
          bGrad.addColorStop(0.0, '#0e152e');
          bGrad.addColorStop(0.24, '#8fa3a3');
          bGrad.addColorStop(0.29, '#c7e3e3');
          bGrad.addColorStop(0.34, '#8fa3a3');
          bGrad.addColorStop(0.65, '#0e152e');
          bGrad.addColorStop(1.0, '#0e152e');
          hCtx.fillStyle = bGrad;
          hCtx.fillRect(x, -span, period + 1, span * 2);
        }
        hCtx.restore();
        void dx;
        void dy;
      };

      const diagShift = ((px - 50) + (py - 50) * 0.25) * (cardW * 0.0085);
      drawDiagonalShimmer(opt.angle || 128.5, diagShift, 'hard-light', 0.85);
      // Counter-moving :after metallic shimmer pass (soft exclusion shimmer)
      drawDiagonalShimmer(opt.angle || 128.5, -diagShift * 0.8, 'screen', 0.28);

      // Crosshatch for Radiant Rare
      if (ph.isCross && crossPat) {
        hCtx.globalCompositeOperation = 'overlay';
        hCtx.globalAlpha = 0.55;
        hCtx.fillStyle = crossPat;
        hCtx.fillRect(0, 0, cardW, cardH);
        hCtx.globalAlpha = 1;
      }

      // Optional Foil texture (only when user uploaded custom foil OR preset actually renders one in this state)
      const tex = ph.foilImg ?? ph.presetPatImg;
      if (tex && tex.complete && tex.naturalWidth > 0) {
        hCtx.globalCompositeOperation = 'soft-light';
        hCtx.globalAlpha = ph.foilImg ? 0.48 : 0.34;
        if (ph.tilePreset && !ph.foilImg) {
          drawTiledTexture(hCtx, tex, cardW, cardH, 0.33);
        } else {
          hCtx.drawImage(tex, 0, 0, cardW, cardH);
        }
        hCtx.globalAlpha = 1;
      }

      // Radial light falloff centered at pointer (matches CSS radial-gradient + brightness(0.5 + pointerFromCenter * 0.4))
      hCtx.globalCompositeOperation = 'multiply';
      const vig = hCtx.createRadialGradient(gx, gy, cardW * 0.06, gx, gy, cardW * 1.05);
      vig.addColorStop(0, 'rgba(255,255,255,1)');
      vig.addColorStop(0.45, 'rgba(175,175,175,1)');
      vig.addColorStop(1, 'rgba(65,65,65,1)');
      hCtx.fillStyle = vig;
      hCtx.fillRect(0, 0, cardW, cardH);
      hCtx.globalCompositeOperation = 'source-over';
    }

    // Clip to layer mask
    if (ph.maskCv) {
      hCtx.globalCompositeOperation = 'destination-in';
      hCtx.drawImage(ph.maskCv, 0, 0);
    }
    hCtx.restore();

    // Composite Shine onto front card
    fCtx.save();
    fCtx.globalCompositeOperation = opt.blendMode === 'auto' ? 'color-dodge' : (opt.blendMode as GlobalCompositeOperation);
    const baseAlpha = ph.isVertical ? 0.88 : 0.72;
    fCtx.globalAlpha = Math.min(1, baseAlpha * opt.shineIntensity);
    const br = (ph.isVertical ? 1.1 : 0.55 + distFromCenter * 0.38) * opt.brightness;
    const ct = (ph.isVertical ? 1.1 : 1.55) * opt.contrast;
    const sa = (ph.isVertical ? 1.2 : 0.82) * opt.saturation;
    fCtx.filter = `brightness(${br.toFixed(2)}) contrast(${ct.toFixed(2)}) saturate(${sa.toFixed(2)})`;
    fCtx.drawImage(holoLayerCv, 0, 0);
    fCtx.restore();

    // Glare spot clipped to the same Holo mask (matches app.css .card--holo-layer.masked .card__glare)
    if (opt.glareIntensity > 0.01) {
      hCtx.clearRect(0, 0, cardW, cardH);
      hCtx.save();
      const glare = hCtx.createRadialGradient(gx, gy, 14, gx, gy, cardW * 0.85);
      glare.addColorStop(0, `rgba(255,255,255,${Math.min(0.6, 0.32 * opt.glareIntensity)})`);
      glare.addColorStop(0.35, `rgba(255,255,255,${Math.min(0.26, 0.11 * opt.glareIntensity)})`);
      glare.addColorStop(1, 'rgba(0,0,0,0)');
      hCtx.fillStyle = glare;
      hCtx.fillRect(0, 0, cardW, cardH);
      if (ph.maskCv) {
        hCtx.globalCompositeOperation = 'destination-in';
        hCtx.drawImage(ph.maskCv, 0, 0);
      }
      hCtx.restore();
      fCtx.save();
      fCtx.globalCompositeOperation = 'overlay';
      fCtx.drawImage(holoLayerCv, 0, 0);
      fCtx.restore();
    }
  }
}

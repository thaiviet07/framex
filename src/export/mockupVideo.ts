import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { Frame, HoloLayer, Project, Side } from '../model/types';
import type { TechRenderer } from '../render/TechRenderer';
import type { CardState } from '../card/HoloCard';
import { STYLES } from '../card/styles';

export interface VideoHoloLayer {
  layer: HoloLayer;
  mask: { data: Uint8Array; w: number; h: number } | null;
  foilImg: HTMLImageElement | null;
}

export interface MockupVideoInput {
  project: Project;
  frame: Frame;
  sideArt: Record<Side, { data: Uint8ClampedArray; w: number; h: number } | null>;
  frontTech: TechRenderer;
  backTech: TechRenderer;
  frontCanvas: HTMLCanvasElement;
  backCanvas: HTMLCanvasElement;
  holoLayers: VideoHoloLayer[];
  restoreState: CardState;
  onProgress?: (pct: number) => void;
}

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const DURATION_SEC = 10;
const LOOPS = 2;
const TOTAL_FRAMES = FPS * DURATION_SEC; // 300 frames (150 frames per loop x 2 loops)

/**
 * Draw card with smooth 3D perspective foreshortening (rotateY = rxDeg, rotateX = ryDeg)
 * using 80 vertical perspective strips for razor-sharp Full HD 1080p edges.
 */
function drawCard3D(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  cx: number,
  cy: number,
  w: number,
  h: number,
  rxDeg: number,
  ryDeg: number,
) {
  const rx = (rxDeg * Math.PI) / 180;
  const ry = (ryDeg * Math.PI) / 180;
  const cosX = Math.cos(rx);
  const sinX = Math.sin(rx);
  const cosY = Math.cos(ry);
  const sinY = Math.sin(ry);

  // Soft dynamic cast shadow shifted opposite to tilt
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.52)';
  ctx.filter = 'blur(26px)';
  ctx.fillRect(cx - (w * cosX) / 2 - sinX * 58, cy - (h * cosY) / 2 + 34 + sinY * 42, w * cosX, h * cosY);
  ctx.restore();

  const strips = 80;
  const persp = 1550;
  const sw = src.width / strips;

  for (let i = 0; i < strips; i++) {
    const t0 = i / strips - 0.5;
    const t1 = (i + 1) / strips - 0.5;
    const x3d0 = t0 * w * cosX;
    const z3d0 = t0 * w * sinX;
    const x3d1 = t1 * w * cosX;
    const z3d1 = t1 * w * sinX;

    const s0 = persp / (persp - z3d0);
    const s1 = persp / (persp - z3d1);

    const px0 = cx + x3d0 * s0;
    const px1 = cx + x3d1 * s1;
    const stripW = Math.max(1, px1 - px0 + 0.85);

    const midS = (s0 + s1) * 0.5;
    const stripH = h * cosY * midS;
    const yShift = (t0 + t1) * 0.5 * w * sinX * sinY * 0.36;
    const py = cy - stripH / 2 + yShift;

    ctx.drawImage(src, i * sw, 0, sw, src.height, px0, py, stripW, stripH);
  }
}

function makeArtCanvas(art: { data: Uint8ClampedArray; w: number; h: number } | null, frame: Frame, tw: number, th: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = tw;
  out.height = th;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#25282c';
  ctx.fillRect(0, 0, tw, th);
  if (!art) return out;
  const tmp = document.createElement('canvas');
  tmp.width = art.w;
  tmp.height = art.h;
  tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(art.data), art.w, art.h), 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tmp, frame.trim.x, frame.trim.y, frame.trim.w, frame.trim.h, 0, 0, tw, th);
  return out;
}

function makeMaskCanvas(mask: { data: Uint8Array; w: number; h: number } | null, frame: Frame, tw: number, th: number): HTMLCanvasElement | null {
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
  out.getContext('2d')!.drawImage(tmp, frame.trim.x, frame.trim.y, frame.trim.w, frame.trim.h, 0, 0, tw, th);
  return out;
}

/**
 * Clean, smooth natural orbit tilt (matching the 3D preview's auto-rotation).
 */
function tiltForPhase(u: number) {
  const th = u * Math.PI * 2;
  const rx = 20 * Math.cos(th); // smooth -20° .. +20° horizontal tilt
  const ry = 10 * Math.sin(th); // gentle -10° .. +10° vertical tilt
  const px = Math.max(6, Math.min(94, 50 - rx * 2.1));
  const py = Math.max(6, Math.min(94, 50 + ry * 2.6));
  return { rx, ry, px, py };
}

async function pickH264Config(): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  // Prefer Main/Baseline + realtime latencyMode so macOS VideoToolbox never stalls on B-frame flush()
  const codecs = ['avc1.4d0028', 'avc1.420028', 'avc1.640028'];
  for (const codec of codecs) {
    const cfg: VideoEncoderConfig = {
      codec,
      width: WIDTH,
      height: HEIGHT,
      bitrate: 8_000_000,
      framerate: FPS,
      latencyMode: 'realtime',
      avc: { format: 'avc' },
    };
    try {
      const sup = await VideoEncoder.isConfigSupported(cfg);
      if (sup.supported) return cfg;
    } catch {
      // try next profile
    }
  }
  return null;
}

/**
 * Generate a Full HD 1920x1080, 10s (2 seamless loops), 30fps H.264 MP4 lighting proof
 * showing both FRONT (Holo + Finishes) and BACK (Printing Techniques).
 */
export async function generateMockupMp4(inp: MockupVideoInput): Promise<{ blob: Blob; ext: 'mp4' | 'webm' }> {
  const { project: p, frame, sideArt, frontTech, backTech, frontCanvas, backCanvas, holoLayers, restoreState, onProgress } = inp;

  const aspect = p.specs.widthMm / p.specs.heightMm;
  const cardH = 800;
  const cardW = Math.round(cardH * aspect);

  // Temporarily boost WebGL canvases to Full HD card resolution for razor-sharp finishes
  const prevFW = frontCanvas.width, prevFH = frontCanvas.height;
  const prevBW = backCanvas.width, prevBH = backCanvas.height;
  frontCanvas.width = cardW;
  frontCanvas.height = cardH;
  backCanvas.width = cardW;
  backCanvas.height = cardH;

  const frontArtCv = makeArtCanvas(sideArt.front, frame, cardW, cardH);
  const backArtCv = makeArtCanvas(sideArt.back, frame, cardW, cardH);

  const frontComp = document.createElement('canvas');
  frontComp.width = cardW;
  frontComp.height = cardH;
  const fCtx = frontComp.getContext('2d')!;

  const holoLayerCv = document.createElement('canvas');
  holoLayerCv.width = cardW;
  holoLayerCv.height = cardH;
  const hCtx = holoLayerCv.getContext('2d')!;

  const backComp = document.createElement('canvas');
  backComp.width = cardW;
  backComp.height = cardH;
  const bCtx = backComp.getContext('2d')!;

  const stageCv = document.createElement('canvas');
  stageCv.width = WIDTH;
  stageCv.height = HEIGHT;
  const sCtx = stageCv.getContext('2d')!;

  // Pre-build crosshatch tile
  const crossTile = document.createElement('canvas');
  crossTile.width = 14;
  crossTile.height = 14;
  const crCtx = crossTile.getContext('2d')!;
  crCtx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  crCtx.lineWidth = 1.6;
  crCtx.beginPath();
  crCtx.moveTo(0, 0); crCtx.lineTo(14, 14);
  crCtx.moveTo(14, 0); crCtx.lineTo(0, 14);
  crCtx.stroke();
  const crossPat = hCtx.createPattern(crossTile, 'repeat');

  // Pre-build per-Holo-layer mask canvases, scanline patterns & preset textures
  const preparedHolos = await Promise.all(
    (p.holo.enabled ? holoLayers : []).map(async (item) => {
      const hl = item.layer;
      const stObj = STYLES.find((s) => s.id === hl.styleId);
      const isVertical = /regular-holo|tg-holo|reverse-holo|v$/.test(hl.styleId);
      const isCross = /radiant/.test(hl.styleId);
      const maskCv = hl.masking.scope !== 'none' ? makeMaskCanvas(item.mask, frame, cardW, cardH) : null;

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

      let presetPatImg: HTMLImageElement | null = null;
      if (!isVertical && !isCross && stObj?.patterns[0]) {
        presetPatImg = await new Promise<HTMLImageElement | null>((resolve) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.onerror = () => resolve(null);
          im.src = stObj.patterns[0];
        });
      }

      return { hl, isVertical, isCross, maskCv, scanlinePat, presetPatImg, foilImg: item.foilImg, label: stObj?.label ?? hl.styleId };
    }),
  );

  const presetLabel = preparedHolos.length ? preparedHolos.map((x) => x.label).join(' + ') : 'No Holo';
  const backPlates = p.layers.filter((l) => l.side === 'back' && l.visible && l.masks.length > 0).map((l) => l.name);
  const backLabel = backPlates.length ? backPlates.join(' + ') : 'Standard Print';

  const renderFrame = (frameIdx: number) => {
    const loopIdx = Math.floor((frameIdx * LOOPS) / TOTAL_FRAMES) + 1;
    const u = ((frameIdx * LOOPS) / TOTAL_FRAMES) % 1;
    const { rx, ry, px, py } = tiltForPhase(u);
    const state: CardState = { rx, ry, px, py, o: 1, facing: 1 };

    // 1. Live WebGL printing techniques at Full HD resolution
    frontTech.render(state, false);
    backTech.render(state, true);

    // 2. FRONT composite (Artwork + ALL visible Holo Layers + Front WebGL finishes)
    fCtx.clearRect(0, 0, cardW, cardH);
    fCtx.drawImage(frontArtCv, 0, 0);

    for (const ph of preparedHolos) {
      const opt = ph.hl.optical;
      hCtx.clearRect(0, 0, cardW, cardH);
      hCtx.save();

      const ang = ((ph.isVertical ? 110 : opt.angle) * Math.PI) / 180;
      const dx = Math.cos(ang) * cardW * 1.1;
      const dy = Math.sin(ang) * cardH * 1.1;
      const shift = ((px - 50) / 50) * 0.55 + ((py - 50) / 50) * 0.42;
      const grad = hCtx.createLinearGradient(cardW / 2 - dx, cardH / 2 - dy, cardW / 2 + dx, cardH / 2 + dy);
      const stops = 14;
      for (let s = 0; s <= stops; s++) {
        const pos = s / stops;
        const hue = (((pos * 360 * (10 / Math.max(2, opt.space)) + shift * 240 + opt.hue) % 360) + 360) % 360;
        grad.addColorStop(pos, `hsla(${hue}, ${Math.round(88 * opt.saturation)}%, 58%, 0.78)`);
      }
      hCtx.fillStyle = grad;
      hCtx.fillRect(0, 0, cardW, cardH);

      if (ph.isVertical) {
        if (ph.scanlinePat) {
          hCtx.globalCompositeOperation = 'overlay';
          hCtx.fillStyle = ph.scanlinePat;
          hCtx.fillRect(0, 0, cardW, cardH);
        }
        hCtx.globalCompositeOperation = 'screen';
        const drawVerticalBeams = (offsetPx: number, period: number, alpha: number) => {
          const bGrad = hCtx.createLinearGradient(offsetPx, 0, offsetPx + period, 0);
          bGrad.addColorStop(0.0, 'rgba(0,0,0,0)');
          bGrad.addColorStop(0.18, 'rgba(0,0,0,0)');
          bGrad.addColorStop(0.24, `rgba(255,255,255,${alpha})`);
          bGrad.addColorStop(0.28, 'rgba(0,0,0,0)');
          bGrad.addColorStop(0.34, `rgba(255,255,255,${alpha * 0.85})`);
          bGrad.addColorStop(0.42, 'rgba(0,0,0,0)');
          bGrad.addColorStop(1.0, 'rgba(0,0,0,0)');
          hCtx.fillStyle = bGrad;
          for (let bx = -period * 2; bx < cardW + period * 2; bx += period) {
            hCtx.save();
            hCtx.translate(bx, 0);
            hCtx.fillRect(offsetPx, 0, period, cardH);
            hCtx.restore();
          }
        };
        drawVerticalBeams(((50 - px) * 3.8) % 240, 240, 0.55);
        drawVerticalBeams(((px - 50) * 2.4) % 180, 180, 0.45);
        hCtx.globalCompositeOperation = 'source-over';
      } else if (ph.isCross && crossPat) {
        hCtx.globalCompositeOperation = 'overlay';
        hCtx.fillStyle = crossPat;
        hCtx.fillRect(0, 0, cardW, cardH);
        hCtx.globalCompositeOperation = 'source-over';
      } else {
        const tex = ph.foilImg && ph.foilImg.complete && ph.foilImg.naturalWidth > 0 ? ph.foilImg : ph.presetPatImg;
        if (tex && tex.complete && tex.naturalWidth > 0) {
          hCtx.globalCompositeOperation = 'multiply';
          hCtx.globalAlpha = 0.72;
          hCtx.drawImage(tex, 0, 0, cardW, cardH);
          hCtx.globalCompositeOperation = 'source-over';
          hCtx.globalAlpha = 1;
        }
      }

      if (ph.maskCv) {
        hCtx.globalCompositeOperation = 'destination-in';
        hCtx.drawImage(ph.maskCv, 0, 0);
      }
      hCtx.restore();

      fCtx.save();
      fCtx.globalCompositeOperation = opt.blendMode === 'auto' ? 'color-dodge' : (opt.blendMode as GlobalCompositeOperation);
      const baseAlpha = ph.isVertical ? 0.92 : 0.62;
      fCtx.globalAlpha = Math.min(1, baseAlpha * opt.shineIntensity);
      if (ph.isVertical || opt.brightness !== 1 || opt.contrast !== 1) {
        const br = (ph.isVertical ? 1.1 : 1) * opt.brightness;
        const ct = (ph.isVertical ? 1.1 : 1) * opt.contrast;
        const sa = (ph.isVertical ? 1.2 : 1) * opt.saturation;
        fCtx.filter = `brightness(${br.toFixed(2)}) contrast(${ct.toFixed(2)}) saturate(${sa.toFixed(2)})`;
      }
      fCtx.drawImage(holoLayerCv, 0, 0);
      fCtx.restore();

      // Glare spot strictly clipped to the same Holo mask so outside areas are untouched
      if (opt.glareIntensity > 0) {
        const gx = (px / 100) * cardW;
        const gy = (py / 100) * cardH;
        hCtx.clearRect(0, 0, cardW, cardH);
        hCtx.save();
        const glare = hCtx.createRadialGradient(gx, gy, 14, gx, gy, cardW * 0.85);
        glare.addColorStop(0, `rgba(255,255,255,${Math.min(0.65, 0.35 * opt.glareIntensity)})`);
        glare.addColorStop(0.35, `rgba(255,255,255,${Math.min(0.3, 0.12 * opt.glareIntensity)})`);
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

    fCtx.drawImage(frontCanvas, 0, 0, cardW, cardH);

    // 3. BACK composite
    bCtx.clearRect(0, 0, cardW, cardH);
    bCtx.drawImage(backArtCv, 0, 0);
    bCtx.drawImage(backCanvas, 0, 0, cardW, cardH);

    // 4. Full HD 1920x1080 Studio Frame
    const bgGrad = sCtx.createRadialGradient(WIDTH * 0.5, HEIGHT * 0.48, 80, WIDTH * 0.5, HEIGHT * 0.5, WIDTH * 0.65);
    bgGrad.addColorStop(0, '#272a2f');
    bgGrad.addColorStop(1, '#141619');
    sCtx.fillStyle = bgGrad;
    sCtx.fillRect(0, 0, WIDTH, HEIGHT);

    // Top studio header
    sCtx.fillStyle = '#aeb4bc';
    sCtx.font = '600 22px system-ui, -apple-system, sans-serif';
    sCtx.textAlign = 'left';
    sCtx.fillText(`FRAMIGOSX HOLO STUDIO — 3D LIGHTING PROOF (1080p)  |  ${p.name}`, 48, 52);

    sCtx.textAlign = 'right';
    sCtx.fillStyle = '#7e8690';
    sCtx.font = '500 20px ui-monospace, SFMono-Regular, Menlo, monospace';
    sCtx.fillText(
      `Loop ${Math.min(LOOPS, loopIdx)}/${LOOPS}  •  Tilt X:${rx >= 0 ? '+' : ''}${rx.toFixed(1)}°  Y:${ry >= 0 ? '+' : ''}${ry.toFixed(1)}°`,
      WIDTH - 48,
      52,
    );

    // Subtle divider line
    sCtx.fillStyle = 'rgba(255,255,255,0.08)';
    sCtx.fillRect(48, 70, WIDTH - 96, 1);

    // Draw Front & Back in 3D perspective
    drawCard3D(sCtx, frontComp, WIDTH * 0.28, HEIGHT * 0.515, cardW, cardH, rx, ry);
    drawCard3D(sCtx, backComp, WIDTH * 0.72, HEIGHT * 0.515, cardW, cardH, rx, ry);

    // Bottom labels
    sCtx.fillStyle = '#e0e4e8';
    sCtx.font = '600 22px system-ui, -apple-system, sans-serif';
    sCtx.textAlign = 'center';
    sCtx.fillText(`FRONT  •  ${presetLabel}`, WIDTH * 0.28, HEIGHT - 42);
    sCtx.fillText(`BACK  •  ${backLabel}`, WIDTH * 0.72, HEIGHT - 42);
  };

  try {
    const h264Config = await pickH264Config();
    if (h264Config) {
      const target = new ArrayBufferTarget();
      const muxer = new Muxer({
        target,
        video: { codec: 'avc', width: WIDTH, height: HEIGHT },
        fastStart: 'in-memory',
      });

      let encError: Error | null = null;
      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (err) => { encError = err instanceof Error ? err : new Error(String(err)); },
      });
      encoder.configure(h264Config);

      const frameDurationUs = Math.round(1_000_000 / FPS);
      for (let i = 0; i < TOTAL_FRAMES; i++) {
        if (encError) throw encError;

        // Proper backpressure drain so VideoToolbox queue never overflows
        let waits = 0;
        while (encoder.encodeQueueSize > 3 && waits < 120) {
          await new Promise((r) => setTimeout(r, 8));
          waits++;
        }

        renderFrame(i);
        const vf = new VideoFrame(stageCv, {
          timestamp: i * frameDurationUs,
          duration: frameDurationUs,
        });
        encoder.encode(vf, { keyFrame: i % 30 === 0 });
        vf.close();

        if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0));
        onProgress?.(Math.round(((i + 1) / TOTAL_FRAMES) * 95));
      }

      onProgress?.(97);
      // Guard flush() with a timeout so it can never hang indefinitely
      await Promise.race([
        encoder.flush(),
        new Promise<void>((resolve) => setTimeout(resolve, 6000)),
      ]);
      try { encoder.close(); } catch { /* ignore */ }
      if (encError) throw encError;
      onProgress?.(99);
      muxer.finalize();
      onProgress?.(100);
      return { blob: new Blob([target.buffer], { type: 'video/mp4' }), ext: 'mp4' };
    }

    // Graceful fallback if WebCodecs VideoEncoder is unavailable
    const mime = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm;codecs=vp9';
    const stream = stageCv.captureStream(FPS);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise<Blob>((resolve) => { rec.onstop = () => resolve(new Blob(chunks, { type: mime })); });
    rec.start();
    for (let i = 0; i < TOTAL_FRAMES; i++) {
      renderFrame(i);
      onProgress?.(Math.round(((i + 1) / TOTAL_FRAMES) * 98));
      await new Promise((r) => setTimeout(r, Math.round(1000 / FPS)));
    }
    rec.stop();
    const blob = await done;
    onProgress?.(100);
    return { blob, ext: mime.includes('mp4') ? 'mp4' : 'webm' };
  } finally {
    // Always restore live WebGL canvas sizes & card state
    frontCanvas.width = prevFW;
    frontCanvas.height = prevFH;
    backCanvas.width = prevBW;
    backCanvas.height = prevBH;
    frontTech.render(restoreState, false);
    backTech.render(restoreState, true);
  }
}

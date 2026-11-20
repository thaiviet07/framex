import type { Frame, Project, Side } from '../model/types';
import { assets } from '../model/assets';
import { docSizeMm, frameForHeight, MM_PER_IN, resolveFit } from '../model/units';
import { imaging } from '../imaging/client';
import { TECHS } from '../model/techniques';
import { getLang } from '../i18n/i18n';

export type Severity = 'ok' | 'warn' | 'error';

export interface PreflightIssue {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Always-English strings for production spec outputs */
  titleEn: string;
  detailEn: string;
  side?: Side;
  /** box in preview frame coordinates (height = 900) */
  box?: { x: number; y: number; w: number; h: number };
}

export const PREFLIGHT_HEIGHT = 900;

export async function runPreflight(p: Project): Promise<PreflightIssue[]> {
  const issues: PreflightIssue[] = [];
  const specs = p.specs;
  const frame: Frame = frameForHeight(specs, PREFLIGHT_HEIGHT);
  const docMm = docSizeMm(specs);
  const safePx = Math.round(specs.safeMm * frame.ppmm);
  const safeBox = {
    x: frame.trim.x + safePx,
    y: frame.trim.y + safePx,
    w: Math.max(1, frame.trim.w - safePx * 2),
    h: Math.max(1, frame.trim.h - safePx * 2),
  };

  let seq = 0;
  const isEn = getLang() === 'en';
  const add = (
    severity: Severity,
    titleVi: string,
    detailVi: string,
    titleEn: string,
    detailEn: string,
    side?: Side,
    box?: PreflightIssue['box'],
  ) =>
    issues.push({
      id: `pf_${++seq}`,
      severity,
      title: isEn ? titleEn : titleVi,
      detail: isEn ? detailEn : detailVi,
      titleEn,
      detailEn,
      side,
      box,
    });

  // 1. Artwork checks for Front & Back
  for (const side of ['front', 'back'] as Side[]) {
    const labelVi = side === 'front' ? 'Mặt trước' : 'Mặt sau';
    const labelEn = side === 'front' ? 'Front' : 'Back';
    const sd = p.sides[side];
    const meta = assets.meta(sd.artworkId);
    if (!meta || !sd.artworkId) {
      add(
        'error',
        `${labelVi}: Thiếu artwork`,
        'Chưa tải ảnh artwork cho mặt này.',
        `${labelEn}: Missing artwork`,
        'No artwork image has been uploaded for this side.',
        side,
      );
      continue;
    }

    const fit = resolveFit(sd.fit, meta.width, meta.height, specs);
    const targetW = fit === 'bleed' ? docMm.w : specs.widthMm;
    const targetH = fit === 'bleed' ? docMm.h : specs.heightMm;
    const effDpi = Math.round(Math.min(meta.width / (targetW / MM_PER_IN), meta.height / (targetH / MM_PER_IN)));
    if (effDpi < 150) {
      add(
        'error',
        `${labelVi}: Độ phân giải quá thấp (${effDpi} DPI)`,
        `Yêu cầu tối thiểu ${specs.dpi} DPI (ảnh hiện tại ${meta.width}×${meta.height} px).`,
        `${labelEn}: Critically low resolution (${effDpi} DPI)`,
        `Minimum ${specs.dpi} DPI required (current image ${meta.width}x${meta.height} px).`,
        side,
      );
    } else if (effDpi < specs.dpi) {
      add(
        'warn',
        `${labelVi}: Độ phân giải dưới chuẩn (${effDpi} DPI)`,
        `Khuyến nghị tối thiểu ${specs.dpi} DPI để in sắc nét (ảnh ${meta.width}×${meta.height} px).`,
        `${labelEn}: Below target resolution (${effDpi} DPI)`,
        `Recommended minimum ${specs.dpi} DPI for sharp print output (${meta.width}x${meta.height} px).`,
        side,
      );
    }

    if (specs.bleedMm > 0) {
      if (fit === 'trim') {
        add(
          'warn',
          `${labelVi}: Artwork chỉ phủ vùng Trim`,
          `Chưa phủ vùng bleed ${specs.bleedMm} mm — có nguy cơ hở viền trắng khi cắt.`,
          `${labelEn}: Artwork fits Trim box only`,
          `Does not extend into the ${specs.bleedMm} mm bleed zone — risk of white edges after die-cutting.`,
          side,
          { x: 0, y: 0, w: frame.w, h: frame.h },
        );
      } else {
        const stats = await imaging.artworkStats({ assetId: sd.artworkId, fit }, frame);
        if (stats.bleedFill < 0.96) {
          add(
            'warn',
            `${labelVi}: Vùng bleed còn khoảng trong suốt`,
            `Độ phủ bleed chỉ đạt ${Math.round(stats.bleedFill * 100)}%. Nên kéo nền tràn ra hết vùng bleed.`,
            `${labelEn}: Incomplete bleed coverage`,
            `Bleed ring coverage is only ${Math.round(stats.bleedFill * 100)}%. Extend background artwork to full bleed.`,
            side,
            { x: 0, y: 0, w: frame.w, h: frame.h },
          );
        }
      }
    }
  }

  // 2. Layer / Plate checks
  for (const side of ['front', 'back'] as Side[]) {
    const labelVi = side === 'front' ? 'Mặt trước' : 'Mặt sau';
    const labelEn = side === 'front' ? 'Front' : 'Back';
    const sideLayers = p.layers.filter((l) => l.side === side && l.visible);

    for (const l of sideLayers) {
      const def = TECHS[l.kind];
      if (!l.masks.length) {
        add(
          'warn',
          `${labelVi} • ${l.name}: Chưa gán mask`,
          `Layer ${def.short} chưa có mask nên bản in sẽ trống.`,
          `${labelEn} • ${l.name}: No mask assigned`,
          `${def.short} layer has no mask assigned and will output an empty plate.`,
          side,
        );
        continue;
      }

      const spec = imaging.layerSpec(p, l);
      const isFoil = l.kind === 'foil-hot' || l.kind === 'foil-cold';
      const isRelief = l.kind === 'emboss' || l.kind === 'deboss';
      const minMm = isRelief ? specs.minEmbossLineMm : isFoil ? specs.minFoilLineMm : 0;
      const thinPx = minMm > 0 ? Math.max(1, Math.round((minMm * frame.ppmm) / 2)) : 0;

      const res = await imaging.analyze(spec, frame, thinPx, safeBox);
      if (res.coverage < 0.0001) {
        add(
          'warn',
          `${labelVi} • ${l.name}: Bản in trống`,
          'Mask sau khi xử lý không có điểm ảnh nào đạt ngưỡng in.',
          `${labelEn} • ${l.name}: Empty plate`,
          'Processed mask contains no printable pixels.',
          side,
        );
        continue;
      }

      if (minMm > 0 && res.thinFrac > 0.03 && res.thinBox) {
        add(
          'warn',
          `${labelVi} • ${l.name}: Có nét mảnh hơn ${minMm} mm`,
          `Khoảng ${(res.thinFrac * 100).toFixed(1)}% vùng ${def.short} có chi tiết mảnh dưới ${minMm} mm — có thể bị đứt nét khi sản xuất.`,
          `${labelEn} • ${l.name}: Features thinner than ${minMm} mm`,
          `Approx. ${(res.thinFrac * 100).toFixed(1)}% of ${def.short} area is thinner than ${minMm} mm and may break up in production.`,
          side,
          res.thinBox,
        );
      }

      if ((isRelief || l.kind === 'foil-hot') && res.outsideFrac > 0.005 && res.outsideBox) {
        add(
          'warn',
          `${labelVi} • ${l.name}: Nằm sát mép cắt (ngoài Safe Zone)`,
          `${def.short} chạm vùng ngoài Safe Zone (${specs.safeMm} mm) — dễ bong/nứt mép khi bế thẻ.`,
          `${labelEn} • ${l.name}: Extends outside Safe Zone`,
          `${def.short} extends beyond the ${specs.safeMm} mm safe zone — may crack or peel along trim edge.`,
          side,
          res.outsideBox,
        );
      }
    }

    // Emboss vs Deboss overlap conflict
    const embosses = sideLayers.filter((l) => l.kind === 'emboss' && l.masks.length);
    const debosses = sideLayers.filter((l) => l.kind === 'deboss' && l.masks.length);
    for (const e of embosses) {
      for (const d of debosses) {
        const ov = await imaging.overlap(imaging.layerSpec(p, e), imaging.layerSpec(p, d), frame);
        if (ov.frac > 0.001 && ov.bbox) {
          add(
            'error',
            `${labelVi}: Xung đột Emboss & Deboss`,
            `"${e.name}" và "${d.name}" chồng nhau ${(ov.frac * 100).toFixed(2)}% diện tích — không thể vừa dập nổi vừa dập chìm cùng vị trí.`,
            `${labelEn}: Emboss & Deboss overlap conflict`,
            `"${e.name}" and "${d.name}" overlap on ${(ov.frac * 100).toFixed(2)}% of card area — cannot emboss and deboss the same region.`,
            side,
            ov.bbox,
          );
        }
      }
    }
  }

  if (!issues.length) {
    add(
      'ok',
      'Tất cả kiểm tra đều đạt chuẩn',
      'Artwork, vùng bleed, safe zone và các bản in đều hợp lệ, sẵn sàng xuất file sản xuất.',
      'All preflight checks passed',
      'Artwork, bleed coverage, safe zones, and finishing plates passed all checks.',
    );
  }

  return issues;
}

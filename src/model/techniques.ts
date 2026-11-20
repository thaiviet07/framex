import type { HoloConfig, HoloLayer, HoloMasking, HoloOptical, Layer, MaskAsset, Specs, TechKind } from './types';
import { uid } from '../core/math';

export interface ParamDef {
  key: string;
  label: string;
  type: 'range' | 'select' | 'color';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  hint?: string;
}

export interface TechDef {
  kind: TechKind;
  label: string;
  short: string;
  /** colour used in separation preview */
  view: string;
  /** spot colour name used in the PDF / plate filename */
  spot: (l: Layer) => string;
  /** CMYK alternate for the spot colour (0..1) */
  cmyk: (l: Layer) => [number, number, number, number];
  description: string;
  params: ParamDef[];
  defaults: Record<string, number | string>;
}

export const FOIL_COLORS: { value: string; label: string; rgb: [number, number, number]; cmyk: [number, number, number, number] }[] = [
  { value: 'gold', label: 'Gold', rgb: [0.95, 0.76, 0.35], cmyk: [0, 0.2, 0.6, 0.2] },
  { value: 'silver', label: 'Silver', rgb: [0.86, 0.88, 0.9], cmyk: [0, 0, 0, 0.3] },
  { value: 'rose', label: 'Rose gold', rgb: [0.93, 0.66, 0.6], cmyk: [0, 0.35, 0.3, 0.1] },
  { value: 'copper', label: 'Copper', rgb: [0.85, 0.5, 0.32], cmyk: [0, 0.5, 0.7, 0.2] },
  { value: 'holo', label: 'Holographic', rgb: [0.85, 0.85, 0.95], cmyk: [0.2, 0, 0, 0.1] },
  { value: 'rainbow', label: 'Rainbow', rgb: [0.9, 0.8, 0.9], cmyk: [0.1, 0.1, 0, 0.1] },
  { value: 'black', label: 'Black gloss', rgb: [0.12, 0.12, 0.14], cmyk: [0.6, 0.5, 0.4, 1] },
];

export const foilColor = (v: string | number | undefined) => FOIL_COLORS.find((f) => f.value === v) ?? FOIL_COLORS[0];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const TECHS: Record<TechKind, TechDef> = {
  'foil-hot': {
    kind: 'foil-hot',
    label: 'Hot foil (ép kim nóng)',
    short: 'Hot foil',
    view: '#e0b23c',
    spot: (l) => `HotFoil_${cap(String(l.params.color))}`,
    cmyk: (l) => foilColor(l.params.color).cmyk,
    description: 'Lá kim loại ép nhiệt phủ lên trên mực in. Vùng foil thay thế hoàn toàn màu in bên dưới.',
    params: [
      { key: 'color', label: 'Màu foil', type: 'select', options: FOIL_COLORS.map((f) => ({ value: f.value, label: f.label })) },
      { key: 'roughness', label: 'Độ nhám', type: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'brightness', label: 'Độ sáng', type: 'range', min: 0.3, max: 1.6, step: 0.01 },
    ],
    defaults: { color: 'gold', roughness: 0.25, brightness: 1 },
  },
  'foil-cold': {
    kind: 'foil-cold',
    label: 'Cold foil (ép kim lạnh, in đè màu)',
    short: 'Cold foil',
    view: '#b7c4cf',
    spot: () => 'ColdFoil',
    cmyk: () => [0, 0, 0, 0.3],
    description: 'Foil bạc nền được in đè mực CMYK lên trên — tạo màu kim loại theo artwork.',
    params: [
      { key: 'overprint', label: 'Mức in đè màu', type: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'roughness', label: 'Độ nhám', type: 'range', min: 0, max: 1, step: 0.01 },
    ],
    defaults: { overprint: 0.85, roughness: 0.3 },
  },
  'spot-uv': {
    kind: 'spot-uv',
    label: 'Spot UV (bóng cục bộ)',
    short: 'Spot UV',
    view: '#4fb3ff',
    spot: () => 'SpotUV',
    cmyk: () => [0.5, 0, 0, 0],
    description: 'Lớp UV bóng phủ cục bộ. Raised UV tạo độ dày nổi nhẹ.',
    params: [
      { key: 'gloss', label: 'Độ bóng', type: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'raised', label: 'Độ dày (raised UV)', type: 'range', min: 0, max: 100, step: 1, unit: 'µm' },
    ],
    defaults: { gloss: 0.8, raised: 20 },
  },
  'varnish-matte': {
    kind: 'varnish-matte',
    label: 'Matte / Soft-touch varnish',
    short: 'Matte',
    view: '#9a8cff',
    spot: () => 'MatteVarnish',
    cmyk: () => [0.3, 0.3, 0, 0],
    description: 'Phủ mờ cục bộ, giảm phản xạ — tương phản tốt với spot UV.',
    params: [{ key: 'strength', label: 'Cường độ', type: 'range', min: 0, max: 1, step: 0.01 }],
    defaults: { strength: 0.6 },
  },
  emboss: {
    kind: 'emboss',
    label: 'Emboss (dập nổi)',
    short: 'Emboss',
    view: '#ff7a45',
    spot: () => 'Emboss',
    cmyk: () => [0, 0.5, 1, 0],
    description: 'Dập nổi bằng khuôn đực/cái. Plate xuất ra là bản đồ độ cao (đen = cao nhất).',
    params: [
      { key: 'depth', label: 'Độ sâu', type: 'range', min: 0.05, max: 0.6, step: 0.01, unit: 'mm' },
      { key: 'bevelMm', label: 'Bevel (độ vát)', type: 'range', min: 0, max: 1.5, step: 0.05, unit: 'mm' },
      { key: 'profile', label: 'Kiểu khuôn', type: 'select', options: [
        { value: 'single', label: 'Single level' },
        { value: 'multi', label: 'Multi level (theo grayscale)' },
        { value: 'sculpted', label: 'Sculpted' },
      ] },
    ],
    defaults: { depth: 0.25, bevelMm: 0.35, profile: 'single' },
  },
  deboss: {
    kind: 'deboss',
    label: 'Deboss (dập chìm)',
    short: 'Deboss',
    view: '#c2410c',
    spot: () => 'Deboss',
    cmyk: () => [0, 0.8, 1, 0.2],
    description: 'Dập chìm vào bề mặt thẻ. Plate xuất ra là bản đồ độ sâu (đen = sâu nhất).',
    params: [
      { key: 'depth', label: 'Độ sâu', type: 'range', min: 0.05, max: 0.6, step: 0.01, unit: 'mm' },
      { key: 'bevelMm', label: 'Bevel (độ vát)', type: 'range', min: 0, max: 1.5, step: 0.05, unit: 'mm' },
      { key: 'profile', label: 'Kiểu khuôn', type: 'select', options: [
        { value: 'single', label: 'Single level' },
        { value: 'multi', label: 'Multi level (theo grayscale)' },
      ] },
    ],
    defaults: { depth: 0.2, bevelMm: 0.25, profile: 'single' },
  },
  texture: {
    kind: 'texture',
    label: 'Texture (vân bề mặt)',
    short: 'Texture',
    view: '#22c55e',
    spot: (l) => `Texture_${cap(String(l.params.pattern))}`,
    cmyk: () => [0.6, 0, 0.8, 0],
    description: 'Vân nổi vi mô bằng UV/varnish: sandpaper, linen, etched, carbon…',
    params: [
      { key: 'pattern', label: 'Mẫu vân', type: 'select', options: [
        { value: 'sandpaper', label: 'Sandpaper' },
        { value: 'linen', label: 'Linen' },
        { value: 'etched', label: 'Etched lines' },
        { value: 'carbon', label: 'Carbon' },
        { value: 'dots', label: 'Dots' },
      ] },
      { key: 'scale', label: 'Tỉ lệ vân', type: 'range', min: 0.2, max: 4, step: 0.05 },
      { key: 'strength', label: 'Cường độ', type: 'range', min: 0, max: 1, step: 0.01 },
    ],
    defaults: { pattern: 'sandpaper', scale: 1, strength: 0.6 },
  },
  'white-ink': {
    kind: 'white-ink',
    label: 'White ink / Underbase',
    short: 'White',
    view: '#f5f5f5',
    spot: () => 'White',
    cmyk: () => [0.15, 0, 0, 0],
    description: 'Mực trắng lót dưới CMYK khi in lên nền metallic/clear. Vùng không có mực trắng sẽ ánh kim (substrate metallic).',
    params: [{ key: 'density', label: 'Độ phủ', type: 'range', min: 0, max: 1, step: 0.01 }],
    defaults: { density: 1 },
  },
};

export const TECH_ORDER: TechKind[] = ['white-ink', 'foil-cold', 'foil-hot', 'spot-uv', 'varnish-matte', 'texture', 'emboss', 'deboss'];

export function defaultSpecs(): Specs {
  return {
    preset: 'tcg-standard',
    widthMm: 63.5,
    heightMm: 88.9,
    bleedMm: 3,
    safeMm: 3,
    cornerMm: 0,
    dpi: 300,
    plateDpi: 600,
    unit: 'mm',
    substrate: 'white',
    minFoilLineMm: 0.15,
    minEmbossLineMm: 0.5,
  };
}

export function newMask(partial: Partial<MaskAsset> = {}): MaskAsset {
  return {
    id: uid('mask'),
    name: 'Mask',
    sourceId: null,
    mode: 'luminance',
    fit: 'auto',
    color: '#ffffff',
    tolerance: 20,
    softness: 10,
    invert: false,
    levelsLow: 0,
    levelsHigh: 255,
    threshold: null,
    featherMm: 0,
    chokeMm: 0,
    ...partial,
  };
}

export function newLayer(kind: TechKind, side: Layer['side'], maskId: string | null): Layer {
  const def = TECHS[kind];
  return {
    id: uid('layer'),
    side,
    kind,
    name: def.short,
    visible: true,
    locked: false,
    opacity: 1,
    masks: maskId ? [{ maskId, op: 'add' }] : [],
    invert: false,
    chokeMm: 0,
    params: { ...def.defaults },
  };
}

export function defaultHoloOptical(): HoloOptical {
  return {
    shineIntensity: 1,
    glareIntensity: 1,
    angle: 133,
    space: 5,
    scanlineMm: 0.7,
    glitterSize: 25,
    hue: 0,
    saturation: 1,
    brightness: 1,
    contrast: 1,
    blendMode: 'auto',
  };
}

export function defaultHoloMasking(): HoloMasking {
  return {
    scope: 'all',
    invert: false,
    chokeMm: 0,
    featherMm: 0,
    previewOverlay: false,
    exportAsPlate: true,
  };
}

export function newHoloLayer(
  styleId: string,
  maskId: string | null,
  foilId: string | null = null,
  name = 'Holo Layer',
): HoloLayer {
  return {
    id: uid('holo'),
    name,
    visible: true,
    locked: false,
    styleId,
    masks: maskId ? [{ maskId, op: 'add' }] : [],
    foilId,
    optical: defaultHoloOptical(),
    masking: defaultHoloMasking(),
  };
}

export function defaultHoloConfig(styleId: string, maskId: string | null, foilId: string | null): HoloConfig {
  return {
    enabled: true,
    layers: [newHoloLayer(styleId, maskId, foilId, 'Holo 1')],
    interaction: {
      mode: 'pointer-auto',
      autoPattern: 'orbit',
      amp: 13,
      freq: 0.35,
      sensitivity: 1,
      stiffness: 0.066,
      damping: 0.25,
      parallax: 1,
      restingGlow: 0,
      invertTilt: false,
      manualX: 12,
      manualY: -8,
      manualLightX: 35,
      manualLightY: 35,
    },
  };
}

/** Upgrade any older single-layer HoloConfig cleanly into multi-layer `layers[]`. */
export function normalizeHolo(h: Partial<HoloConfig> | undefined, fallbackStyle: string): HoloConfig {
  const base = defaultHoloConfig(h?.styleId ?? fallbackStyle, h?.maskId ?? null, h?.foilId ?? null);
  let layers: HoloLayer[];
  if (Array.isArray(h?.layers) && h.layers.length > 0) {
    layers = h.layers.map((l, idx) => ({
      id: l.id || uid('holo'),
      name: l.name || `Holo ${idx + 1}`,
      visible: l.visible ?? true,
      locked: l.locked ?? false,
      styleId: l.styleId || fallbackStyle,
      masks: Array.isArray(l.masks) ? l.masks : [],
      foilId: l.foilId ?? null,
      optical: { ...defaultHoloOptical(), ...(l.optical ?? {}) },
      masking: { ...defaultHoloMasking(), ...(l.masking ?? {}) },
    }));
  } else {
    const masks = Array.isArray(h?.masks) ? h.masks : h?.maskId ? [{ maskId: h.maskId, op: 'add' as const }] : [];
    layers = [
      {
        id: uid('holo'),
        name: 'Holo 1',
        visible: true,
        locked: false,
        styleId: h?.styleId ?? fallbackStyle,
        masks,
        foilId: h?.foilId ?? null,
        optical: { ...defaultHoloOptical(), ...(h?.optical ?? {}) },
        masking: { ...defaultHoloMasking(), ...(h?.masking ?? {}) },
      },
    ];
  }
  return {
    enabled: h?.enabled ?? base.enabled,
    layers,
    interaction: { ...base.interaction, ...(h?.interaction ?? {}) },
  };
}

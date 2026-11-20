export type Side = 'front' | 'back';
export type Unit = 'mm' | 'in' | 'px';
export type Substrate = 'white' | 'metallic';
export type Fit = 'auto' | 'bleed' | 'trim';

export interface Specs {
  preset: string;
  widthMm: number;
  heightMm: number;
  bleedMm: number;
  safeMm: number;
  cornerMm: number;
  dpi: number;
  plateDpi: number;
  unit: Unit;
  substrate: Substrate;
  /** preflight thresholds */
  minFoilLineMm: number;
  minEmbossLineMm: number;
}

export type TechKind =
  | 'foil-hot'
  | 'foil-cold'
  | 'spot-uv'
  | 'varnish-matte'
  | 'emboss'
  | 'deboss'
  | 'texture'
  | 'white-ink';

export type MaskOpKind = 'add' | 'subtract' | 'intersect' | 'xor';
export type MaskMode = 'luminance' | 'alpha' | 'color' | 'solid';

export interface MaskRef {
  maskId: string;
  op: MaskOpKind;
}

export interface MaskAsset {
  id: string;
  name: string;
  /** asset id of the source image (null for `solid`) */
  sourceId: string | null;
  mode: MaskMode;
  fit: Fit;
  color: string;
  tolerance: number; // 0..100
  softness: number; // 0..100
  invert: boolean;
  levelsLow: number; // 0..255
  levelsHigh: number; // 0..255
  threshold: number | null; // 0..255
  featherMm: number;
  chokeMm: number; // negative = choke (shrink), positive = spread (grow)
}

export interface Layer {
  id: string;
  side: Side;
  kind: TechKind;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..1
  masks: MaskRef[];
  invert: boolean;
  chokeMm: number;
  params: Record<string, number | string>;
}

export interface SideData {
  artworkId: string | null;
  fit: Fit;
}

export type HoloInteractionMode = 'pointer-auto' | 'pointer' | 'auto' | 'manual';
export type HoloAutoPattern = 'orbit' | 'figure8' | 'sweep-x' | 'sweep-y';
export type HoloMaskScope = 'shine' | 'shine-glare' | 'all' | 'none';
export type HoloBlendMode = 'auto' | 'color-dodge' | 'screen' | 'overlay' | 'hard-light' | 'soft-light' | 'lighten' | 'plus-lighter';

export interface HoloOptical {
  shineIntensity: number;  // 0..2 (default 1)
  glareIntensity: number;  // 0..2 (default 1)
  angle: number;           // 0..360 deg (default 133)
  space: number;           // 1..15 % (default 5)
  scanlineMm: number;      // 0.2..2.5 mm (default 0.70 — shared 1:1 across preview, MP4 & plate export)
  glitterSize: number;     // 10..100 % (default 25)
  hue: number;             // -180..180 deg (default 0)
  saturation: number;      // 0..2.5 (default 1)
  brightness: number;      // 0.4..2 (default 1)
  contrast: number;        // 0.5..2 (default 1)
  blendMode: HoloBlendMode;
}

export interface HoloInteraction {
  mode: HoloInteractionMode;
  autoPattern: HoloAutoPattern;
  amp: number;             // 3..30 deg (default 13)
  freq: number;            // 0.05..1.5 Hz (default 0.35)
  sensitivity: number;     // 0.3..2.5 (default 1)
  stiffness: number;       // 0.02..0.3 (default 0.066)
  damping: number;         // 0.1..0.8 (default 0.25)
  parallax: number;        // 0..2 (default 1)
  restingGlow: number;     // 0..1 (default 0)
  invertTilt: boolean;
  manualX: number;         // -35..35 deg
  manualY: number;         // -35..35 deg
  manualLightX: number;    // 0..100 %
  manualLightY: number;    // 0..100 %
}

export interface HoloMasking {
  scope: HoloMaskScope;
  invert: boolean;
  chokeMm: number;         // -1..1 mm
  featherMm: number;       // 0..2 mm
  previewOverlay: boolean;
  exportAsPlate: boolean;
}

export interface HoloLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  styleId: string;
  masks: MaskRef[];
  foilId: string | null;
  optical: HoloOptical;
  masking: HoloMasking;
}

export interface HoloConfig {
  enabled: boolean;
  /** Multiple independent Holo layers, each with its own preset, optical settings, and mask stack */
  layers: HoloLayer[];
  interaction: HoloInteraction;
  /** legacy single-layer fields kept optional for backward-compatible migration */
  styleId?: string;
  maskId?: string | null;
  masks?: MaskRef[];
  foilId?: string | null;
  optical?: HoloOptical;
  masking?: HoloMasking;
}

export interface EnvConfig {
  preset: string;
  customAssetId: string | null;
  rotation: number;      // 0..360 deg
  exposure: number;      // 0.3..2.5 (default 1)
  temperature: number;   // -100..100 (default 0)
  elevation: number;     // -45..45 deg (default 15)
  showBackdrop: boolean;
  backdropBlur: number;  // 0..40 px (default 18)
  backdropDim: number;   // 0..1 (default 0.45)
}

export interface Project {
  version: 2;
  name: string;
  specs: Specs;
  sides: Record<Side, SideData>;
  holo: HoloConfig;
  env?: EnvConfig;
  masks: MaskAsset[];
  layers: Layer[];
}

export interface AssetMeta {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
}

export interface Asset extends AssetMeta {
  blob: Blob;
}

/** Physical layout of a side in pixels for a given resolution. */
export interface Frame {
  /** full document (bleed box) size in px */
  w: number;
  h: number;
  /** trim box inside the frame */
  trim: { x: number; y: number; w: number; h: number };
  /** pixels per mm */
  ppmm: number;
}

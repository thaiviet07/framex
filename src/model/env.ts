import type { EnvConfig } from './types';

export interface EnvPreset {
  id: string;
  labelVi: string;
  labelEn: string;
  descVi: string;
  descEn: string;
  /** CSS gradient preview for preset swatch */
  preview: string;
  /** base sky/floor colors + studio light boxes for procedural equirectangular HDRI map */
  sky: [string, string, string];
  lights: { x: number; y: number; rx: number; ry: number; color: string; intensity: number }[];
  defaultExposure?: number;
  defaultTemp?: number;
}

export const ENV_PRESETS: EnvPreset[] = [
  {
    id: 'studio-neutral',
    labelVi: 'Studio Chuẩn (Neutral)',
    labelEn: 'Neutral Studio',
    descVi: 'Softbox trắng cân bằng 5500K, ánh sáng đều chuẩn studio.',
    descEn: 'Balanced 5500K white softboxes for clean studio inspection.',
    preview: 'linear-gradient(135deg, #2a2d32 0%, #6c727a 48%, #e8ecf0 55%, #1d2024 100%)',
    sky: ['#26292e', '#1a1c20', '#121316'],
    lights: [
      { x: 0.28, y: 0.26, rx: 0.16, ry: 0.11, color: '#ffffff', intensity: 1.0 },
      { x: 0.72, y: 0.30, rx: 0.14, ry: 0.14, color: '#e6f0ff', intensity: 0.85 },
      { x: 0.50, y: 0.12, rx: 0.25, ry: 0.06, color: '#ffffff', intensity: 0.7 },
    ],
  },
  {
    id: 'print-d50',
    labelVi: 'Buồng soi in D50 (ISO)',
    labelEn: 'Print Booth D50 (ISO)',
    descVi: 'Ánh sáng chuẩn 5000K phòng kiểm màu nhà in.',
    descEn: 'ISO 3664 5000K viewing booth for color & foil QC.',
    preview: 'linear-gradient(135deg, #525456 0%, #c8c6be 50%, #f5f2e8 60%, #444648 100%)',
    sky: ['#5c5d5e', '#47484a', '#353638'],
    lights: [
      { x: 0.50, y: 0.18, rx: 0.36, ry: 0.12, color: '#fffaf0', intensity: 1.0 },
      { x: 0.22, y: 0.42, rx: 0.15, ry: 0.15, color: '#f7f4ea', intensity: 0.65 },
      { x: 0.78, y: 0.42, rx: 0.15, ry: 0.15, color: '#f7f4ea', intensity: 0.65 },
    ],
  },
  {
    id: 'warm-gallery',
    labelVi: 'Gallery Vàng Ấm',
    labelEn: 'Warm Gallery',
    descVi: 'Đèn spotlight ấm 3200K — tôn cực mạnh Hot Foil Vàng & Emboss.',
    descEn: '3200K museum spotlights that accentuate Gold Foil & Emboss.',
    preview: 'linear-gradient(135deg, #241810 0%, #8f5624 45%, #ffd996 58%, #1a120d 100%)',
    sky: ['#2c1d13', '#1d140e', '#110c08'],
    lights: [
      { x: 0.32, y: 0.24, rx: 0.14, ry: 0.12, color: '#ffd48a', intensity: 1.0 },
      { x: 0.68, y: 0.35, rx: 0.11, ry: 0.16, color: '#ffad5c', intensity: 0.85 },
      { x: 0.50, y: 0.72, rx: 0.22, ry: 0.08, color: '#ffb870', intensity: 0.4 },
    ],
    defaultTemp: 18,
  },
  {
    id: 'cool-daylight',
    labelVi: 'Showroom Ánh Sáng Trời',
    labelEn: 'Cool Daylight Showroom',
    descVi: 'Ánh sáng 6500K trong trẻo — soi sắc nét Silver Foil & Spot UV.',
    descEn: 'Crisp 6500K daylight ideal for Silver Foil & Spot UV.',
    preview: 'linear-gradient(135deg, #1a2736 0%, #5c8ab5 46%, #d9f0ff 56%, #18212b 100%)',
    sky: ['#2a3f57', '#1e2c3b', '#141b24'],
    lights: [
      { x: 0.25, y: 0.22, rx: 0.22, ry: 0.14, color: '#d8f1ff', intensity: 1.0 },
      { x: 0.75, y: 0.28, rx: 0.18, ry: 0.12, color: '#ffffff', intensity: 0.9 },
      { x: 0.50, y: 0.55, rx: 0.30, ry: 0.05, color: '#9ed4ff', intensity: 0.45 },
    ],
    defaultTemp: -15,
  },
  {
    id: 'neon-arena',
    labelVi: 'Esports Neon Arena',
    labelEn: 'Esports Neon Arena',
    descVi: 'Đèn rim Cyan + Magenta kiểu sân khấu esports / sự kiện.',
    descEn: 'Dual-tone Cyan & Magenta arena rim lighting for live event vibe.',
    preview: 'linear-gradient(135deg, #0b1628 0%, #00d2ff 36%, #ff2e93 66%, #14081f 100%)',
    sky: ['#11162a', '#160d24', '#090912'],
    lights: [
      { x: 0.20, y: 0.35, rx: 0.12, ry: 0.26, color: '#00e5ff', intensity: 1.0 },
      { x: 0.80, y: 0.35, rx: 0.12, ry: 0.26, color: '#ff2b8a', intensity: 1.0 },
      { x: 0.50, y: 0.16, rx: 0.20, ry: 0.06, color: '#ffffff', intensity: 0.85 },
    ],
  },
  {
    id: 'sunset-gold',
    labelVi: 'Hoàng Hôn (Golden Hour)',
    labelEn: 'Golden Sunset',
    descVi: 'Ánh cam rực + bóng chàm sâu đầy chiều sâu.',
    descEn: 'Warm amber horizon light with deep indigo ambient shadows.',
    preview: 'linear-gradient(135deg, #1b1636 0%, #9c3d46 42%, #ff9d42 62%, #1a1224 100%)',
    sky: ['#261d4a', '#7c3448', '#1c1426'],
    lights: [
      { x: 0.35, y: 0.42, rx: 0.20, ry: 0.12, color: '#ff9638', intensity: 1.0 },
      { x: 0.65, y: 0.24, rx: 0.16, ry: 0.10, color: '#ffd08a', intensity: 0.8 },
      { x: 0.82, y: 0.52, rx: 0.14, ry: 0.10, color: '#6b5cff', intensity: 0.6 },
    ],
  },
  {
    id: 'darkroom-rim',
    labelVi: 'Phòng Tối High-Contrast',
    labelEn: 'Darkroom High-Contrast',
    descVi: 'Nền đen tuyền + dải sáng gắt để soi rõ Spot UV & Emboss.',
    descEn: 'Pitch-black studio with sharp strip lights for UV & Emboss bevels.',
    preview: 'linear-gradient(135deg, #050506 0%, #141417 44%, #ffffff 50%, #050506 58%)',
    sky: ['#08080a', '#050507', '#020203'],
    lights: [
      { x: 0.30, y: 0.30, rx: 0.05, ry: 0.30, color: '#ffffff', intensity: 1.0 },
      { x: 0.72, y: 0.28, rx: 0.04, ry: 0.26, color: '#dceeff', intensity: 0.95 },
      { x: 0.50, y: 0.10, rx: 0.22, ry: 0.03, color: '#ffffff', intensity: 0.85 },
    ],
    defaultExposure: 1.25,
  },
];

export function defaultEnvConfig(): EnvConfig {
  return {
    preset: 'studio-neutral',
    customAssetId: null,
    rotation: 0,
    exposure: 1,
    temperature: 0,
    elevation: 15,
    showBackdrop: true,
    backdropBlur: 22,
    backdropDim: 0.38,
  };
}

export function normalizeEnv(e: Partial<EnvConfig> | undefined): EnvConfig {
  return { ...defaultEnvConfig(), ...(e ?? {}) };
}

/**
 * Render a lush procedural equirectangular HDRI panorama (512x256) onto a canvas
 * for WebGL environment reflections & optional blurred stage backdrop.
 */
export function renderEnvCanvas(presetId: string, width = 512, height = 256): HTMLCanvasElement {
  const preset = ENV_PRESETS.find((p) => p.id === presetId) ?? ENV_PRESETS[0];
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d')!;

  // Vertical sky-to-floor equirectangular gradient
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, preset.sky[0]);
  bg.addColorStop(0.52, preset.sky[1]);
  bg.addColorStop(1, preset.sky[2]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Additive studio softboxes / rim lights (wrapped seamlessly at x=0 and x=width)
  ctx.globalCompositeOperation = 'screen';
  for (const l of preset.lights) {
    for (const wrap of [-1, 0, 1]) {
      const cx = (l.x + wrap) * width;
      const cy = l.y * height;
      const rx = l.rx * width;
      const ry = l.ry * height;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(rx, ry);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, l.color);
      g.addColorStop(0.45, l.color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = l.intensity;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  return cv;
}

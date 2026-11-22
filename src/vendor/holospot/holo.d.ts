// holospot: public types. See AGENTS.md for how to use them.
import type * as THREE from "three";

export type MaterialId = "prism" | "shatter" | "nebula" | "sparkle" | "vortex" | "volume" | "emboss";
export declare const MATERIAL_IDS: readonly MaterialId[];

/** A parameter value: a number, a switch, a choice or colour (string), or a 2D pad `{ x, y }`. */
export type ParamValue = number | boolean | string | { x: number; y: number } | Record<string, unknown>;

/** One of holo.spot's shipped looks, or `plain` (the bare parameter defaults). */
export type LookId = "card" | "object" | "image" | "cloth" | "stickers" | "flag" | "plain";
export declare const LOOK_IDS: readonly LookId[];

export interface View { az: number; el: number; zoom: number; offset: readonly [number, number, number] }
export interface Pose { rx: number; ry: number; rz: number; flip: boolean }

/** What the `</>` (Copy settings) button of holo.spot's Object tab puts on the clipboard. */
export interface CopyBlob {
  holoDev: 1;
  entity: Exclude<LookId, "plain">;
  material: string;
  values: Record<string, ParamValue>;
  view?: View;
  pose?: Pose;
  assets?: Record<string, string>;
}
/** Settings: a Copy settings blob, or a flat map of parameter ids to values (`{ "prism.pitch": 1200 }`). */
export type SettingsInput = CopyBlob | Readonly<Record<string, ParamValue>> | null | undefined;

export interface ParamInfo {
  id: string;
  /** slider, toggle, select, color, pad, image or text. */
  kind: string;
  default: ParamValue;
  min?: number; max?: number; step?: number;
  options?: string[];
  unit: string;
  meaning: string;
}
/** Every scene-level parameter: lights (`studio.*`), `display.*`, `grain.*`, `bump.*`, `dof.*`, `card.*`, `scene.*`. */
export declare const SCENE_PARAMS: readonly ParamInfo[];
/** Every parameter of each material. */
export declare const MATERIAL_PARAMS: Readonly<Record<MaterialId, readonly ParamInfo[]>>;
/** holo.spot's lighting presets, by the value of `studio.preset`. */
export declare const STUDIO_PRESETS: Readonly<Record<string, Readonly<Record<string, ParamValue>>>>;

export interface Resolved {
  look: LookId; material: MaterialId;
  scene: Record<string, ParamValue>;
  values: Record<string, ParamValue>;
  view: View; pose: Pose;
  unknown: string[];
  assets: Record<string, string>;
}
/** Resolves a look as the kit does: parameter defaults, then what holo.spot ships, then `settings`. */
export declare function resolveSettings(o: { material?: string; look?: LookId; settings?: SettingsInput }): Resolved;
export declare function lookInfo(look: LookId): { title: string; material: MaterialId; quality: "low" | "medium" | "high"; materials: MaterialId[] };

export type Quality = "auto" | "low" | "medium" | "high";
export type Compose = "auto" | "replace" | "over";

export interface HoloOptions {
  /** Rendering quality. Default: what holo.spot ships for the first look you apply (`low` for a 3D object). */
  quality?: Quality;
  /** URL of the kit's `assets/` folder. Default: next to `dist/`. */
  assets?: string;
  /** Scene-level settings (lights, exposure, grain, background …). */
  settings?: SettingsInput;
  /** `auto` (default): `replace` when the scene holds only holographic objects, else `over`. */
  compose?: Compose;
  /** `camera` (default): the light rig travels with your camera. `world`: it stands still, its front toward +z. */
  lights?: "camera" | "world";
  /** The page behind the object: "black", "white" or "#rrggbb". Default: the look's (white on holo.spot). */
  background?: string;
}

export interface ApplyOptions {
  /** Default: the look's own material (Nebula for `object`). */
  material?: MaterialId;
  /** Real-world size of the object's largest side in millimetres (default 90). */
  sizeMm?: number;
  settings?: SettingsInput;
  /** Default `object` (holo.spot's 3D object); `image` for `emboss`. */
  look?: LookId;
  /** `auto` (default): the mesh's UVs when usable, else a box projection. */
  mapping?: "auto" | "uv" | "box" | "sphere";
  /** Default: open surfaces yes, closed ones no. */
  doubleSided?: boolean | null;
  /** Default 1. Above 1: smaller shards, flakes and bump tiles on the object; below 1: larger. */
  structureScale?: number;
  /** Also take the look's scene settings (lights, exposure, background). Default: true for the first object only. */
  scene?: boolean;
}

export interface CardOptions {
  material?: MaterialId;
  /** Face size in millimetres (default 63 × 88). */
  widthMm?: number;
  heightMm?: number;
  /** Length of the longer side in your scene's units (default: its real size in metres). */
  size?: number;
  settings?: SettingsInput;
  look?: LookId;
  scene?: boolean;
}

export interface RenderOptions {
  /** Frame time in seconds, for offline rendering. */
  time?: number;
  /** Seconds since the last frame, for offline rendering. */
  dt?: number;
  /** true: a still picture (no motion kernel between this frame and the last). */
  still?: boolean;
}

export declare class HoloObject {
  readonly source: THREE.Object3D;
  readonly material: MaterialId;
  readonly look: LookId;
  /** How holo.spot frames and tilts this look (see shotCamera, shotRotation). */
  readonly view: View;
  readonly pose: Pose;
  /** Resolves when the object is ready to draw. */
  ready: Promise<void>;
  /** Changes material settings, e.g. `obj.set({ "prism.pitch": 1200 })`. */
  set(values: Readonly<Record<string, ParamValue>>): void;
  /** The current value of every parameter of this object's material. */
  readonly settings: Readonly<Record<string, ParamValue>>;
  /** Stops drawing this object holographically. */
  remove(): void;
}

export declare class Holo {
  constructor(renderer: THREE.WebGLRenderer, options?: HoloOptions);
  readonly renderer: THREE.WebGLRenderer;
  /** The seven materials: name, what it imitates, caption. */
  static readonly materials: Readonly<Record<MaterialId, { name: string; analog: string; caption: string }>>;
  /** Makes a Mesh or Group of your scene holographic. */
  apply(target: THREE.Object3D, options?: ApplyOptions): HoloObject;
  /** A holographic card to add to your scene (`material: "emboss"`: the paper card with logos and stickers). */
  card(options?: CardOptions): THREE.Mesh;
  remove(target: THREE.Object3D): void;
  get(target: THREE.Object3D): HoloObject | null;
  /** Changes scene-level settings: `{ "display.ev": 0.8, "studio.preset": "softbox" }`. */
  setScene(settings: SettingsInput): void;
  readonly scene: Readonly<Record<string, ParamValue>>;
  /** Resolves when every applied object is ready to draw. */
  ready(): Promise<void>;
  /** Draws the frame. Call it instead of `renderer.render(scene, camera)`. */
  render(scene: THREE.Scene, camera: THREE.Camera, options?: RenderOptions): void;
  /** Puts `{ ready, frames, errors, info }` on `window.__holo` for automated checks. */
  expose(name?: string): void;
  readonly errors: readonly string[];
  readonly frames: number;
  readonly info: { quality: "low" | "medium" | "high" | null; hdr: boolean; dpr: number; objects: number; gpuMB: number };
  dispose(): void;
}

/** The tilt holo.spot rests a look at: `mesh.rotation.copy(shotRotation(obj.pose))`. */
export declare function shotRotation(pose: Pose): THREE.Euler;
/** Places `camera` where holo.spot places its own for `obj`: the look's lens (`dof.lens`), a distance that fits the
 *  object, and the look's orbit view. Call after `await obj.ready` and when the canvas aspect changes. */
export declare function shotCamera(camera: THREE.PerspectiveCamera, obj: HoloObject, o: { aspect: number; view?: View; lensMm?: number }): void;

export declare const VERSION: string;
/** The commit of the holo.spot source the engine was copied from. */
export declare const ENGINE_COMMIT: string;

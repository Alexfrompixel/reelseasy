/**
 * Effects and transitions.
 *
 * Two kinds of thing change the picture for a moment:
 *
 * - A treatment (glitch, VHS, black and white…) is the editor's own shader
 *   effect. It belongs to a whole clip, so for a moment it is put on a short
 *   copy of the piece underneath, laid over it on its own lane. That copy is a
 *   normal clip in the editor: it can be dragged, trimmed, deleted, and its
 *   effect changed in the inspector.
 * - Motion (whip, zoom, shake, flash, dip to black) is animation of the whole
 *   picture. It is written as timeline code on a wrapper around the camera.
 */
import type { Piece } from "./edit";

const round = (x: number) => Math.round(x * 1000) / 1000;
const n = (x: number) => String(round(x));
const clamp = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 100) / 100;

export type Grading = Record<string, unknown>;

/** A picture clip placed by the pipeline on top of the cut. */
export type Layer = {
  id: string;
  kind: "fx" | "insert";
  /** Media file relative to the reel folder; left out for the reel's own source. */
  src?: string;
  start: number;
  duration: number;
  mediaStart: number;
  /** fx: the treatment, added on top of the reel's look. */
  grading?: Grading;
  /** insert: fills the frame, or sits in a corner as a small window. */
  mode?: "cover" | "pip";
  corner?: "top-right" | "top-left";
  /** insert: 0 or left out plays it silent. */
  volume?: number;
};

export const TRANSITIONS = ["glitch", "flash", "whip", "zoom", "blur", "dip", "shake"] as const;
export type TransitionType = (typeof TRANSITIONS)[number];

/** Motion on the whole picture: at a cut, or (shake) over a stretch. */
export type Motion = { kind: TransitionType; at: number; until?: number };

/** `k` is strength: 1 is the standard amount, 2 the most. */
const TREATMENTS: Record<string, (k: number) => Grading> = {
  glitch: (k) => ({
    effects: {
      digitalGlitch: clamp(0.55 * k),
      digitalGlitchColorSplit: clamp(0.3 * k),
      digitalGlitchLineTear: clamp(0.3 * k),
      digitalGlitchPixelate: 0.15,
      digitalGlitchBlockAmount: 0.5,
      digitalGlitchBlockDisplacement: clamp(0.3 * k),
      digitalGlitchSpeed: 0.6,
    },
  }),
  rgb: (k) => ({ effects: { chromaticAberration: clamp(0.25 * k), chromaticAngle: 0 } }),
  vhs: (k) => ({
    effects: {
      tapeDamage: clamp(0.65 * k),
      tapeTracking: 0.55,
      tapeNoise: 0.25,
      tapeSpeed: 0.5,
      chromaBleed: 0.5,
      scanlines: 0.3,
      scanlineCount: 0.17,
      scanlineSoftness: 1,
    },
  }),
  crt: (k) => ({
    effects: { crtCurvature: clamp(0.2 * k), scanlines: 0.35, scanlineCount: 0.17, scanlineSoftness: 1, chromaticAberration: 0.08 },
  }),
  film: (k) => ({ effects: { filmArtifacts: clamp(0.55 * k) }, details: { grain: clamp(0.35 * k) } }),
  pixelate: (k) => ({ effects: { pixelate: clamp(0.55 * k) } }),
  blur: (k) => ({ effects: { blur: clamp(0.45 * k) } }),
  glow: (k) => ({ effects: { bloom: Math.round(Math.min(3, 0.55 * k) * 100) / 100, bloomRadius: 8 } }),
  bw: (k) => ({ adjust: { saturation: -clamp(k) } }),
  halftone: () => ({ effects: { halftone: 0.94, halftoneSize: 0.36 } }),
  ascii: () => ({ effects: { ascii: 1, asciiSize: 0.066, asciiInvert: 0, asciiStyle: 0, asciiColor: 1, asciiRotation: 0 } }),
};

const MOTION_EFFECTS = ["shake", "flash"] as const;

/** Every name `effects` in edit.json accepts. */
export const EFFECT_NAMES = [...Object.keys(TREATMENTS), ...MOTION_EFFECTS];

export const isMotionEffect = (name: string): name is "shake" | "flash" =>
  (MOTION_EFFECTS as readonly string[]).includes(name);

/**
 * The treatment for a named effect, or undefined when the name is motion
 * (shake, flash) or unknown. Strength runs 0 to 1; 0.5 is the standard amount.
 */
export function effectGrading(name: string, strength = 0.5): Grading | undefined {
  const build = TREATMENTS[name];
  return build ? build(Math.max(0, strength) * 2) : undefined;
}

const SECTIONS = ["effects", "adjust", "details"];

/** A treatment on top of the reel's look: the look stays, the effect is added. */
export function mergeGrading(look: Grading | undefined, fx: Grading | undefined): Grading {
  const out: Grading = { ...look };
  for (const [key, value] of Object.entries(fx ?? {})) {
    out[key] = SECTIONS.includes(key) ? { ...(out[key] as object | undefined), ...(value as object) } : value;
  }
  return out;
}

/**
 * Copies of whatever pieces play between `from` and `to`, one per piece, each
 * showing exactly the frames of the piece under it. They carry the treatment.
 */
export function copies(key: string, from: number, to: number, pieces: Piece[], grading: Grading): Layer[] {
  const out: Layer[] = [];
  for (const p of [...pieces].sort((a, b) => a.start - b.start)) {
    const start = round(Math.max(from, p.start));
    const end = round(Math.min(to, p.start + p.duration));
    if (end - start < 0.05) continue;
    out.push({
      id: `fx-${key}-${p.id}`,
      kind: "fx",
      ...(p.src ? { src: p.src } : {}),
      start,
      duration: round(end - start),
      mediaStart: round(p.mediaStart + (start - p.start)),
      grading,
    });
  }
  return out;
}

const DEFAULT_SOUND: Partial<Record<TransitionType, string>> = { glitch: "glitch", whip: "whoosh", zoom: "whoosh-fast" };

/** The sound a transition plays: its own default, the one asked for, or none with `false`. */
export function transitionSound(kind: TransitionType, asked: string | false | undefined): string | undefined {
  if (asked === false) return undefined;
  return asked ?? DEFAULT_SOUND[kind];
}

/** How far around a cut a glitch transition reaches. */
export const GLITCH_BEFORE = 0.17;
export const GLITCH_AFTER = 0.2;

type Props = Record<string, string | number>;
const js = (props: Props) =>
  `{ ${Object.entries(props)
    .map(([k, v]) => `${k}: ${typeof v === "number" ? n(v) : JSON.stringify(v)}`)
    .join(", ")} }`;

function tween(target: string, from: Props, to: Props, duration: number, ease: string, at: number): string {
  // Something that would start before 0 starts at 0 and runs shorter.
  const start = Math.max(0, at);
  const length = duration - (start - at);
  return `tl.fromTo("${target}", ${js(from)}, ${js({ ...to, duration: Math.max(0.01, length), ease })
    .replace(/ }$/, ", immediateRender: false }")}, ${n(start)});`;
}
const set = (target: string, props: Props, at: number) => `tl.set("${target}", ${js(props)}, ${n(Math.max(0, at))});`;

const STAGE = "#stage";
const VEIL = "#veil";
const sharp = "blur(0px)";

/** Offsets for a shake: the same every time, so a render is repeatable. */
function jitter(i: number, size: number): [number, number] {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  const y = Math.sin(i * 78.233) * 12543.1234;
  return [Math.round((x - Math.floor(x) - 0.5) * 2 * size), Math.round((y - Math.floor(y) - 0.5) * 2 * size)];
}

function motionCode(m: Motion): string[] {
  const t = m.at;
  switch (m.kind) {
    case "whip":
      return [
        tween(STAGE, { xPercent: 0, scale: 1, filter: sharp }, { xPercent: -20, scale: 1.5, filter: "blur(22px)" }, 0.15, "power2.in", t - 0.15),
        tween(STAGE, { xPercent: 20, scale: 1.5, filter: "blur(22px)" }, { xPercent: 0, scale: 1, filter: sharp }, 0.2, "power2.out", t),
        set(STAGE, { filter: "none" }, t + 0.2),
      ];
    case "zoom":
      return [
        tween(STAGE, { scale: 1, filter: sharp }, { scale: 1.8, filter: "blur(16px)" }, 0.15, "power2.in", t - 0.15),
        tween(STAGE, { scale: 1.4, filter: "blur(16px)" }, { scale: 1, filter: sharp }, 0.22, "power2.out", t),
        set(STAGE, { filter: "none" }, t + 0.22),
      ];
    case "blur":
      return [
        tween(STAGE, { scale: 1, filter: sharp }, { scale: 1.08, filter: "blur(26px)" }, 0.16, "power1.in", t - 0.16),
        tween(STAGE, { scale: 1.08, filter: "blur(26px)" }, { scale: 1, filter: sharp }, 0.2, "power1.out", t),
        set(STAGE, { filter: "none" }, t + 0.2),
      ];
    case "dip":
      return [
        tween(VEIL, { opacity: 0, backgroundColor: "#000000" }, { opacity: 1, backgroundColor: "#000000" }, 0.12, "power1.in", t - 0.12),
        tween(VEIL, { opacity: 1, backgroundColor: "#000000" }, { opacity: 0, backgroundColor: "#000000" }, 0.2, "power1.out", t),
      ];
    case "flash":
      return [
        tween(VEIL, { opacity: 0, backgroundColor: "#ffffff" }, { opacity: 0.9, backgroundColor: "#ffffff" }, 0.07, "power1.in", t - 0.07),
        tween(VEIL, { opacity: 0.9, backgroundColor: "#ffffff" }, { opacity: 0, backgroundColor: "#ffffff" }, 0.28, "power1.out", t),
      ];
    case "glitch": {
      // The tearing itself is a treatment on copies of the two pieces; this is the jolt.
      const steps: [number, number][] = [[-0.07, -16], [-0.035, 12], [0, -8], [0.035, 5]];
      return [
        ...steps.map(([dt, x]) => set(STAGE, { x, scale: 1.04 }, t + dt)),
        set(STAGE, { x: 0, scale: 1 }, t + 0.07),
      ];
    }
    case "shake": {
      const from = m.until === undefined ? t - 0.07 : t;
      const to = m.until ?? t + 0.28;
      const step = m.until === undefined ? 0.035 : 0.05;
      const lines: string[] = [];
      const count = Math.max(1, Math.round((to - from) / step));
      for (let i = 0; i < count; i++) {
        // A shake at a cut dies away; a shake over a stretch holds.
        const size = m.until === undefined ? 20 * (1 - i / count) + 2 : 10;
        const [x, y] = jitter(i + 1, size);
        lines.push(set(STAGE, { x, y, scale: 1.05 }, from + i * step));
      }
      lines.push(set(STAGE, { x: 0, y: 0, scale: 1 }, to));
      return lines;
    }
  }
}

/** The timeline code for every transition and motion effect, in time order. */
export function motionBlock(motions: Motion[]): string {
  return [...motions]
    .sort((a, b) => a.at - b.at)
    .flatMap(motionCode)
    .join("\n      ");
}

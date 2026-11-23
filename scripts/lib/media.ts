import { basename, extname } from "node:path";
import type { Range } from "./edit";

export const FPS = 30;

export type Size = { width: number; height: number };
export type ProbeStream = {
  width?: number;
  height?: number;
  color_transfer?: string;
  side_data_list?: { rotation?: number }[];
  tags?: { rotate?: string };
};

export function slugify(path: string): string {
  return basename(path, extname(path))
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseSilences(log: string, duration: number): Range[] {
  const out: Range[] = [];
  let open: number | undefined;
  for (const line of log.split("\n")) {
    const start = line.match(/silence_start:\s*(-?[\d.]+)/);
    const end = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (start) open = Math.max(0, Number(start[1]));
    if (end && open !== undefined) {
      out.push([open, Number(end[1])]);
      open = undefined;
    }
  }
  if (open !== undefined && open < duration) out.push([open, duration]);
  return out;
}

/** Size as it plays: phone clips are stored sideways with a rotation flag. */
export function displaySize(stream: ProbeStream): Size {
  const width = stream.width ?? 0;
  const height = stream.height ?? 0;
  const rotation =
    stream.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ??
    Number(stream.tags?.rotate ?? 0);
  return Math.abs(rotation) % 180 === 90 ? { width: height, height: width } : { width, height };
}

export function isHdr(stream: ProbeStream): boolean {
  return ["arib-std-b67", "smpte2084"].includes(stream.color_transfer ?? "");
}

/**
 * The working copy is 1080x1920, or 1440x2560 when the source has the pixels,
 * so a zoom of up to 1.33 stays sharp in the 1080x1920 export.
 */
export function targetSize(source: Size): Size {
  const big = Math.min(source.width, source.height) >= 1440;
  return big ? { width: 1440, height: 2560 } : { width: 1080, height: 1920 };
}

export type Level = { gain: number; limit: boolean };

/** What Reels and TikTok play at. */
export const TARGET_LUFS = -14;

/**
 * Gain in dB that brings measured speech to -14 LUFS. A phone recording is
 * often quiet on average with loud peaks; a gain that only respected the peaks
 * would leave the voice 8 or 9 dB too quiet. So the gain goes all the way, and
 * `limit` says the peaks then need holding down.
 */
export function levelGain(integrated: number, truePeak: number): Level {
  if (!Number.isFinite(integrated) || !Number.isFinite(truePeak)) return { gain: 0, limit: false };
  const gain = Math.round(Math.min(TARGET_LUFS - integrated, 24) * 10) / 10;
  return { gain, limit: truePeak + gain > -1.5 };
}

/** The ffmpeg audio filter for a level: one fixed gain, plus a peak limiter at -2 dB when needed. */
export function levelFilter(level: Level): string {
  const gain = `volume=${level.gain}dB`;
  return level.limit ? `${gain},alimiter=limit=0.794:attack=5:release=80:level=false` : gain;
}

/**
 * ffmpeg arguments for the working copy of a clip: the whole clip, uncut, as
 * 9:16 H.264 at a steady 30 fps with a keyframe every second (the editor
 * freezes on seek without that) and stereo sound. Cutting happens later, on
 * the timeline, without touching this file.
 */
export function normaliseArgs(opts: { source: string; output: string; size: Size; sound?: boolean }): string[] {
  const { width, height } = opts.size;
  // Always stereo: the renderer outputs stereo, and a mono voice measures
  // 3 dB quieter than the same voice on two channels. A clip that has no
  // sound (a screen recording, a time-lapse) gets no sound track at all.
  const audio = opts.sound === false
    ? ["-an"]
    : ["-af", "aresample=48000,aformat=channel_layouts=stereo", "-c:a", "aac", "-b:a", "192k"];
  return [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", opts.source,
    "-vf", `fps=${FPS},scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`,
    "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-g", String(FPS), "-pix_fmt", "yuv420p",
    ...audio,
    "-movflags", "+faststart",
    opts.output,
  ];
}

/**
 * Fourteen of the pack's sounds are under the Pixabay Content License, which
 * does not allow handing the files out on their own, so they are not in this
 * repository. HyperFrames ships the originals in its own package; this cuts
 * them on the user's Mac to the same stretch and the same loudness as the
 * pack was tuned with.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Where the pinned HyperFrames keeps its sounds, from the project folder. */
export const SOURCE_DIR = "node_modules/hyperframes/dist/skills/media-use/audio/assets/sfx";

/** `gain` is in dB, on the two-channel sound. */
export type Recipe = { from: string; start: number; length: number; gain: number };

/**
 * Our name for each sound, the HyperFrames file it is cut from, which part,
 * and how much louder or quieter. The numbers were measured against the pack
 * as it was first made: change one and that sound's volume in every reel changes.
 */
export const RECIPES: Record<string, Recipe> = {
  "whoosh-fast": { from: "whoosh.mp3", start: 0.061, length: 0.32, gain: -3.77 },
  "whoosh-long": { from: "whoosh-cinematic.mp3", start: 0.9676, length: 3.671, gain: -5.69 },
  typing: { from: "typing.mp3", start: 0.4325, length: 1.068, gain: 3.44 },
  "key-press": { from: "key-press.mp3", start: 0.0636, length: 0.102, gain: 3.53 },
  pop: { from: "pop.mp3", start: 0.0392, length: 0.269, gain: -2.81 },
  click: { from: "click.mp3", start: 0.038, length: 0.156, gain: -0.11 },
  ping: { from: "ping.mp3", start: 0.3128, length: 0.678, gain: -1.29 },
  chime: { from: "chime.mp3", start: 0.3647, length: 2.105, gain: 6.38 },
  notification: { from: "notification.mp3", start: 0.0761, length: 1.443, gain: -1.83 },
  sparkle: { from: "sparkle.mp3", start: 0.0151, length: 1.778, gain: -6.29 },
  impact: { from: "impact-bass-1.mp3", start: 0.0399, length: 2.047, gain: -5.55 },
  riser: { from: "riser.mp3", start: 1.068, length: 3.545, gain: -6.36 },
  error: { from: "error.mp3", start: 0.5945, length: 0.333, gain: 15.22 },
  glitch: { from: "glitch-1.mp3", start: 0.0962, length: 2.502, gain: -6.57 },
};

const round = (x: number) => Math.round(x * 1000) / 1000;

/** Cut the piece, fade its ends so a sound cut mid-wave cannot click, set its level, save it. */
export function cutArgs(source: string, recipe: Recipe, output: string): string[] {
  const out = round(Math.min(0.12, recipe.length * 0.2));
  const filter = `atrim=start=${recipe.start}:duration=${recipe.length},asetpts=PTS-STARTPTS,aformat=channel_layouts=stereo,afade=t=in:st=0:d=0.005,afade=t=out:st=${round(recipe.length - out)}:d=${out},volume=${recipe.gain}dB`;
  // The cut is a filter, so ffmpeg decodes from the beginning and cuts to the exact sample. Seeking
  // with -ss lands on an mp3 frame, up to 26 ms off, which is a quarter of the shortest sound.
  return ["-v", "error", "-y", "-i", source, "-af", filter,
    "-ar", "48000", "-ac", "2", "-c:a", "libmp3lame", "-q:a", "2", output];
}

export type PackResult = { made: string[]; kept: string[]; missing: string[] };

/**
 * Makes every sound that is not there yet (all of them with `force`).
 * `missing` lists sounds whose HyperFrames original was not found.
 */
export async function buildPack(root: string, opts: { force?: boolean; into?: string } = {}): Promise<PackResult> {
  const into = opts.into ?? join(root, "sfx");
  mkdirSync(into, { recursive: true });
  const result: PackResult = { made: [], kept: [], missing: [] };
  for (const [name, recipe] of Object.entries(RECIPES)) {
    const output = join(into, `${name}.mp3`);
    const source = join(root, SOURCE_DIR, recipe.from);
    if (existsSync(output) && !opts.force) result.kept.push(name);
    else if (!existsSync(source)) result.missing.push(name);
    else {
      const run = Bun.spawn(["ffmpeg", ...cutArgs(source, recipe, output)], { stdout: "ignore", stderr: "pipe" });
      const report = await new Response(run.stderr).text();
      if ((await run.exited) !== 0) throw new Error(`Could not make ${name}: ${report.trim().split("\n").pop() ?? "ffmpeg failed"}`);
      result.made.push(name);
    }
  }
  return result;
}

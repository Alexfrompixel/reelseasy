import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cutArgs, RECIPES, SOURCE_DIR } from "./pack";

const root = join(import.meta.dir, "..", "..");
const manifest = (await Bun.file(join(root, "sfx", "manifest.json")).json()) as Record<string, { duration: number; licence: string }>;

describe("the sounds that are made on the user's Mac", () => {
  test("are exactly the ones this repository may not hand out itself", () => {
    const notOurs = Object.entries(manifest)
      .filter(([, sound]) => sound.licence !== "CC0 1.0")
      .map(([name]) => name)
      .sort();
    expect(Object.keys(RECIPES).sort()).toEqual(notOurs);
    expect(notOurs).toHaveLength(14);
  });

  test("each is cut to the length the sound list promises", () => {
    for (const [name, recipe] of Object.entries(RECIPES)) {
      expect(Math.abs(recipe.length - manifest[name]!.duration)).toBeLessThan(0.011);
      expect(recipe.start).toBeGreaterThanOrEqual(0);
    }
  });

  test("each comes from a file the pinned HyperFrames really ships", () => {
    for (const recipe of Object.values(RECIPES)) expect(existsSync(join(root, SOURCE_DIR, recipe.from))).toBe(true);
  });
});

describe("the ffmpeg step", () => {
  const recipe = { from: "riser.mp3", start: 1.068, length: 3.545, gain: -6.36 };

  test("cuts the piece, fades its ends so it cannot click, and sets its level", () => {
    const args = cutArgs("/src/riser.mp3", recipe, "/out/riser.mp3").join(" ");
    expect(args).toContain("-i /src/riser.mp3 -af atrim=start=1.068:duration=3.545,asetpts=PTS-STARTPTS,");
    expect(args).not.toContain("-ss");
    expect(args).toMatch(/,aformat=channel_layouts=stereo,afade=t=in:st=0:d=0\.005,afade=t=out:st=3\.[0-9]+:d=0\.[0-9]+,volume=-6\.36dB/);
    expect(args).toContain("-ar 48000 -ac 2");
    expect(args.endsWith("/out/riser.mp3")).toBe(true);
  });

  test("a very short sound gets a fade that fits inside it", () => {
    const args = cutArgs("/src/key-press.mp3", { from: "key-press.mp3", start: 0.0636, length: 0.102, gain: 3.53 }, "/out/k.mp3").join(" ");
    const [, st, d] = /afade=t=out:st=([0-9.]+):d=([0-9.]+)/.exec(args)!;
    expect(Number(st) + Number(d)).toBeCloseTo(0.102, 3);
    expect(Number(d)).toBeLessThan(0.03);
  });
});

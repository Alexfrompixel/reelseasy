import { describe, expect, test } from "bun:test";
import { planCues, type SoundInfo } from "./sounds";

const pack: Record<string, SoundInfo> = {
  "whoosh-in": { file: "whoosh-in.mp3", duration: 0.62, sync: 0.48, volume: 0.4 },
  pop: { file: "pop.mp3", duration: 0.27, sync: 0, volume: 0.4 },
  "typing-long": { file: "typing-long.mp3", duration: 3.84, sync: 0, volume: 0.3 },
};

describe("planCues", () => {
  test("a hit sound starts on the moment", () => {
    const [cue] = planCues([{ at: 2, sound: "pop" }], pack, 10);
    expect(cue).toEqual({
      id: "sfx-0",
      sound: "pop",
      file: "pop.mp3",
      start: 2,
      mediaStart: 0,
      duration: 0.27,
      volume: 0.4,
    });
  });

  test("a fly-in starts early so its peak lands on the moment", () => {
    const [cue] = planCues([{ at: 5, sound: "whoosh-in" }], pack, 10);
    expect(cue!.start).toBeCloseTo(4.52);
    expect(cue!.start + pack["whoosh-in"]!.sync).toBeCloseTo(5);
  });

  test("a fly-in at the very start skips its own beginning instead of arriving late", () => {
    const [cue] = planCues([{ at: 0.2, sound: "whoosh-in" }], pack, 10);
    expect(cue!.start).toBe(0);
    expect(cue!.mediaStart).toBeCloseTo(0.28);
    expect(cue!.duration).toBeCloseTo(0.34);
  });

  test("until trims a long sound and fades it out", () => {
    const [cue] = planCues([{ at: 1, sound: "typing-long", until: 2.5 }], pack, 10);
    expect(cue!.duration).toBeCloseTo(1.5);
    expect(cue!.fadeOut).toBe(0.08);
  });

  test("nothing plays past the end of the film", () => {
    const [cue] = planCues([{ at: 8, sound: "typing-long" }], pack, 9);
    expect(cue!.start + cue!.duration).toBeLessThanOrEqual(9);
    expect(cue!.fadeOut).toBe(0.08);
    expect(planCues([{ at: 8.99, sound: "pop" }], pack, 9)).toEqual([]);
  });

  test("a per-cue volume wins over the pack default; cues come back in time order", () => {
    const cues = planCues(
      [
        { at: 6, sound: "pop", volume: 0.2 },
        { at: 1, sound: "pop" },
      ],
      pack,
      10,
    );
    expect(cues.map((c) => [c.id, c.start, c.volume])).toEqual([
      ["sfx-0", 1, 0.4],
      ["sfx-1", 6, 0.2],
    ]);
  });

  test("a keyed moment keeps the same id however the timeline changes", () => {
    const before = planCues([{ key: "emoji-w5", at: 6, sound: "pop" }, { key: "zoom-0", at: 1, sound: "pop" }], pack, 10);
    const after = planCues([{ key: "emoji-w5", at: 0.5, sound: "pop" }, { key: "zoom-0", at: 4, sound: "pop" }], pack, 10);
    expect(before.map((c) => c.id)).toEqual(["sfx-zoom-0", "sfx-emoji-w5"]);
    expect(after.map((c) => c.id)).toEqual(["sfx-emoji-w5", "sfx-zoom-0"]);
  });

  test("an unknown sound is an error that lists what exists", () => {
    expect(() => planCues([{ at: 1, sound: "swoosh" }], pack, 10)).toThrow(
      /swoosh.*whoosh-in, pop, typing-long/s,
    );
  });
});

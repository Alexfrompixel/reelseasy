import { describe, expect, test } from "bun:test";
import { copies, effectGrading, EFFECT_NAMES, mergeGrading, motionBlock, TRANSITIONS, transitionSound } from "./effects";
import type { Piece } from "./edit";

const pieces: Piece[] = [
  { id: "p1", start: 0, duration: 2, mediaStart: 1 },
  { id: "p2", start: 2, duration: 3, mediaStart: 6.5 },
  { id: "c-b", start: 5, duration: 2, mediaStart: 0, src: "assets/clips/b.mp4" },
];

describe("effectGrading", () => {
  test("every named picture effect gives a treatment the editor understands", () => {
    for (const name of EFFECT_NAMES) {
      if (name === "shake" || name === "flash") continue;
      const grading = effectGrading(name)!;
      expect(grading).toBeDefined();
      expect(Object.keys(grading).some((k) => ["effects", "adjust", "details"].includes(k))).toBe(true);
    }
  });

  test("glitch is the editor's own digital glitch, and strength scales it", () => {
    const soft = effectGrading("glitch", 0.25)!.effects as Record<string, number>;
    const hard = effectGrading("glitch", 1)!.effects as Record<string, number>;
    expect(soft.digitalGlitch).toBeGreaterThan(0);
    expect(hard.digitalGlitch).toBeGreaterThan(soft.digitalGlitch!);
    expect(hard.digitalGlitch).toBeLessThanOrEqual(1);
  });

  test("shake and flash are motion, not a treatment; an unknown name is nothing", () => {
    expect(effectGrading("shake")).toBeUndefined();
    expect(effectGrading("flash")).toBeUndefined();
    expect(effectGrading("sparkles")).toBeUndefined();
    expect(EFFECT_NAMES).toContain("vhs");
  });
});

describe("mergeGrading", () => {
  test("an effect sits on top of the reel's look without losing it", () => {
    const merged = mergeGrading(
      { preset: "warm-daylight", intensity: 0.6, effects: { bloom: 0.2 } },
      { effects: { digitalGlitch: 0.5 }, adjust: { saturation: -1 } },
    );
    expect(merged).toEqual({
      preset: "warm-daylight",
      intensity: 0.6,
      effects: { bloom: 0.2, digitalGlitch: 0.5 },
      adjust: { saturation: -1 },
    });
    expect(mergeGrading(undefined, { effects: { blur: 0.4 } })).toEqual({ effects: { blur: 0.4 } });
  });
});

describe("copies", () => {
  test("an effect range becomes one copy per piece it crosses, showing the same frames", () => {
    const layers = copies("e0", 1.5, 2.4, pieces, { effects: { blur: 0.4 } });
    expect(layers).toEqual([
      { id: "fx-e0-p1", kind: "fx", start: 1.5, duration: 0.5, mediaStart: 2.5, grading: { effects: { blur: 0.4 } } },
      { id: "fx-e0-p2", kind: "fx", start: 2, duration: 0.4, mediaStart: 6.5, grading: { effects: { blur: 0.4 } } },
    ]);
  });

  test("a copy of an imported clip plays that clip, and slivers are dropped", () => {
    const layers = copies("e1", 4.98, 5.5, pieces, {});
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ id: "fx-e1-c-b", src: "assets/clips/b.mp4", start: 5, mediaStart: 0 });
  });
});

describe("motionBlock", () => {
  test("every transition has code that ends with the picture back to normal", () => {
    for (const kind of TRANSITIONS) {
      const code = motionBlock([{ kind, at: 5 }]);
      expect(code).toMatch(/tl\.(fromTo|set)\("#(stage|veil)"/);
      // Jolts are hard sets; everything that eases must not render early.
      if (kind === "glitch" || kind === "shake") expect(code).toMatch(/tl\.set\("#stage", \{ x: 0, (y: 0, )?scale: 1 \}/);
      else expect(code).toContain("immediateRender: false");
    }
    expect(motionBlock([])).toBe("");
  });

  test("a whip smears out before the cut and lands after it", () => {
    const code = motionBlock([{ kind: "whip", at: 5 }]);
    expect(code).toMatch(/tl\.fromTo\("#stage", \{[^}]*xPercent: 0[^}]*\}, \{[^}]*blur\(22px\)[^}]*\}, 4\.85\)/);
    expect(code).toMatch(/tl\.fromTo\("#stage", \{[^}]*blur\(22px\)[^}]*\}, \{[^}]*xPercent: 0[^}]*\}, 5\)/);
    expect(code).toContain('tl.set("#stage", { filter: "none" }, 5.2)');
  });

  test("a transition at the very start never reaches before 0", () => {
    const code = motionBlock([{ kind: "dip", at: 0.05 }]);
    expect(code).not.toMatch(/, -\d/);
  });

  test("a shake over a range jitters until its end, then rests", () => {
    const code = motionBlock([{ kind: "shake", at: 2, until: 2.5 }]);
    expect(code.match(/tl\.set\("#stage"/g)!.length).toBeGreaterThan(6);
    expect(code).toContain('tl.set("#stage", { x: 0, y: 0, scale: 1 }, 2.5)');
  });
});

describe("transitionSound", () => {
  test("glitch and whip come with a sound unless told otherwise", () => {
    expect(transitionSound("glitch", undefined)).toBe("glitch");
    expect(transitionSound("whip", undefined)).toBe("whoosh");
    expect(transitionSound("dip", undefined)).toBeUndefined();
    expect(transitionSound("glitch", false)).toBeUndefined();
    expect(transitionSound("dip", "impact")).toBe("impact");
  });
});

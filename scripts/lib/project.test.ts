import { describe, expect, test } from "bun:test";
import { indexHtml, layerTag, textHash, zoomBlock } from "./compose";
import { motionBlock, type Layer } from "./effects";
import type { Piece, Resolved, Zoom } from "./edit";
import {
  addPiece, attr, captionFixes, closeHoles, droppedLayers, ensureStage, findHoles, openGap, readPieces, reflowIndex,
  releaseMoved, setAttr, withLength,
} from "./project";
import type { Cue } from "./sounds";

const pieces: Piece[] = [
  { id: "p1", start: 0, duration: 2, mediaStart: 0 },
  { id: "p2", start: 2, duration: 3, mediaStart: 6 },
];
const zooms: Zoom[] = [{ start: 2.2, end: 3.2, scale: 1.2, focus: [0.5, 0.4], type: "punch" }];
const cue = (id: string, start: number, extra: Partial<Cue> = {}): Cue => ({
  id,
  sound: "pop",
  file: "pop.mp3",
  start,
  mediaStart: 0,
  duration: 0.27,
  volume: 0.4,
  ...extra,
});
const resolved: Resolved = { duration: 5, words: [], groups: [], zooms, moments: [], layers: [], motions: [], skipped: [] };
const look = { preset: "warm-daylight", intensity: 0.8 };
const built = indexHtml(resolved, { pieces, look, cues: [cue("sfx-emoji-w5", 1), cue("sfx-zoom-0", 2.2)] });

describe("attr and setAttr", () => {
  const tag = `<video id="p1" data-start="2" data-color-grading='{"preset":"x"}' class="clip">`;

  test("read double- and single-quoted attributes", () => {
    expect(attr(tag, "data-start")).toBe("2");
    expect(attr(tag, "data-color-grading")).toBe('{"preset":"x"}');
    expect(attr(tag, "data-missing")).toBeUndefined();
  });

  test("change, add and remove an attribute without touching the rest", () => {
    expect(setAttr(tag, "data-start", "3.5")).toContain('data-start="3.5"');
    expect(setAttr(tag, "data-new", "1")).toBe(`<video id="p1" data-start="2" data-color-grading='{"preset":"x"}' class="clip" data-new="1">`);
    expect(setAttr(tag, "data-start", null)).toBe(`<video id="p1" data-color-grading='{"preset":"x"}' class="clip">`);
  });
});

describe("readPieces", () => {
  test("reads the cut back from the page", () => {
    expect(readPieces(built)).toEqual(pieces);
  });

  test("sees a piece that was dragged, trimmed and split in the editor", () => {
    // What the editor writes: new attribute order, an extra id, a split-off clip.
    const edited = built
      .replace('<video id="p2"', '<video data-hf-id="hf-ab12" id="p2"')
      .replace('data-start="2" data-duration="3" data-media-start="6"', 'data-start="0" data-duration="1.5" data-media-start="6"')
      .replace('<video id="p1"', '<video id="p2-2" class="clip" src="assets/source.mp4" data-start="1.5" data-duration="1.5" data-media-start="7.5"></video>\n<video id="p1"')
      .replace('id="p1" class="clip" src="assets/source.mp4" playsinline data-has-audio="true" data-start="0"', 'id="p1" class="clip" src="assets/source.mp4" playsinline data-has-audio="true" data-start="3"');
    expect(readPieces(edited)).toEqual([
      { id: "p2", start: 0, duration: 1.5, mediaStart: 6 },
      { id: "p2-2", start: 1.5, duration: 1.5, mediaStart: 7.5 },
      { id: "p1", start: 3, duration: 2, mediaStart: 0 },
    ]);
  });

  test("a video added by hand is a piece too, with the file it plays and whether it is silent", () => {
    const withBroll = built.replace("</div>\n      <div id=\"captions\"", '</div>\n      <video id="broll" class="clip" src="assets/clips/b.mp4" muted playsinline data-start="1" data-duration="1"></video>\n      <div id="captions"');
    expect(readPieces(withBroll)[1]).toEqual({ id: "broll", start: 1, duration: 1, mediaStart: 0, src: "assets/clips/b.mp4", muted: true });
  });

  test("an effect copy or an insert placed by the pipeline is not a piece", () => {
    const copy: Layer = { id: "fx-e0-p1", kind: "fx", start: 0.5, duration: 1, mediaStart: 0.5, grading: { effects: { blur: 0.4 } } };
    const withCopy = built.replace("</div>\n      <div id=\"captions\"", `</div>\n      ${layerTag(copy, 20)}\n      <div id="captions"`);
    expect(readPieces(withCopy).map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});

describe("reflowIndex", () => {
  const next = (html: string, over: Partial<Parameters<typeof reflowIndex>[1]> = {}) =>
    reflowIndex(html, { duration: 5, cues: [cue("sfx-emoji-w5", 1), cue("sfx-zoom-0", 2.2)], zooms: zoomBlock(zooms, 5), look, ...over });

  test("changes nothing when nothing moved", () => {
    const out = next(built);
    expect(out.html).toBe(built);
    expect(out.notes).toEqual([]);
  });

  test("updates the film length on the root and the captions host", () => {
    const out = next(built, { duration: 4.2 });
    expect(out.html).toMatch(/<div id="root"[^>]*data-duration="4.2"/);
    expect(out.html).toMatch(/<div id="captions"[^>]*data-duration="4.2"/);
  });

  test("working room makes the editor timeline longer than the reel", () => {
    const out = next(built, { duration: 4.2, room: 3 });
    expect(out.html).toMatch(/<div id="root"[^>]*data-duration="7.2"/);
    expect(out.html).toMatch(/<div id="captions"[^>]*data-duration="7.2"/);
  });

  test("an export copy is cut back to the reel itself", () => {
    const trimmed = withLength(next(built, { duration: 4.2, room: 3 }).html, 4.2);
    expect(trimmed).toMatch(/<div id="root"[^>]*data-duration="4.2"/);
    expect(trimmed).toMatch(/<div id="captions"[^>]*data-duration="4.2"/);
  });

  test("moves a sound that is still where it was put automatically", () => {
    const out = next(built, { cues: [cue("sfx-emoji-w5", 3.4), cue("sfx-zoom-0", 2.2)] });
    expect(out.html).toMatch(/<audio id="sfx-emoji-w5"[^>]*data-start="3.4"[^>]*data-reel-start="3.4"/);
  });

  test("leaves a sound alone once it was moved by hand, and stops managing it", () => {
    const moved = built.replace('id="sfx-emoji-w5" class="clip" src="assets/sfx/pop.mp3" data-start="1"', 'id="sfx-emoji-w5" class="clip" src="assets/sfx/pop.mp3" data-start="1.8"');
    const out = next(moved, { cues: [cue("sfx-emoji-w5", 3.4), cue("sfx-zoom-0", 2.2)] });
    expect(out.html).toMatch(/<audio id="sfx-emoji-w5"[^>]*data-start="1.8"/);
    expect(out.html).not.toMatch(/<audio id="sfx-emoji-w5"[^>]*data-reel-start/);
    expect(out.notes.join("\n")).toContain("sfx-emoji-w5");
  });

  test("removes an automatic sound whose moment left the reel", () => {
    const out = next(built, { cues: [cue("sfx-zoom-0", 2.2)] });
    expect(out.html).not.toContain('id="sfx-emoji-w5"');
    expect(out.html).toContain('id="sfx-zoom-0"');
  });

  test("adds a new sound, but never brings back one that was deleted by hand", () => {
    const deleted = built.replace(/\n\s*<audio id="sfx-emoji-w5"[^>]*><\/audio>/, "");
    const out = next(deleted, { cues: [cue("sfx-emoji-w5", 1), cue("sfx-zoom-0", 2.2), cue("sfx-sound-0", 4)] });
    expect(out.html).not.toContain('id="sfx-emoji-w5"');
    expect(out.html).toMatch(/<audio id="sfx-sound-0"[^>]*data-start="4"/);
    expect(out.html).toMatch(/data-reel-sfx="sfx-emoji-w5 sfx-zoom-0 sfx-sound-0"/);
  });

  test("regenerates the zooms while they are still as generated", () => {
    const moved: Zoom[] = [{ ...zooms[0]!, start: 0.3, end: 1.3 }];
    const out = next(built, { zooms: zoomBlock(moved, 5) });
    expect(out.html).toContain('tl.set("#cam", { scale: 1.2 }, 0.3)');
    expect(out.html).not.toContain('tl.set("#cam", { scale: 1.2 }, 2.2)');
    expect(out.html).toContain(`data-reel-zoom="${textHash(zoomBlock(moved, 5))}"`);
  });

  test("leaves zooms alone once their code was changed by hand", () => {
    const hand = built.replace('{ scale: 1.2 }, 2.2)', '{ scale: 1.5 }, 2.2)');
    const moved: Zoom[] = [{ ...zooms[0]!, start: 0.3, end: 1.3 }];
    const out = next(hand, { zooms: zoomBlock(moved, 5) });
    expect(out.html).toContain("{ scale: 1.5 }, 2.2)");
    expect(out.notes.join("\n")).toContain("zoom");
  });

  test("a new grade reaches pieces still on the automatic one, not a piece graded by hand", () => {
    const hand = built.replace(
      `<video id="p2" class="clip" src="assets/source.mp4" playsinline data-has-audio="true" data-start="2" data-duration="3" data-media-start="6" data-fade-in="0.03" data-fade-out="0.03" data-track-index="0" data-color-grading='{"preset":"warm-daylight","intensity":0.8}'`,
      `<video id="p2" class="clip" src="assets/source.mp4" playsinline data-has-audio="true" data-start="2" data-duration="3" data-media-start="6" data-fade-in="0.03" data-fade-out="0.03" data-track-index="0" data-color-grading='{"preset":"mono-clean","intensity":1}'`,
    );
    expect(hand).not.toBe(built);
    const out = next(hand, { look: { preset: "bright-pop", intensity: 0.5 } });
    expect(out.html).toMatch(/<video id="p1"[^>]*data-color-grading='\{"preset":"bright-pop","intensity":0.5\}'/);
    expect(out.html).toMatch(/<video id="p2"[^>]*data-color-grading='\{"preset":"mono-clean","intensity":1\}'/);
  });

  test("removing the grade clears pieces still on the automatic one", () => {
    const out = next(built, { look: undefined });
    expect(out.html).not.toContain("data-color-grading");
    expect(out.html).not.toContain("data-reel-look");
  });
});

describe("captionFixes", () => {
  const captions = `
    <span id="cap-w0" class="cap-word">MOST</span>
    <span id="cap-w1" class="cap-word cap-em">CREATORS</span>
    <span id="cap-w5-2" class="cap-word">R&amp;D</span>`;

  test("finds caption words that were retyped by hand", () => {
    const expected = new Map([
      ["w0", "MOST"],
      ["w1", "PEOPLE"],
      ["w5", "HAND"],
    ]);
    expect(captionFixes(captions, expected)).toEqual({ w1: "CREATORS", w5: "R&D" });
  });

  test("nothing retyped means no fixes", () => {
    expect(captionFixes(captions, new Map([["w0", "MOST"], ["w1", "CREATORS"], ["w5", "R&D"]]))).toEqual({});
  });
});

describe("holes in the cut", () => {
  const startOf = (html: string, id: string, from: string, to: string) =>
    html.replace(new RegExp(`(<(?:video|audio)\\b[^<>]*\\sid="${id}"[^<>]*?)\\sdata-start="${from}"`), `$1 data-start="${to}"`);
  // p1 runs 0-2. p2 was left at 3 after the piece between them was deleted.
  const holed = startOf(built, "p2", "2", "3");

  test("a reel with its pieces back to back has no holes", () => {
    expect(findHoles(built)).toEqual([]);
    expect(closeHoles(built)).toEqual({ html: built, holes: [] });
  });

  test("finds the stretch with no piece: it would be black in the export", () => {
    expect(readPieces(holed)[1]!.start).toBe(3);
    expect(findHoles(holed)).toEqual([{ after: "p1", at: 2, seconds: 1 }]);
  });

  test("closing a hole pulls later pieces and sounds forward by its length", () => {
    const closed = closeHoles(startOf(holed, "sfx-zoom-0", "2.2", "3.2"));
    expect(closed.holes).toEqual([{ after: "p1", at: 2, seconds: 1 }]);
    expect(readPieces(closed.html)).toEqual(pieces);
    const sound = closed.html.match(/<audio\b[^<>]*\sid="sfx-zoom-0"[^<>]*>/)![0];
    expect(attr(sound, "data-start")).toBe("2.2");
    // The sound before the hole stays put.
    expect(attr(closed.html.match(/<audio\b[^<>]*\sid="sfx-emoji-w5"[^<>]*>/)![0], "data-start")).toBe("1");
  });

  test("a reel that does not start at 0 has a hole at the front", () => {
    const late = startOf(startOf(built, "p1", "0", "0.5"), "p2", "2", "2.5");
    expect(findHoles(late)).toEqual([{ after: null, at: 0, seconds: 0.5 }]);
    expect(readPieces(closeHoles(late).html)).toEqual(pieces);
  });

  test("a gap filled by another picture is not a hole", () => {
    const card = holed.replace(
      /<video\b[^<>]*\sid="p2"/,
      (tag) => `<img id="card" class="clip" src="assets/card.png" data-start="2" data-duration="1" data-track-index="5">\n      ${tag}`,
    );
    expect(findHoles(card)).toEqual([]);
  });
});

describe("layers and transitions on a reel that is open in the editor", () => {
  const glitch: Layer[] = [
    { id: "fx-t-p2-p1", kind: "fx", start: 1.83, duration: 0.17, mediaStart: 1.83, grading: { effects: { digitalGlitch: 0.7 } } },
    { id: "fx-t-p2-p2", kind: "fx", start: 2, duration: 0.2, mediaStart: 6, grading: { effects: { digitalGlitch: 0.7 } } },
  ];
  const insert: Layer = { id: "ins-0", kind: "insert", src: "assets/clips/b.mp4", start: 3, duration: 1.5, mediaStart: 0, mode: "pip" };
  const motions = [{ kind: "glitch" as const, at: 2 }];
  const next = { duration: 5, cues: [], zooms: zoomBlock(zooms, 5), look };
  const full = { ...next, layers: [...glitch, insert], motion: motionBlock(motions) };
  const fresh = indexHtml({ ...resolved, layers: [...glitch, insert], motions }, { pieces, look });

  test("a freshly built reel with layers and transitions needs no changes", () => {
    const r = reflowIndex(fresh, full);
    expect(r.html).toBe(fresh);
    expect(r.notes).toEqual([]);
    expect(fresh).toMatch(/<div id="stage"[^>]*>\s*<div id="cam"/);
    expect(fresh.indexOf('id="fx-t-p2-p1"')).toBeLessThan(fresh.indexOf('id="veil"'));
    expect(fresh).toMatch(/id="ins-0"[^>]*data-track-index="2\d"[^>]*data-reel-layer="insert"/);
  });

  test("a reel built before transitions existed gets a stage, a veil and the code, once", () => {
    const old = indexHtml(resolved, { pieces, look })
      .replace(/<div id="stage"[^>]*>\s*/, "")
      .replace(/<\/div>(\s*)<\/div>(\s*)<div id="veil"[^>]*><\/div>/, "</div>$2")
      .replace(/\s*\/\* reel-motion:start \*\/[\s\S]*?\/\* reel-motion:end \*\//, "");
    expect(old).not.toContain("stage");
    expect(reflowIndex(old, next).html).toBe(old);
    const upgraded = reflowIndex(old, full);
    expect(upgraded.notes).toEqual([]);
    expect(upgraded.html).toMatch(/<div id="stage"[^>]*>\s*<div id="cam"[\s\S]*id="fx-t-p2-p2"[\s\S]*<\/div>\s*<\/div>\s*<video id="ins-0"[\s\S]*<div id="veil"[\s\S]*<div id="captions"/);
    expect(upgraded.html).toContain('tl.set("#stage", { x: -16, scale: 1.04 }, 1.93);');
    expect(readPieces(upgraded.html)).toEqual(pieces);
    expect(reflowIndex(upgraded.html, full).html).toBe(upgraded.html);
    expect(ensureStage(upgraded.html)).toBe(upgraded.html);
  });

  test("layers follow the cut, and one whose moment left the reel is removed", () => {
    const moved = { ...full, layers: [{ ...glitch[1]!, start: 2.5, mediaStart: 6.5 }, { ...insert, start: 1 }] };
    const r = reflowIndex(fresh, moved);
    expect(r.html).not.toContain('id="fx-t-p2-p1"');
    expect(r.html).toMatch(/id="fx-t-p2-p2"[^>]*data-start="2.5"[^>]*data-media-start="6.5"[^>]*data-reel-start="2.5"/);
    expect(r.html).toMatch(/id="ins-0"[^>]*data-start="1"/);
  });

  test("a layer moved or trimmed by hand is released: an insert becomes a clip of its own", () => {
    const dragged = fresh.replace(/(id="ins-0"[^>]*data-start=")3"/, '$14"').replace(/(id="fx-t-p2-p2"[^>]*data-duration=")0.2"/, '$10.5"');
    const released = releaseMoved(dragged);
    expect(released.notes).toHaveLength(2);
    expect(released.html).toMatch(/id="fx-t-p2-p2"[^>]*data-reel-layer="fx"/);
    expect(released.html).not.toMatch(/id="fx-t-p2-p2"[^>]*data-reel-start/);
    expect(released.html).not.toMatch(/id="ins-0"[^>]*data-reel-layer/);
    expect(readPieces(released.html).find((p) => p.id === "ins-0")).toMatchObject({ start: 4, src: "assets/clips/b.mp4", muted: true });
    // From here on neither is re-placed or re-added.
    const r = reflowIndex(released.html, full);
    expect(r.html).toMatch(/id="ins-0"[^>]*data-start="4"/);
    expect(r.html).toMatch(/id="fx-t-p2-p2"[^>]*data-duration="0.5"/);
    expect(r.html.match(/id="ins-0"/g)).toHaveLength(1);
    expect(releaseMoved(fresh)).toEqual({ html: fresh, notes: [] });
  });

  test("a layer deleted by hand stays deleted and is reported as dropped", () => {
    const without = fresh.replace(/\n\s*<video id="ins-0"[^>]*><\/video>/, "");
    expect(droppedLayers(without)).toEqual(["ins-0"]);
    expect(reflowIndex(without, full).html).not.toContain('id="ins-0"');
    expect(droppedLayers(fresh)).toEqual([]);
  });

  test("an effect copy takes a new look with it unless its effect was changed by hand", () => {
    const cool = { preset: "clean-studio" };
    const tuned = fresh.replace(/(id="fx-t-p2-p1"[^>]*data-color-grading=')[^']*'/, "$1{\"effects\":{\"blur\":1}}'");
    const r = reflowIndex(tuned, { ...full, look: cool });
    expect(attr(r.html.match(/<video id="fx-t-p2-p2"[^>]*>/)![0], "data-color-grading")).toBe('{"preset":"clean-studio","effects":{"digitalGlitch":0.7}}');
    expect(attr(r.html.match(/<video id="fx-t-p2-p1"[^>]*>/)![0], "data-color-grading")).toBe('{"effects":{"blur":1}}');
  });

  test("transition code changed by hand is left alone", () => {
    const edited = fresh.replace('tl.set("#stage", { x: -16, scale: 1.04 }, 1.93);', 'tl.set("#stage", { x: -40, scale: 1.04 }, 1.93);');
    const r = reflowIndex(edited, { ...full, motion: motionBlock([{ kind: "whip", at: 2 }]) });
    expect(r.html).toContain("x: -40");
    expect(r.notes).toContain("the transition code was changed by hand: transitions stay as you left them");
  });

  test("making room moves everything after a point, and a new piece goes inside the camera", () => {
    const roomy = openGap(built, 2, 1.5);
    expect(readPieces(roomy).map((p) => p.start)).toEqual([0, 3.5]);
    expect(roomy).toMatch(/id="sfx-zoom-0"[^>]*data-start="3.7"[^>]*data-reel-start="3.7"/);
    expect(roomy).toMatch(/id="sfx-emoji-w5"[^>]*data-start="1"/);
    const added = addPiece(roomy, { id: "c-b", start: 2, duration: 1.5, mediaStart: 0, src: "assets/clips/b.mp4" }, look);
    expect(added).toMatch(/id="p2"[^>]*><\/video>\s*<video id="c-b"[^>]*src="assets\/clips\/b.mp4"[^>]*data-has-audio="true"[^>]*><\/video>\s*<\/div>\s*<\/div>/);
    expect(readPieces(added).map((p) => p.id)).toEqual(["p1", "c-b", "p2"]);
    expect(findHoles(added)).toEqual([]);
  });
});

describe("captions of an imported clip", () => {
  test("a word of an imported clip retyped by hand becomes a fix under its own id", () => {
    const page = '<span id="cap-take-2_w3" class="cap-word">FRUIT!</span><span id="cap-w1" class="cap-word">PEOPLE</span>';
    const expected = new Map([["take-2_w3", "FRUIT"], ["w1", "PEOPLE"]]);
    expect(captionFixes(page, expected)).toEqual({ "take-2_w3": "FRUIT!" });
  });
});

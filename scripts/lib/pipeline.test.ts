import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Edit } from "./edit";
import { applyReel, listReels, run, watchReel } from "./pipeline";

// A tiny reel on disk: no video needed, applying an edit only writes text files.
let root: string;
const reel = () => join(root, "reels", "demo");
const read = (name: string) => Bun.file(join(reel(), name)).text();
const readEdit = async () => JSON.parse(await read("edit.json")) as Edit;

const words = [
  { id: "w0", text: "Most", start: 0.1, end: 0.3 },
  { id: "w1", text: "people", start: 0.35, end: 0.7 },
  { id: "w2", text: "edit", start: 3.1, end: 3.4 },
  { id: "w3", text: "by", start: 3.45, end: 3.6 },
  { id: "w4", text: "hand.", start: 3.65, end: 4.0 },
];
const edit: Edit = {
  source: "inbox/demo.mov",
  keeps: [
    [0, 1],
    [3, 4.2],
  ],
  captions: { maxWords: 3 },
  zooms: [{ from: "w2", to: "w4", scale: 1.2, type: "punch" }],
  emojis: [{ word: "w4", emoji: "✋", sound: "pop" }],
};

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "reel-test-"));
  mkdirSync(join(root, "sfx"), { recursive: true });
  mkdirSync(join(reel(), "work"), { recursive: true });
  await Bun.write(join(root, "sfx", "manifest.json"), JSON.stringify({ pop: { file: "pop.mp3", duration: 0.27, sync: 0, volume: 0.4 } }));
  await Bun.write(join(root, "sfx", "pop.mp3"), "not really audio");
  await Bun.write(join(reel(), "work", "words.json"), JSON.stringify(words));
  await Bun.write(join(reel(), "edit.json"), JSON.stringify(edit));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("applyReel", () => {
  test("the first build writes the project and saves the cut", async () => {
    const summary = await applyReel("demo", { root });
    expect(summary.fresh).toBe(true);
    expect(summary.pieces).toBe(2);

    const index = await read("index.html");
    expect(index).toMatch(/<video id="p1"[^>]*data-start="0" data-duration="1" data-media-start="0"/);
    expect(index).toMatch(/<video id="p2"[^>]*data-start="1" data-duration="1.2" data-media-start="3"/);
    expect(index).toMatch(/<audio id="sfx-emoji-w4"[^>]*data-start="1.65"/);
    expect(await Bun.file(join(reel(), "assets", "sfx", "pop.mp3")).exists()).toBe(true);

    const captions = await read("compositions/captions.html");
    expect(captions.indexOf(">MOST<")).toBeLessThan(captions.indexOf(">EDIT<"));
    expect((await readEdit()).pieces).toEqual([
      { id: "p1", start: 0, src: [0, 1] },
      { id: "p2", start: 1, src: [3, 4.2] },
    ]);
  });

  test("applying again with nothing changed writes nothing", async () => {
    const before = await read("index.html");
    const summary = await applyReel("demo", { root });
    expect(summary.fresh).toBe(false);
    expect(summary.changed).toBe(false);
    expect(await read("index.html")).toBe(before);
  });

  test("after a piece is dragged in the editor, captions, zoom and sound follow it", async () => {
    // What the editor writes when the second piece is dragged to the front.
    const index = (await read("index.html"))
      .replace('data-start="1" data-duration="1.2" data-media-start="3"', 'data-start="0" data-duration="1.2" data-media-start="3"')
      .replace('data-start="0" data-duration="1" data-media-start="0"', 'data-start="1.2" data-duration="1" data-media-start="0"');
    await Bun.write(join(reel(), "index.html"), index);

    const summary = await applyReel("demo", { root });
    expect(summary.changed).toBe(true);

    const captions = await read("compositions/captions.html");
    expect(captions.indexOf(">EDIT<")).toBeLessThan(captions.indexOf(">MOST<"));

    const after = await read("index.html");
    expect(after).toMatch(/<audio id="sfx-emoji-w4"[^>]*data-start="0.65"/);
    expect(after).toContain('tl.set("#cam", { scale: 1.2 }, 0.1)');
    expect((await readEdit()).pieces).toEqual([
      { id: "p2", start: 0, src: [3, 4.2] },
      { id: "p1", start: 1.2, src: [0, 1] },
    ]);
  });

  test("a caption retyped in the editor is kept as a fix and survives the next change", async () => {
    const captions = (await read("compositions/captions.html")).replace(">PEOPLE<", ">CREATORS<");
    await Bun.write(join(reel(), "compositions", "captions.html"), captions);

    await applyReel("demo", { root });
    expect((await readEdit()).captions?.fixes).toEqual({ w1: "CREATORS" });
    expect(await read("compositions/captions.html")).toContain(">CREATORS<");
  });

  test("a piece deleted in the editor takes its effects with it instead of failing", async () => {
    const index = (await read("index.html")).replace(/\s*<video id="p2"[^>]*><\/video>/, "");
    await Bun.write(join(reel(), "index.html"), index);

    const summary = await applyReel("demo", { root });
    expect(summary.pieces).toBe(1);
    expect(summary.skipped.join("\n")).toContain("w4");
    const after = await read("index.html");
    expect(after).not.toContain('id="sfx-emoji-w4"');
    expect(after).not.toContain("scale: 1.2");
  });

  test("a change made in chat reaches the open project without undoing the hand edits", async () => {
    const current = await readEdit();
    current.captions = { ...current.captions, emphasis: ["w0"] };
    await Bun.write(join(reel(), "edit.json"), JSON.stringify(current));

    await applyReel("demo", { root });
    expect(await read("compositions/captions.html")).toMatch(/id="cap-w0" class="cap-word cap-em"/);
    expect((await readEdit()).pieces).toEqual([{ id: "p1", start: 1.2, src: [0, 1] }]);
  });

  test("reset rebuilds from edit.json and keeps the saved cut", async () => {
    const summary = await applyReel("demo", { root, reset: true });
    expect(summary.fresh).toBe(true);
    expect(await read("index.html")).toMatch(/<video id="p1"[^>]*data-start="1.2"/);
  });

  test("a hole in the cut is reported while editing and closed for an export", async () => {
    // The only piece sits at 1.2 s: the reel would open on 1.2 s of black.
    const editing = await applyReel("demo", { root });
    expect(editing.notes.join("\n")).toContain("hole of 1.20s at the start");
    expect(await read("index.html")).toMatch(/<video id="p1"[^>]*data-start="1.2"/);

    const exporting = await applyReel("demo", { root, closeHoles: true });
    expect(exporting.notes.join("\n")).toContain("closed a hole of 1.20s at the start");
    expect(exporting.duration).toBe(1);
    expect(await read("index.html")).toMatch(/<video id="p1"[^>]*data-start="0"/);
    expect((await readEdit()).pieces).toEqual([{ id: "p1", start: 0, src: [0, 1] }]);
    expect(exporting.captions[0]).toStartWith("0.00-");
  });
});

describe("watchReel", () => {
  test("re-applies when the editor saves through a temporary file and a rename", async () => {
    await applyReel("demo", { root, reset: true });
    let applied = 0;
    const watcher = watchReel("demo", { root, onApply: () => applied++ });
    try {
      // macOS takes a moment to start reporting changes in a folder; a save
      // made in that instant is not seen. The app's watcher is long-lived.
      await Bun.sleep(300);
      const moved = (await read("index.html")).replace(
        /(<video id="p1"[^>]*data-start=")[^"]*"/,
        (_, head: string) => `${head}0.5"`,
      );
      const temp = join(reel(), "index.html.hf1a2b.tmp");
      await Bun.write(temp, moved);
      renameSync(temp, join(reel(), "index.html"));
      for (let i = 0; i < 40 && applied === 0; i++) await Bun.sleep(50);
      expect(applied).toBeGreaterThan(0);
      expect((await readEdit()).pieces).toEqual([{ id: "p1", start: 0.5, src: [0, 1] }]);
    } finally {
      watcher.close();
    }
  });
});

describe("run", () => {
  test("every tool it starts is told not to report usage anywhere", async () => {
    const { stdout } = await run(["sh", "-c", "echo $HYPERFRAMES_NO_TELEMETRY-$DO_NOT_TRACK"]);
    expect(stdout.trim()).toBe("1-1");
  });
});

describe("listReels", () => {
  test("lists the reels in a project", async () => {
    const reels = await listReels(root);
    expect(reels.map((r) => r.slug)).toEqual(["demo"]);
    expect(reels[0]!.built).toBe(true);
  });
});

describe("a reel with a second clip, transitions and effects", () => {
  const duo = () => join(root, "reels", "duo");
  const readDuo = (name: string) => Bun.file(join(duo(), name)).text();
  const duoEdit: Edit = {
    source: "inbox/duo.mov",
    keeps: [[0, 1], [3, 4.2]],
    clips: { b: { duration: 4, sound: true, words: 2 }, silent: { duration: 6, sound: false, words: 0 } },
    transitions: [{ into: "p2", type: "glitch", sound: false }],
    effects: [{ from: "w0", to: "w1", effect: "vhs" }],
    inserts: [{ clip: "silent", at: "w2", until: "w4", mode: "pip" }],
  };

  beforeAll(async () => {
    mkdirSync(join(duo(), "work", "clips"), { recursive: true });
    await Bun.write(join(duo(), "work", "words.json"), JSON.stringify(words));
    await Bun.write(join(duo(), "work", "clips", "b.words.json"), JSON.stringify([
      { id: "b_w0", text: "Look", start: 0.2, end: 0.5, clip: "b" },
      { id: "b_w1", text: "here", start: 0.6, end: 0.9, clip: "b" },
    ]));
    await Bun.write(join(duo(), "edit.json"), JSON.stringify(duoEdit));
  });

  test("the first build lays effect copies in the camera, the insert above it, and writes the transition", async () => {
    const summary = await applyReel("duo", { root });
    expect(summary).toMatchObject({ fresh: true, pieces: 2, layers: 4, motions: 1 });
    const index = await readDuo("index.html");
    expect(index).toMatch(/<video id="fx-e0-p1"[^>]*data-start="0.1" data-duration="0.6" data-media-start="0.1"[^>]*tapeDamage/);
    expect(index).toMatch(/<video id="fx-t-p2-p1"[^>]*data-start="0.83"[^>]*digitalGlitch/);
    expect(index).toMatch(/<video id="ins-0"[^>]*src="assets\/clips\/silent.mp4" muted[^>]*data-start="1.1" data-duration="0.9"[^>]*border-radius/);
    expect(index).toContain('tl.set("#stage", { x: -16, scale: 1.04 }, 0.93);');
    expect((await applyReel("duo", { root })).changed).toBe(false);
  });

  test("an imported clip put into the cut is captioned from its own words and saved with the cut", async () => {
    const { addPiece, openGap } = await import("./project");
    const path = join(duo(), "index.html");
    const html = addPiece(openGap(await readDuo("index.html"), 1, 1.5), { id: "c-b", start: 1, duration: 1.5, mediaStart: 0, src: "assets/clips/b.mp4" });
    await Bun.write(path, html);
    const summary = await applyReel("duo", { root });
    expect(summary).toMatchObject({ pieces: 3, duration: 3.7 });
    expect(summary.notes).toEqual([]);
    expect(summary.captions.join(" | ")).toMatch(/Most people \|.*Look here \|.*edit by hand\./);
    const captions = await readDuo("compositions/captions.html");
    expect(captions).toContain('id="cap-b_w0"');
    const saved = JSON.parse(await readDuo("edit.json")) as Edit;
    expect(saved.pieces![1]).toEqual({ id: "c-b", start: 1, src: [0, 1.5], file: "assets/clips/b.mp4" });
    // The transition into p2 and the insert on w2 moved along with p2.
    const index = await readDuo("index.html");
    expect(index).toMatch(/<video id="fx-t-p2-p2"[^>]*data-start="2.5"/);
    expect(index).toMatch(/<video id="fx-t-p2-c-b"[^>]*src="assets\/clips\/b.mp4"[^>]*data-start="2.33"/);
    expect(index).toMatch(/<video id="ins-0"[^>]*data-start="2.6"/);
  });

  test("an insert dragged by hand becomes a clip of its own; a rebuild from edit.json places it afresh", async () => {
    const path = join(duo(), "index.html");
    await Bun.write(path, (await readDuo("index.html")).replace(/(<video id="ins-0"[^>]*data-start=")2.6"/, '$13"'));
    const summary = await applyReel("duo", { root });
    expect(summary.notes.join(" ")).toMatch(/ins-0 was moved or trimmed by hand/);
    expect(summary.pieces).toBe(4);
    expect((await applyReel("duo", { root })).changed).toBe(false);
    const saved = JSON.parse(await readDuo("edit.json")) as Edit;
    expect(saved.pieces!.find((p) => p.id === "ins-0")).toMatchObject({ start: 3, file: "assets/clips/silent.mp4", muted: true });

    const reset = await applyReel("duo", { root, reset: true });
    expect(reset).toMatchObject({ fresh: true, pieces: 3 });
    expect(await readDuo("index.html")).toMatch(/<video id="ins-0"[^>]*data-start="2.6"[^>]*data-reel-layer="insert"/);
  });
});

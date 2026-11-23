import { describe, expect, test } from "bun:test";
import {
  cutDuration,
  editPieces,
  groupCaptions,
  piecesFromKeeps,
  resolveEdit,
  snapKeeps,
  speechKeeps,
  subtractRanges,
  timelineEnd,
  toTimeline,
  wordsOnTimeline,
  workRoom,
  type CutWord,
  type Edit,
  type Piece,
} from "./edit";
import type { Word } from "./transcript";

const w = (i: number, text: string, start: number, end: number): Word => ({
  id: `w${i}`,
  text,
  start,
  end,
});

describe("speechKeeps", () => {
  test("with words: sound that holds no words is a pause, not a piece", () => {
    // Real rooms click and breathe: a 2.2 s pause arrives as three short silences.
    const silences: Range[] = [
      [0, 0.3],
      [2, 2.5],
      [2.6, 3.0],
      [3.02, 3.6],
      [5, 5.3],
      [5.37, 5.7],
      [5.72, 7],
    ];
    const words = [
      { start: 0.4, end: 1.9 },
      { start: 3.7, end: 4.9 },
    ];
    expect(speechKeeps(silences, 7, { words })).toEqual([
      [0, 2.1],
      [3.5, 5.1],
    ]);
    // Without words the same clip falls apart into blips and a dead tail.
    expect(speechKeeps(silences, 7).length).toBeGreaterThan(2);
  });

  test("with words: a long stretch of sound without words is kept for review", () => {
    const silences: Range[] = [
      [2, 3],
      [4, 5],
    ];
    const words = [{ start: 0.2, end: 1.8 }, { start: 5.2, end: 6 }];
    expect(speechKeeps(silences, 6, { words })).toEqual([
      [0, 2.1],
      [2.9, 4.1],
      [4.9, 6],
    ]);
    expect(speechKeeps(silences, 6, { words, unclear: 1.5 })).toEqual([
      [0, 2.1],
      [4.9, 6],
    ]);
  });

  test("keeps speech between long silences, padded into the silence", () => {
    const keeps = speechKeeps(
      [
        [2, 3.5],
        [5, 5.2],
        [7, 10],
      ],
      10,
      { minSilence: 0.45, pad: 0.1 },
    );
    expect(keeps).toEqual([
      [0, 2.1],
      [3.4, 7.1],
    ]);
  });

  test("trims a silent start and never pads past the clip", () => {
    const keeps = speechKeeps([[0, 1]], 4, { minSilence: 0.45, pad: 0.1 });
    expect(keeps).toEqual([[0.9, 4]]);
  });

  test("padding never eats more than half of a silence", () => {
    const keeps = speechKeeps([[2, 2.5]], 5, { minSilence: 0.45, pad: 0.4 });
    expect(keeps).toEqual([
      [0, 2.25],
      [2.25, 5],
    ]);
  });
});

describe("subtractRanges", () => {
  test("removes a range from the middle of a keep", () => {
    expect(subtractRanges([[0, 10]], [[4, 5]])).toEqual([
      [0, 4],
      [5, 10],
    ]);
  });

  test("drops a keep that is fully covered and slivers under 0.1s", () => {
    expect(
      subtractRanges(
        [
          [0, 2],
          [3, 4],
        ],
        [[1.95, 4.5]],
      ),
    ).toEqual([[0, 1.95]]);
    expect(subtractRanges([[0, 2]], [[0.05, 2]])).toEqual([]);
  });
});

describe("snapKeeps", () => {
  test("widens each range to whole frames so picture and sound cut together", () => {
    expect(snapKeeps([[0.11, 2.11]], 30)).toEqual([[0.1, 2.133]]);
  });

  test("snapping twice changes nothing, even after rounding to milliseconds", () => {
    const once = snapKeeps(
      [
        [0, 2.15],
        [11.5, 15.75],
      ],
      30,
    );
    expect(once).toEqual([
      [0, 2.167],
      [11.5, 15.767],
    ]);
    expect(snapKeeps(once, 30)).toEqual(once);
  });

  test("joins ranges that touch after snapping and clamps to the clip", () => {
    expect(
      snapKeeps(
        [
          [-0.2, 1.01],
          [1.02, 2],
          [3, 9],
        ],
        30,
        4,
      ),
    ).toEqual([
      [0, 2],
      [3, 4],
    ]);
  });
});

describe("pieces on the timeline", () => {
  const keeps: [number, number][] = [
    [1, 3],
    [5, 6],
  ];
  const pieces = piecesFromKeeps(keeps);
  // The same two pieces after the second was dragged in front of the first.
  const swapped: Piece[] = [
    { id: "p2", start: 0, duration: 1, mediaStart: 5 },
    { id: "p1", start: 1, duration: 2, mediaStart: 1 },
  ];

  test("cutDuration sums the kept ranges", () => {
    expect(cutDuration(keeps)).toBe(3);
  });

  test("piecesFromKeeps lays the kept ranges back to back", () => {
    expect(pieces).toEqual([
      { id: "p1", start: 0, duration: 2, mediaStart: 1 },
      { id: "p2", start: 2, duration: 1, mediaStart: 5 },
    ]);
    expect(timelineEnd(pieces)).toBe(3);
  });

  test("the editor timeline is longer than the reel, with room to park the longest piece", () => {
    expect(workRoom(pieces)).toBe(4);
    expect(workRoom([{ id: "p1", start: 0, duration: 12.5, mediaStart: 0 }])).toBe(14.5);
    expect(workRoom([])).toBe(2);
  });

  test("editPieces prefers the cut saved from the editor over the first proposal", () => {
    const edit: Edit = { source: "a.mov", keeps, pieces: [{ id: "p2", start: 0.5, src: [5, 6] }] };
    expect(editPieces(edit)).toEqual([{ id: "p2", start: 0.5, duration: 1, mediaStart: 5 }]);
    expect(editPieces({ source: "a.mov", keeps })).toEqual(pieces);
  });

  test("toTimeline maps source seconds onto the timeline", () => {
    expect(toTimeline(1, pieces)).toBe(0);
    expect(toTimeline(2.5, pieces)).toBe(1.5);
    expect(toTimeline(5.5, pieces)).toBe(2.5);
  });

  test("toTimeline follows a piece wherever it was dragged", () => {
    expect(toTimeline(5.5, swapped)).toBe(0.5);
    expect(toTimeline(2.5, swapped)).toBe(2.5);
  });

  test("a removed moment snaps to the next kept moment of the source", () => {
    expect(toTimeline(0.2, pieces)).toBe(0);
    expect(toTimeline(4, pieces)).toBe(2);
    expect(toTimeline(4, swapped)).toBe(0);
    expect(toTimeline(9, pieces)).toBe(3);
  });

  test("wordsOnTimeline drops cut words and retimes the rest", () => {
    const words = [w(0, "a", 1.2, 1.5), w(1, "um", 3.5, 3.9), w(2, "b", 5.1, 5.4), w(3, "c", 5.7, 6.1)];
    expect(wordsOnTimeline(words, pieces)).toEqual([
      { id: "w0", uid: "w0", text: "a", start: 0.2, end: 0.5, seg: 0 },
      { id: "w2", uid: "w2", text: "b", start: 2.1, end: 2.4, seg: 1 },
      { id: "w3", uid: "w3", text: "c", start: 2.7, end: 3, seg: 1 },
    ]);
  });

  test("words come out in timeline order after a reorder", () => {
    const words = [w(0, "a", 1.2, 1.5), w(2, "b", 5.1, 5.4)];
    expect(wordsOnTimeline(words, swapped).map((x) => [x.id, x.start])).toEqual([
      ["w2", 0.1],
      ["w0", 1.2],
    ]);
  });

  test("a word used in two pieces gets a unique id the second time", () => {
    const twice: Piece[] = [
      { id: "p1", start: 0, duration: 2, mediaStart: 1 },
      { id: "p1-2", start: 2, duration: 2, mediaStart: 1 },
    ];
    const out = wordsOnTimeline([w(0, "a", 1.2, 1.5)], twice);
    expect(out.map((x) => [x.id, x.uid, x.start])).toEqual([
      ["w0", "w0", 0.2],
      ["w0", "w0-2", 2.2],
    ]);
  });
});

describe("groupCaptions", () => {
  const cut = (i: number, text: string, start: number, end: number, seg = 0): CutWord => ({
    ...w(i, text, start, end),
    uid: `w${i}`,
    seg,
  });

  test("the first caption is on screen from frame 0 when the reel opens on speech", () => {
    const groups = groupCaptions([cut(0, "Hi", 0.36, 0.8), cut(1, "there.", 0.85, 1.2), cut(2, "Next", 2.5, 2.9)]);
    expect(groups[0]!.start).toBe(0);
    expect(groups[1]!.start).toBe(2.46);
    // A reel that opens on a long silence keeps its caption for the first word.
    expect(groupCaptions([cut(0, "Late", 1.5, 1.9)])[0]!.start).toBe(1.46);
  });

  test("breaks on the word limit, punctuation, pauses and cuts", () => {
    const words = [
      cut(0, "one", 0.1, 0.3),
      cut(1, "two", 0.35, 0.5),
      cut(2, "three", 0.55, 0.8),
      cut(3, "four", 0.85, 1.0),
      cut(4, "five.", 1.05, 1.3),
      cut(5, "six", 1.35, 1.5),
      cut(6, "seven", 2.2, 2.5),
      cut(7, "eight", 2.55, 2.8),
      cut(8, "nine", 2.85, 3.0, 1),
    ];
    const groups = groupCaptions(words, { maxWords: 3, pause: 0.4 });
    expect(groups.map((g) => g.uids)).toEqual([
      ["w0", "w1", "w2"],
      ["w3", "w4"],
      ["w5"],
      ["w6", "w7"],
      ["w8"],
    ]);
  });

  test("only one group is on screen at a time", () => {
    const words = [cut(0, "a", 0.1, 0.3), cut(1, "b.", 0.35, 0.5), cut(2, "c", 0.6, 0.9)];
    const groups = groupCaptions(words, { maxWords: 3, hold: 0.3 });
    expect(groups[0]!.end).toBeLessThanOrEqual(groups[1]!.start);
    expect(groups[1]!.end).toBeCloseTo(1.2);
  });

  test("a long word never shares a line that would overflow", () => {
    const words = [cut(0, "internationalisation", 0, 1), cut(1, "now", 1.05, 1.2)];
    const groups = groupCaptions(words, { maxWords: 3, maxChars: 18 });
    expect(groups).toHaveLength(2);
  });
});

describe("resolveEdit", () => {
  const words = [
    w(0, "Most", 0.1, 0.3),
    w(1, "people", 0.35, 0.7),
    w(2, "Um,", 2.0, 2.3),
    w(3, "edit", 3.1, 3.4),
    w(4, "by", 3.45, 3.6),
    w(5, "hand.", 3.65, 4.0),
  ];
  const edit: Edit = {
    source: "inbox/a.mov",
    keeps: [
      [0, 1],
      [3, 4.2],
    ],
    captions: { fixes: { w1: "creators" }, emphasis: ["w5"] },
    zooms: [{ from: "w3", to: "w5", scale: 1.2, focus: [0.5, 0.3], type: "punch" }],
    emojis: [{ word: "w5", emoji: "✋" }],
  };

  test("retimes words, applies fixes, emphasis and emoji", () => {
    const r = resolveEdit(edit, words);
    expect(r.duration).toBeCloseTo(2.2);
    expect(r.words.map((x) => x.text)).toEqual(["Most", "creators", "edit", "by", "hand."]);
    const hand = r.words.find((x) => x.id === "w5")!;
    expect(hand.emphasis).toBe(true);
    expect(hand.emoji).toBe("✋");
    expect(hand.start).toBeCloseTo(1.65);
  });

  test("anchors zooms to words on the timeline", () => {
    const [zoom] = resolveEdit(edit, words).zooms;
    expect(zoom!.start).toBeCloseTo(1.1);
    expect(zoom!.end).toBeCloseTo(2.0);
    expect(zoom).toMatchObject({ scale: 1.2, focus: [0.5, 0.3], type: "punch" });
  });

  test("everything follows when the pieces are dragged into a new order", () => {
    const swapped: Piece[] = [
      { id: "p2", start: 0, duration: 1.2, mediaStart: 3 },
      { id: "p1", start: 1.2, duration: 1, mediaStart: 0 },
    ];
    const r = resolveEdit(edit, words, { pieces: swapped });
    expect(r.words.map((x) => x.text)).toEqual(["edit", "by", "hand.", "Most", "creators"]);
    expect(r.zooms[0]!.start).toBeCloseTo(0.1);
    expect(r.words.find((x) => x.id === "w5")!.start).toBeCloseTo(0.65);
    expect(r.duration).toBeCloseTo(2.2);
  });

  test("reports every problem in one error", () => {
    const bad: Edit = {
      ...edit,
      zooms: [
        { from: "w3", to: "w5", scale: 3 },
        { from: "w4", to: "w5" },
        { from: "w99", to: "w5" },
      ],
      emojis: [{ word: "w2", emoji: "🙈" }],
    };
    let message = "";
    try {
      resolveEdit(bad, words);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("scale 3");
    expect(message).toContain("overlap");
    expect(message).toContain("w99");
    expect(message).toContain("w2");
  });

  test("in lenient mode a broken anchor is skipped and reported, not fatal", () => {
    const onlyFirst: Piece[] = [{ id: "p1", start: 0, duration: 1, mediaStart: 0 }];
    const r = resolveEdit(
      { ...edit, sounds: [{ at: "w4", sound: "pop" }] },
      words,
      { pieces: onlyFirst, lenient: true },
    );
    expect(r.zooms).toEqual([]);
    expect(r.moments).toEqual([]);
    expect(r.words.map((x) => x.id)).toEqual(["w0", "w1"]);
    expect(r.skipped.join("\n")).toContain("w5");
    expect(r.skipped.join("\n")).toContain("zooms[0]");
  });

  test("collects sound moments from zooms, emojis and the sounds list, each with a stable key", () => {
    const r = resolveEdit(
      {
        ...edit,
        zooms: [{ from: "w3", to: "w5", sound: "whoosh-in" }],
        emojis: [{ word: "w5", emoji: "✋", sound: "pop" }],
        sounds: [
          { at: "w0", sound: "typing-long", until: "w1", volume: 0.2 },
          { at: 3.3, sound: "click" },
        ],
      },
      words,
    );
    expect(r.moments).toEqual([
      { key: "sound-0", at: 0.1, sound: "typing-long", until: 0.7, volume: 0.2 },
      { key: "zoom-0", at: 1.1, sound: "whoosh-in" },
      { key: "sound-1", at: 1.3, sound: "click" },
      { key: "emoji-w5", at: 1.65, sound: "pop" },
    ]);
  });

  test("no sounds asked for means no moments", () => {
    expect(resolveEdit(edit, words).moments).toEqual([]);
  });

  test("a sound anchored to a cut word is reported", () => {
    expect(() => resolveEdit({ ...edit, sounds: [{ at: "w2", sound: "pop" }] }, words)).toThrow(/sounds\[0\].*w2/s);
  });

  test("hidden words leave the captions but keep their place in the cut", () => {
    const r = resolveEdit({ ...edit, captions: { hide: ["w4"] } }, words);
    expect(r.words.map((x) => x.id)).toEqual(["w0", "w1", "w3", "w5"]);
  });
});

describe("a second video in the reel", () => {
  // Source: "Most people" 0-1, then "raise your hand." 3.5-5.5. Clip "b": "Look here now" 0.2-1.4.
  const words: Word[] = [
    w(0, "Most", 0.1, 0.3),
    w(1, "people", 0.35, 0.7),
    w(3, "raise", 3.6, 3.9),
    w(4, "your", 3.95, 4.1),
    w(5, "hand.", 4.15, 4.5),
    { id: "b_w0", text: "Look", start: 0.2, end: 0.5, clip: "b" },
    { id: "b_w1", text: "here", start: 0.6, end: 0.9, clip: "b" },
    { id: "b_w2", text: "now", start: 1.0, end: 1.4, clip: "b" },
  ];
  const base: Edit = {
    source: "inbox/a.mov",
    keeps: [[0, 1], [3.5, 5.5]],
    clips: { b: { duration: 4, sound: true, words: 3 } },
  };
  const cut: Piece[] = [
    { id: "p1", start: 0, duration: 1, mediaStart: 0 },
    { id: "c-b", start: 1, duration: 1.5, mediaStart: 0, src: "assets/clips/b.mp4" },
    { id: "p2", start: 2.5, duration: 2, mediaStart: 3.5 },
  ];

  test("a clip in the cut speaks its own words, and the source words keep their own times", () => {
    const r = resolveEdit(base, words, { pieces: cut });
    expect(r.duration).toBe(4.5);
    expect(r.words.map((x) => [x.id, x.start])).toEqual([
      ["w0", 0.1], ["w1", 0.35], ["b_w0", 1.2], ["b_w1", 1.6], ["b_w2", 2], ["w3", 2.6], ["w4", 2.95], ["w5", 3.15],
    ]);
  });

  test("a muted clip in the cut shows no captions, and source seconds ignore it", () => {
    const muted = cut.map((p) => (p.id === "c-b" ? { ...p, muted: true } : p));
    const r = resolveEdit({ ...base, sounds: [{ at: 0.4, sound: "pop" }] }, words, { pieces: muted });
    expect(r.words.map((x) => x.id)).toEqual(["w0", "w1", "w3", "w4", "w5"]);
    expect(r.moments[0]!.at).toBe(0.4);
    expect(toTimeline(0.4, [{ id: "c-b", start: 0, duration: 2, mediaStart: 0, src: "assets/clips/b.mp4" }, ...cut.slice(2)])).toBe(2.5);
  });

  test("the saved cut remembers which file a piece plays", () => {
    const pieces = editPieces({ ...base, pieces: [{ id: "c-b", start: 1, src: [0, 1.5], file: "assets/clips/b.mp4", muted: true }] });
    expect(pieces).toEqual([{ id: "c-b", start: 1, duration: 1.5, mediaStart: 0, src: "assets/clips/b.mp4", muted: true }]);
  });

  test("an insert covers the speaker from one word to another, silent, and follows the cut", () => {
    const edit: Edit = { ...base, inserts: [{ clip: "b", at: "w3", until: "w5", from: 1, sound: "whoosh" }] };
    const r = resolveEdit(edit, words);
    expect(r.layers).toEqual([
      { id: "ins-0", kind: "insert", src: "assets/clips/b.mp4", start: 1.1, duration: 0.9, mediaStart: 1, mode: "cover" },
    ]);
    expect(r.moments).toEqual([{ key: "ins-0", at: 1.1, sound: "whoosh" }]);
    // Silent, so the speaker's captions carry on underneath.
    expect(r.words.map((x) => x.id)).toEqual(["w0", "w1", "w3", "w4", "w5"]);
    const moved = resolveEdit(edit, words, { pieces: [cut[2]!, { ...cut[0]!, start: 4.5 }].map((p, i) => (i === 0 ? { ...p, start: 0 } : { ...p, start: 2 })) });
    expect(moved.layers[0]!.start).toBe(0.1);
  });

  test("an insert never runs past the clip or the end of the reel", () => {
    const short = resolveEdit({ ...base, inserts: [{ clip: "b", at: "w3", from: 3.5 }] }, words);
    expect(short.layers[0]!.duration).toBe(0.5);
    const late = resolveEdit({ ...base, inserts: [{ clip: "b", at: "w5", mode: "pip", corner: "top-left" }] }, words);
    expect(late.layers[0]).toMatchObject({ start: 1.65, duration: 1.35, mode: "pip", corner: "top-left" });
  });

  test("an insert with volume brings its own words into the captions", () => {
    const r = resolveEdit({ ...base, inserts: [{ clip: "b", at: 3.5, until: "w5", volume: 0.8 }] }, words, {
      pieces: [cut[0]!, { ...cut[2]!, start: 1 }],
    });
    expect(r.layers[0]).toMatchObject({ id: "ins-0", start: 1, volume: 0.8 });
    expect(r.words.map((x) => x.id)).toContain("b_w0");
  });

  test("an insert moved or deleted by hand is not placed again", () => {
    const edit: Edit = { ...base, inserts: [{ clip: "b", at: "w3" }] };
    expect(resolveEdit(edit, words, { dropped: ["ins-0"] }).layers).toEqual([]);
    const own = [...cut.filter((p) => p.id !== "c-b").map((p, i) => ({ ...p, start: i })), { id: "ins-0", start: 0.2, duration: 0.5, mediaStart: 0, src: "assets/clips/b.mp4", muted: true }];
    expect(resolveEdit(edit, words, { pieces: own }).layers).toEqual([]);
  });

  test("an insert of a clip that was never imported is an error that names what exists", () => {
    expect(() => resolveEdit({ ...base, inserts: [{ clip: "c", at: "w3" }] }, words)).toThrow(/inserts\[0\].*"c".*Imported: b/s);
  });
});

describe("transitions and effects", () => {
  const words: Word[] = [w(0, "Most", 0.1, 0.3), w(1, "people", 0.35, 0.7), w(3, "raise", 3.6, 3.9), w(5, "hand.", 4.15, 4.5)];
  const base: Edit = { source: "inbox/a.mov", keeps: [[0, 1], [3.5, 5.5]] };

  test("a transition sits on the cut into the piece that holds the word, with its sound", () => {
    const r = resolveEdit({ ...base, transitions: [{ into: "w3", type: "whip" }] }, words);
    expect(r.motions).toEqual([{ kind: "whip", at: 1 }]);
    expect(r.moments).toEqual([{ key: "trans-p2", at: 1, sound: "whoosh", until: 1.6 }]);
    expect(r.layers).toEqual([]);
    expect(resolveEdit({ ...base, transitions: [{ into: "p2", type: "dip", sound: "impact" }] }, words).moments[0]!.sound).toBe("impact");
  });

  test("a glitch transition tears both sides of the cut on copies of the two pieces", () => {
    const r = resolveEdit({ ...base, transitions: [{ into: "p2", type: "glitch", sound: false }] }, words);
    expect(r.moments).toEqual([]);
    expect(r.layers.map((l) => [l.id, l.start, l.duration, l.mediaStart])).toEqual([
      ["fx-t-p2-p1", 0.83, 0.17, 0.83],
      ["fx-t-p2-p2", 1, 0.2, 3.5],
    ]);
    expect((r.layers[0]!.grading!.effects as Record<string, number>).digitalGlitch).toBeGreaterThan(0.5);
  });

  test("a transition follows its piece when the pieces are reordered, and is dropped when its piece opens the reel", () => {
    const swapped: Piece[] = [
      { id: "p2", start: 0, duration: 2, mediaStart: 3.5 },
      { id: "p1", start: 2, duration: 1, mediaStart: 0 },
    ];
    const edit: Edit = { ...base, transitions: [{ into: "p2", type: "flash" }, { into: "w0", type: "zoom" }] };
    const r = resolveEdit(edit, words, { pieces: swapped, lenient: true });
    expect(r.motions).toEqual([{ kind: "zoom", at: 2 }]);
    expect(r.skipped.join(" ")).toMatch(/p2 opens the reel/);
  });

  test("an effect for a stretch becomes copies with the treatment; shake and flash are motion", () => {
    const r = resolveEdit(
      {
        ...base,
        effects: [
          { from: "w1", to: "w3", effect: "vhs", sound: "glitch" },
          { from: "w5", to: 5.4, effect: "shake" },
          { from: "w0", effect: "flash" },
        ],
      },
      words,
    );
    expect(r.layers.map((l) => [l.id, l.start, l.duration])).toEqual([
      ["fx-e0-p1", 0.35, 0.65],
      ["fx-e0-p2", 1, 0.4],
    ]);
    expect((r.layers[0]!.grading!.effects as Record<string, number>).tapeDamage).toBeGreaterThan(0);
    expect(r.motions).toEqual([{ kind: "flash", at: 0.1 }, { kind: "shake", at: 1.65, until: 2.9 }]);
    expect(r.moments).toEqual([{ key: "fx-0", at: 0.35, sound: "glitch", until: 1.4 }]);
  });

  test("unknown names, a missing end and two transitions on one cut are all reported", () => {
    const bad: Edit = {
      ...base,
      transitions: [{ into: "p2", type: "wobble" as never }, { into: "p2", type: "dip" }, { into: "w3", type: "flash" }],
      effects: [{ from: "w0", to: "w1", effect: "sparkle" }, { from: "w0", effect: "glitch" }, { from: "w0", to: "w1", effect: "blur", strength: 3 }],
    };
    expect(() => resolveEdit(bad, words)).toThrow(/unknown type "wobble".*already has a transition.*unknown effect "sparkle".*needs "to".*strength 3/s);
  });
});

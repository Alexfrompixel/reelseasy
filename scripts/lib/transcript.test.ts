import { describe, expect, test } from "bun:test";
import { packTranscript, snapWordsToSpeech, wordsFromWhisper } from "./transcript";

const tok = (text: string, from: number, to: number) => ({
  text,
  offsets: { from, to },
});

const whisper = {
  transcription: [
    {
      text: " Most people edit reels.",
      tokens: [
        tok("[_BEG_]", 0, 0),
        tok(" Most", 0, 190),
        tok(" people", 360, 650),
        tok(" ed", 700, 800),
        tok("it", 800, 900),
        tok(" reels", 950, 1300),
        tok(".", 1300, 1320),
        tok("[_TT_112]", 1320, 1320),
      ],
    },
    {
      text: " Um, done",
      tokens: [tok(" Um", 3000, 3200), tok(",", 3200, 3210), tok(" done", 4000, 4400)],
    },
  ],
};

describe("wordsFromWhisper", () => {
  const words = wordsFromWhisper(whisper);

  test("merges sub-word tokens and punctuation into whole words", () => {
    expect(words.map((w) => w.text)).toEqual(["Most", "people", "edit", "reels.", "Um,", "done"]);
  });

  test("gives stable ids and second-based timings", () => {
    expect(words[0]).toEqual({ id: "w0", text: "Most", start: 0, end: 0.19 });
    expect(words[2]).toEqual({ id: "w2", text: "edit", start: 0.7, end: 0.9 });
    expect(words[3]!.end).toBe(1.32);
  });

  test("drops special tokens and music marks", () => {
    const noisy = {
      transcription: [{ tokens: [tok(" ♪", 0, 500), tok(" hi", 600, 800), tok("[_EOT_]", 800, 800)] }],
    };
    expect(wordsFromWhisper(noisy).map((w) => w.text)).toEqual(["hi"]);
  });

  test("accepts an already normalised word array", () => {
    const out = wordsFromWhisper([{ text: "a", start: 1, end: 2 }]);
    expect(out).toEqual([{ id: "w0", text: "a", start: 1, end: 2 }]);
  });
});

describe("snapWordsToSpeech", () => {
  // Speech really happens in 0-2.0, 3.6-3.9 and 8.1-10; the rest is silence.
  const silences: [number, number][] = [
    [2.0, 3.6],
    [3.9, 8.1],
  ];
  const raw = [
    { id: "w0", text: "by", start: 1.68, end: 2.0 },
    { id: "w1", text: "hand.", start: 2.0, end: 3.44 },
    { id: "w2", text: "Um.", start: 3.44, end: 4.24 },
    { id: "w3", text: "I", start: 7.68, end: 8.0 },
    { id: "w4", text: "built", start: 8.0, end: 8.4 },
    { id: "w5", text: "it.", start: 8.4, end: 9.9 },
  ];
  const words = snapWordsToSpeech(raw, silences, 10);
  const get = (id: string) => words.find((x) => x.id === id)!;

  test("no word is left sitting in a silence", () => {
    for (const word of words) {
      for (const [s, e] of silences) {
        const overlap = Math.min(word.end, e) - Math.max(word.start, s);
        expect(overlap).toBeLessThanOrEqual(0.001);
      }
    }
  });

  test("a word smeared over a pause is pulled back into the speech before it", () => {
    expect(get("w1").end).toBe(2);
    expect(get("w1").end - get("w1").start).toBeGreaterThanOrEqual(0.12);
    expect(get("w0").end).toBeLessThanOrEqual(get("w1").start);
  });

  test("a word timed just before speech starts moves to that speech", () => {
    expect(get("w3").start).toBe(8.1);
    expect(get("w4").start).toBeGreaterThan(get("w3").start);
    expect(get("w2")).toMatchObject({ start: 3.6, end: 3.9 });
  });

  test("order and text are untouched", () => {
    expect(words.map((x) => x.text)).toEqual(raw.map((x) => x.text));
    for (let i = 1; i < words.length; i++) {
      expect(words[i]!.start).toBeGreaterThanOrEqual(words[i - 1]!.start);
    }
  });

  test("with no silences the words come back unchanged", () => {
    expect(snapWordsToSpeech(raw, [], 10)).toEqual(raw);
  });
});

describe("packTranscript", () => {
  test("breaks phrases at pauses and reports the gap", () => {
    const text = packTranscript(wordsFromWhisper(whisper), 0.5);
    const lines = text.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("w0-w3");
    expect(lines[0]).toContain("Most people edit reels.");
    expect(lines[0]).toContain("gap 1.68s");
    expect(lines[1]).toContain("w4");
    expect(lines[1]).toContain("Um,");
    expect(lines[2]).toContain("w5");
  });
});

describe("packTranscript with silences", () => {
  test("says when sound carries on after a phrase without any words", () => {
    const words: Word[] = [
      { id: "w0", text: "Hi", start: 1.8, end: 2.12 },
      { id: "w1", text: "My", start: 3.5, end: 3.7 },
      { id: "w2", text: "name", start: 3.8, end: 4.2 },
    ];
    const text = packTranscript(words, 0.4, [
      [0, 0.3],
      [2.9, 3.4],
      [4.25, 6],
    ]);
    const [first, second] = text.split("\n");
    expect(first).toContain("(gap 1.38s, of which 0.88s is sound with no words: um, breath or noise)");
    expect(second).not.toContain("sound");
  });
});

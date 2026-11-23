import { describe, expect, test } from "bun:test";
import { displaySize, isHdr, levelFilter, levelGain, normaliseArgs, parseSilences, slugify, targetSize } from "./media";

describe("slugify", () => {
  test("makes a folder-safe name from an iPhone filename", () => {
    expect(slugify("/x/inbox/IMG_4821.MOV")).toBe("img-4821");
    expect(slugify("My Reel — take 2 (final).mp4")).toBe("my-reel-take-2-final");
  });
});

describe("parseSilences", () => {
  test("reads silencedetect output", () => {
    const log = `
[silencedetect @ 0x1] silence_start: 2.24
[silencedetect @ 0x1] silence_end: 3.74 | silence_duration: 1.5
[silencedetect @ 0x1] silence_start: 17.9`;
    expect(parseSilences(log, 18.4)).toEqual([
      [2.24, 3.74],
      [17.9, 18.4],
    ]);
  });
});

describe("displaySize", () => {
  test("swaps width and height for a rotated phone clip", () => {
    const stream = { width: 3840, height: 2160, side_data_list: [{ rotation: -90 }] };
    expect(displaySize(stream)).toEqual({ width: 2160, height: 3840 });
    expect(displaySize({ width: 1080, height: 1920 })).toEqual({ width: 1080, height: 1920 });
  });
});

describe("isHdr", () => {
  test("flags HLG and PQ footage", () => {
    expect(isHdr({ color_transfer: "arib-std-b67" })).toBe(true);
    expect(isHdr({ color_transfer: "smpte2084" })).toBe(true);
    expect(isHdr({ color_transfer: "bt709" })).toBe(false);
    expect(isHdr({})).toBe(false);
  });
});

describe("targetSize", () => {
  test("keeps extra pixels for zooms only when the source has them", () => {
    expect(targetSize({ width: 2160, height: 3840 })).toEqual({ width: 1440, height: 2560 });
    expect(targetSize({ width: 1080, height: 1920 })).toEqual({ width: 1080, height: 1920 });
    expect(targetSize({ width: 3840, height: 2160 })).toEqual({ width: 1440, height: 2560 });
  });
});

describe("levelGain", () => {
  test("raises quiet speech to -14 LUFS", () => {
    expect(levelGain(-20, -9)).toEqual({ gain: 6, limit: false });
  });

  test("still reaches -14 when the peaks are in the way, and asks for a limiter", () => {
    // A phone recording: quiet on average, with loud peaks.
    expect(levelGain(-27.9, -5.8)).toEqual({ gain: 13.9, limit: true });
    expect(levelGain(-20, -4)).toEqual({ gain: 6, limit: true });
  });

  test("turns loud speech down, never boosts near-silence by more than 24 dB", () => {
    expect(levelGain(-10, -1)).toEqual({ gain: -4, limit: false });
    expect(levelGain(-60, -40)).toEqual({ gain: 24, limit: false });
  });

  test("ignores unreadable measurements", () => {
    expect(levelGain(Number.NaN, -1)).toEqual({ gain: 0, limit: false });
    expect(levelGain(-Infinity, -Infinity)).toEqual({ gain: 0, limit: false });
  });
});

describe("levelFilter", () => {
  test("a plain gain when nothing would clip", () => {
    expect(levelFilter({ gain: 6, limit: false })).toBe("volume=6dB");
  });

  test("adds a limiter that holds peaks at -2 dB without changing the level itself", () => {
    const filter = levelFilter({ gain: 13.9, limit: true });
    expect(filter).toStartWith("volume=13.9dB,alimiter=");
    expect(filter).toContain("limit=0.794");
    expect(filter).toContain("level=false");
  });
});

describe("normaliseArgs", () => {
  const args = normaliseArgs({ source: "in.mov", output: "out.mp4", size: { width: 1080, height: 1920 } });
  const text = args.join(" ");

  test("makes the whole clip 9:16 at a steady 30 fps without cutting anything", () => {
    expect(text).toContain("fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1");
    expect(text).not.toContain("trim");
  });

  test("encodes H.264 with a keyframe every second so the editor can seek to any frame", () => {
    expect(args).toContain("libx264");
    expect(text).toContain("-g 30");
    expect(text).toContain("-pix_fmt yuv420p");
    expect(args[args.length - 1]).toBe("out.mp4");
  });

  test("makes the sound stereo at 48 kHz", () => {
    expect(text).toContain("aresample=48000,aformat=channel_layouts=stereo");
  });
});

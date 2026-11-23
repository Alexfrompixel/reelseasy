import { describe, expect, test } from "bun:test";
import { audioTag, captionsHtml, indexHtml, layerTag, layerTags, pieceTag, textHash, zoomBlock } from "./compose";
import type { Piece, Resolved } from "./edit";

const pieces: Piece[] = [
  { id: "p1", start: 0, duration: 1, mediaStart: 0 },
  { id: "p2", start: 1, duration: 3, mediaStart: 3.5 },
];

const resolved: Resolved = {
  duration: 4,
  words: [
    { id: "w0", uid: "w0", text: "Most", start: 0.1, end: 0.3, seg: 0 },
    { id: "w1", uid: "w1", text: "<b>people", start: 0.35, end: 0.7, seg: 0 },
    { id: "w5", uid: "w5", text: "hand.", start: 1.65, end: 2.0, seg: 1, emphasis: true, emoji: "✋" },
  ],
  groups: [
    { id: "g0", uids: ["w0", "w1"], start: 0.06, end: 1.0 },
    { id: "g1", uids: ["w5"], start: 1.61, end: 2.3 },
  ],
  zooms: [
    { start: 1.1, end: 2.0, scale: 1.2, focus: [0.5, 0.3], type: "punch" },
    { start: 2.5, end: 3.5, scale: 1.15, focus: [0.5, 0.4], type: "smooth" },
  ],
  moments: [],
  layers: [],
  motions: [],
  skipped: [],
};

describe("indexHtml", () => {
  const look = { preset: "warm-daylight", intensity: 0.8 };
  const html = indexHtml(resolved, { pieces, look });

  test("sets the film length and a 1080x1920 canvas", () => {
    expect(html).toContain('data-composition-id="main"');
    expect(html).toMatch(/<div id="root"[^>]*data-duration="4"/);
    expect(html).toContain('data-width="1080"');
    expect(html).toContain('data-height="1920"');
  });

  test("working room makes the editor timeline longer than the reel", () => {
    const roomy = indexHtml(resolved, { pieces, room: 5 });
    expect(roomy).toMatch(/<div id="root"[^>]*data-duration="9"/);
    expect(roomy).toMatch(/<div id="captions"[^>]*data-duration="9"/);
  });

  test("every piece is its own clip of the one source, inside an untimed camera wrapper", () => {
    expect(html).toMatch(/<div id="cam"[^>]*>\s*<video/);
    expect(html).not.toMatch(/<div id="cam"[^>]*data-start/);
    expect(html.match(/<video /g)).toHaveLength(2);
    expect(html).toMatch(/<video id="p2" class="clip" src="assets\/source.mp4"[^>]*data-start="1" data-duration="3" data-media-start="3.5"/);
    expect(html).toMatch(/<video id="p1"[^>]*data-has-audio="true"/);
  });

  test("each piece fades its sound for 30 ms at both ends so cuts never pop", () => {
    expect(pieceTag(pieces[0]!)).toContain('data-fade-in="0.03" data-fade-out="0.03"');
  });

  test("the grade goes on every piece, with a note of what was set automatically", () => {
    const tag = pieceTag(pieces[1]!, look);
    expect(tag).toContain(`data-color-grading='{"preset":"warm-daylight","intensity":0.8}'`);
    expect(tag).toContain(`data-reel-look='{"preset":"warm-daylight","intensity":0.8}'`);
    expect(pieceTag(pieces[1]!)).not.toContain("data-color-grading");
  });

  test("mounts the captions scene on a captions track", () => {
    expect(html).toContain('data-composition-src="compositions/captions.html"');
    expect(html).toContain('data-track-kind="captions"');
  });

  test("a punch zoom cuts in and out, a smooth zoom eases", () => {
    expect(html).toContain('transformOrigin: "50% 30%"');
    expect(html).toContain('tl.set("#cam", { scale: 1.2 }, 1.1)');
    expect(html).toContain('tl.set("#cam", { scale: 1 }, 2)');
    expect(html).toMatch(/tl\.fromTo\("#cam", \{ scale: 1 \}, \{ scale: 1\.15,[^}]*\}, 2\.5\)/);
    expect(html).toContain('window.__timelines["main"] = tl');
  });

  test("the zoom code sits between markers and its fingerprint is on the camera", () => {
    const block = zoomBlock(resolved.zooms, 4);
    expect(html).toContain(`/* reel-zoom:start */\n      ${block}\n      /* reel-zoom:end */`);
    expect(html).toContain(`<div id="cam" data-reel-zoom="${textHash(block)}"`);
  });

  test("a zoom that runs to the end of the film never snaps back for a last frame", () => {
    const block = zoomBlock([{ start: 3, end: 3.95, scale: 1.25, focus: [0.5, 0.4], type: "push" }], 4);
    expect(block).toMatch(/scale: 1\.25, duration: 1,/);
    expect(block).not.toContain('tl.set("#cam", { scale: 1 }');
  });

  test("each sound cue becomes a timed audio clip that remembers where it was put", () => {
    const cues = [
      { id: "sfx-zoom-0", sound: "whoosh-in", file: "whoosh-in.mp3", start: 0.62, mediaStart: 0, duration: 0.62, volume: 0.4 },
      { id: "sfx-sound-0", sound: "typing-long", file: "typing-long.mp3", start: 0, mediaStart: 0.28, duration: 1.5, volume: 0.3, fadeOut: 0.08 },
    ];
    const withSound = indexHtml(resolved, { pieces, cues });
    expect(audioTag(cues[0]!, 2)).toBe(
      '<audio id="sfx-zoom-0" class="clip" src="assets/sfx/whoosh-in.mp3" data-start="0.62" data-duration="0.62" data-track-index="2" data-volume="0.4" data-reel-start="0.62"></audio>',
    );
    expect(withSound).toContain(audioTag(cues[0]!, 2));
    expect(withSound).toMatch(/<audio id="sfx-sound-0"[^>]*data-track-index="3"[^>]*data-media-start="0.28"[^>]*data-fade-out="0.08"/);
    expect(withSound).toMatch(/<div id="root"[^>]*data-reel-sfx="sfx-zoom-0 sfx-sound-0"/);
    expect(indexHtml(resolved, { pieces })).not.toContain("<audio");
  });

  test("a piece of an imported clip plays its own file; a silent one is muted and has no fades", () => {
    const clip = { id: "c-b", start: 4, duration: 2, mediaStart: 0.5, src: "assets/clips/b.mp4" };
    expect(pieceTag(clip)).toMatch(/<video id="c-b" class="clip" src="assets\/clips\/b.mp4" playsinline data-has-audio="true" data-start="4" data-duration="2" data-media-start="0.5" data-fade-in/);
    const silent = pieceTag({ ...clip, muted: true });
    expect(silent).toContain('src="assets/clips/b.mp4" muted playsinline data-start="4"');
    expect(silent).not.toContain("data-fade-in");
    expect(silent).not.toContain("data-has-audio");
  });

  test("an effect copy carries the look plus its effect and a note of where it was put", () => {
    const tag = layerTag({ id: "fx-e0-p1", kind: "fx", start: 0.5, duration: 0.4, mediaStart: 0.5, grading: { effects: { blur: 0.4 } } }, 20, look);
    expect(tag).toContain('<video id="fx-e0-p1" class="clip" src="assets/source.mp4" muted playsinline data-start="0.5" data-duration="0.4" data-media-start="0.5" data-track-index="20"');
    expect(tag).toContain(`data-color-grading='{"preset":"warm-daylight","intensity":0.8,"effects":{"blur":0.4}}'`);
    expect(tag).toContain('data-reel-layer="fx" data-reel-start="0.5" data-reel-length="0.4"');
  });

  test("an insert is silent and full frame unless asked: a window sits in a top corner, volume turns its sound on", () => {
    const base = { id: "ins-0", kind: "insert" as const, src: "assets/clips/b.mp4", start: 2, duration: 1.5, mediaStart: 3 };
    const cover = layerTag({ ...base, mode: "cover" }, 20);
    expect(cover).toContain('src="assets/clips/b.mp4" muted playsinline data-start="2" data-duration="1.5" data-media-start="3"');
    expect(cover).toContain("width: 1080px; height: 1920px");
    expect(layerTag({ ...base, mode: "pip" }, 20)).toMatch(/left: 632px; top: 200px; width: 400px; height: 711px;[^"]*border-radius/);
    expect(layerTag({ ...base, mode: "pip", corner: "top-left" }, 20)).toContain("left: 48px; top: 200px");
    const loud = layerTag({ ...base, mode: "cover", volume: 0.8 }, 21);
    expect(loud).toContain('playsinline data-has-audio="true" data-volume="0.8"');
    expect(loud).not.toContain(" muted");
  });

  test("layers that overlap in time get lanes of their own, above the sounds", () => {
    const at = (id: string, start: number) => ({ id, kind: "fx" as const, start, duration: 1, mediaStart: start });
    const lanes = layerTags([at("fx-a", 0), at("fx-b", 0.5), at("fx-c", 1)]).map((l) => l.tag.match(/data-track-index="(\d+)"/)![1]);
    expect(lanes).toEqual(["20", "21", "20"]);
  });

  test("the camera sits in a stage that transitions move, with a veil above the picture", () => {
    const fx = { id: "fx-e0-p1", kind: "fx" as const, start: 0.2, duration: 0.5, mediaStart: 0.2, grading: { effects: { blur: 0.4 } } };
    const ins = { id: "ins-0", kind: "insert" as const, src: "assets/clips/b.mp4", start: 2, duration: 1, mediaStart: 0, mode: "cover" as const };
    const page = indexHtml({ ...resolved, layers: [fx, ins], motions: [{ kind: "dip", at: 1 }] }, { pieces, look });
    expect(page).toMatch(/<div id="stage" data-reel-motion="[a-z0-9]+"[^>]*>\s*<div id="cam"[^>]*>\s*<video id="p1"[\s\S]*<video id="p2"[^>]*><\/video>\s*<video id="fx-e0-p1"[^>]*><\/video>\s*<\/div>\s*<\/div>\s*<video id="ins-0"[^>]*><\/video>\s*<div id="veil"[^>]*><\/div>\s*<div id="captions"/);
    expect(page).toMatch(/\/\* reel-motion:start \*\/\s*tl\.fromTo\("#veil"[\s\S]*\/\* reel-motion:end \*\//);
    expect(page).toMatch(/data-reel-sfx="fx-e0-p1 ins-0"/);
    expect(html).toMatch(/\/\* reel-motion:start \*\/\s*\/\* reel-motion:end \*\//);
  });

  test("no zoom code when there is none", () => {
    const plain = indexHtml({ ...resolved, zooms: [] }, { pieces });
    expect(plain).not.toContain('"#cam",');
    expect(plain).toContain(`data-reel-zoom="${textHash("")}"`);
  });
});

describe("textHash", () => {
  test("ignores spacing but not content", () => {
    expect(textHash("a  b\n c")).toBe(textHash("a b c"));
    expect(textHash("a b c")).not.toBe(textHash("a b d"));
  });
});

describe("captionsHtml", () => {
  const html = captionsHtml(resolved, { accent: "#FFE600" });

  test("is a scene file: everything inside one template", () => {
    expect(html.trim().startsWith("<template>")).toBe(true);
    expect(html.trim().endsWith("</template>")).toBe(true);
    expect(html).toContain('data-composition-id="captions"');
    expect(html).toContain('window.__timelines["captions"] = tl');
  });

  test("writes each group and word as real markup with stable ids", () => {
    expect(html).toContain('id="cap-g0"');
    expect(html).toContain('id="cap-w0"');
    expect(html).toContain('id="cap-w5"');
    expect(html).toContain("MOST");
  });

  test("escapes transcript text", () => {
    expect(html).toContain("&lt;B&gt;PEOPLE");
    expect(html).not.toContain("<b>people");
  });

  test("places the emoji with its group", () => {
    expect(html).toMatch(/id="cap-g1"[\s\S]*id="cap-e5"[^>]*>✋</);
  });

  test("a caption on screen from frame 0 stands at full size: it is the thumbnail", () => {
    const opening: Resolved = { ...resolved, groups: resolved.groups.map((g, i) => (i === 0 ? { ...g, start: 0 } : g)) };
    for (const style of ["highlight", "reveal"] as const) {
      const out = captionsHtml(opening, { style });
      expect(out).toContain('tl.set("#cap-g0", { visibility: "visible", opacity: 1 }, 0)');
      expect(out).not.toMatch(/tl\.fromTo\("#cap-g0", \{ scale: 0\.86 \}/);
      expect(out).toMatch(/tl\.fromTo\("#cap-g1", \{ scale: 0\.86 \}/);
    }
    const first = resolved.groups[0]!.uids[0]!;
    const reveal = captionsHtml(opening, { style: "reveal" });
    expect(reveal).toContain(`tl.set("#cap-${first}", { opacity: 1 }, 0)`);
    expect(reveal).not.toContain(`tl.fromTo("#cap-${first}", { scale: 0.6 }`);
  });

  test("the emoji pops above the line unless the edit asks for beside it", () => {
    expect(html).toContain('class="cap-group cap-highlight"');
    expect(html).not.toContain("cap-highlight cap-emoji-beside");
    const beside = captionsHtml(resolved, { emoji: "beside" });
    expect(beside).toContain('class="cap-group cap-highlight cap-emoji-beside"');
    // The renderer scopes rules by the root, so the root itself carries no style class.
    expect(beside).toMatch(/<div id="root" data-composition-id="captions"/);
  });

  test("words of an imported clip get page ids of their own, emoji included", () => {
    const withClip: Resolved = {
      ...resolved,
      words: [...resolved.words, { id: "b_w2", uid: "b_w2", text: "here", start: 3, end: 3.3, seg: 2, emoji: "👀" }],
      groups: [...resolved.groups, { id: "g2", uids: ["b_w2"], start: 2.96, end: 3.6 }],
    };
    const out = captionsHtml(withClip);
    expect(out).toContain('id="cap-b_w2"');
    expect(out).toContain('id="cap-e-b_w2"');
  });

  test("shows a group at its start and hard-hides it at its end", () => {
    expect(html).toContain('tl.set("#cap-g0", { visibility: "visible", opacity: 1 }, 0.06)');
    expect(html).toContain('tl.set("#cap-g0", { visibility: "hidden", opacity: 0 }, 1)');
  });

  test("highlights each word while it is spoken; emphasis keeps the accent", () => {
    expect(html).toMatch(/tl\.fromTo\("#cap-w0",[^)]*color: "#FFE600"[^)]*\}, 0\.1\)/);
    expect(html).toMatch(/tl\.fromTo\("#cap-w0",[^)]*color: "#FFFFFF"[^)]*\}, 0\.3\)/);
    expect(html).not.toMatch(/tl\.fromTo\("#cap-w5",[^)]*\}, 2\)/);
  });

  test("can keep the original case", () => {
    expect(captionsHtml(resolved, { uppercase: false })).toContain(">Most<");
  });

  test("a word used twice gets two different ids on the page", () => {
    const twice: Resolved = {
      ...resolved,
      words: [...resolved.words, { id: "w0", uid: "w0-2", text: "Most", start: 3, end: 3.3, seg: 1 }],
      groups: [...resolved.groups, { id: "g2", uids: ["w0-2"], start: 2.96, end: 3.6 }],
    };
    expect(captionsHtml(twice)).toContain('id="cap-w0-2"');
  });
});

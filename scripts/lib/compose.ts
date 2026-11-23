import type { CutWord, Piece, Resolved, Zoom } from "./edit";
import { mergeGrading, motionBlock, type Grading, type Layer } from "./effects";
import type { Cue } from "./sounds";

export const WIDTH = 1080;
export const HEIGHT = 1920;
export const SOURCE = "assets/source.mp4";
const GSAP = "https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js";
const WHITE = "#FFFFFF";

/** Plain number for generated code: at most 3 decimals, no trailing zeros. */
export const n = (x: number) => String(Math.round(x * 1000) / 1000);

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Fingerprint of a piece of generated text, blind to spacing. Used to tell "still as generated" from "changed by hand". */
export function textHash(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  let h = 5381;
  for (let i = 0; i < flat.length; i++) h = ((h << 5) + h + flat.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const json = (value: unknown) => JSON.stringify(value).replace(/'/g, "&#39;");

/**
 * One piece of the cut as a clip on the video track. Every piece plays from
 * the same source file; `data-media-start` says where in it. The 30 ms fades
 * stop the sound popping at a cut. `data-reel-look` records the grade that was
 * set automatically, so a grade changed by hand can be told apart later.
 */
export function pieceTag(piece: Piece, look?: Record<string, unknown>): string {
  const grade = look ? ` data-color-grading='${json(look)}' data-reel-look='${json(look)}'` : "";
  const sound = piece.muted ? "muted playsinline" : `playsinline data-has-audio="true"`;
  const fades = piece.muted ? "" : ` data-fade-in="0.03" data-fade-out="0.03"`;
  return `<video id="${piece.id}" class="clip" src="${piece.src ?? SOURCE}" ${sound} data-start="${n(piece.start)}" data-duration="${n(piece.duration)}" data-media-start="${n(piece.mediaStart)}"${fades} data-track-index="0"${grade} style="${FULL_FRAME}"></video>`;
}

const FULL_FRAME = `position: absolute; left: 0; top: 0; width: ${WIDTH}px; height: ${HEIGHT}px; object-fit: cover`;
/** A small window in a top corner, below the platform's own buttons. */
const PIP_WIDTH = 400;
const PIP_HEIGHT = 711;
const pipStyle = (corner: Layer["corner"]) =>
  `position: absolute; left: ${corner === "top-left" ? 48 : WIDTH - PIP_WIDTH - 48}px; top: 200px; width: ${PIP_WIDTH}px; height: ${PIP_HEIGHT}px; object-fit: cover; border-radius: 32px; border: 6px solid #ffffff; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45)`;

/** The first lane used for picture layers; sounds fill the lanes below it. */
export const LAYER_TRACK = 20;

/**
 * A picture clip laid over the cut: an effect copy of a piece, or an inserted
 * clip. `data-reel-layer` marks it as placed by the pipeline, and
 * `data-reel-start` / `data-reel-length` record where, so one moved or
 * trimmed by hand can be told apart and left alone.
 */
export function layerTag(layer: Layer, trackIndex: number, look?: Grading): string {
  const timing = `data-start="${n(layer.start)}" data-duration="${n(layer.duration)}" data-media-start="${n(layer.mediaStart)}"`;
  const notes = `data-reel-layer="${layer.kind}" data-reel-start="${n(layer.start)}" data-reel-length="${n(layer.duration)}"`;
  const src = layer.src ?? SOURCE;
  if (layer.kind === "fx") {
    const grading = json(mergeGrading(look, layer.grading));
    return `<video id="${layer.id}" class="clip" src="${src}" muted playsinline ${timing} data-track-index="${trackIndex}" data-color-grading='${grading}' data-reel-look='${grading}' ${notes} style="${FULL_FRAME}"></video>`;
  }
  const sound = layer.volume
    ? `playsinline data-has-audio="true" data-volume="${n(layer.volume)}" data-fade-in="0.03" data-fade-out="0.03"`
    : "muted playsinline";
  const style = layer.mode === "pip" ? pipStyle(layer.corner) : FULL_FRAME;
  return `<video id="${layer.id}" class="clip" src="${src}" ${sound} ${timing} data-track-index="${trackIndex}" ${notes} style="${style}"></video>`;
}

/** Tags for a set of layers; layers that overlap in time go on different lanes. */
export function layerTags(layers: Layer[], look?: Grading): { layer: Layer; tag: string }[] {
  const laneEnds: number[] = [];
  return layers.map((layer) => {
    let lane = laneEnds.findIndex((end) => end <= layer.start + 0.0005);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = layer.start + layer.duration;
    return { layer, tag: layerTag(layer, LAYER_TRACK + lane, look) };
  });
}

export const MOTION_START = "/* reel-motion:start */";
export const MOTION_END = "/* reel-motion:end */";
export const VEIL = `<div id="veil" style="position: absolute; inset: 0; opacity: 0; background: #ffffff; pointer-events: none"></div>`;
export const stageOpen = (motion: string) =>
  `<div id="stage" data-reel-motion="${textHash(motion)}" style="position: absolute; inset: 0">`;

/**
 * A sound effect as an audio clip. It needs an id or the renderer leaves it
 * out of the mix. `data-reel-start` records where it was placed automatically.
 */
export function audioTag(cue: Cue, trackIndex: number): string {
  const extra =
    (cue.mediaStart > 0 ? ` data-media-start="${n(cue.mediaStart)}"` : "") +
    (cue.fadeOut ? ` data-fade-out="${n(cue.fadeOut)}"` : "");
  return `<audio id="${cue.id}" class="clip" src="assets/sfx/${cue.file}" data-start="${n(cue.start)}" data-duration="${n(cue.duration)}" data-track-index="${trackIndex}" data-volume="${n(cue.volume)}"${extra} data-reel-start="${n(cue.start)}"></audio>`;
}

/** Audio tags for a set of cues; cues that overlap in time go on different tracks. */
export function audioTags(cues: Cue[]): string[] {
  const trackEnds: number[] = [];
  return cues.map((cue) => {
    let track = trackEnds.findIndex((end) => end <= cue.start);
    if (track < 0) track = trackEnds.length;
    trackEnds[track] = cue.start + cue.duration;
    return audioTag(cue, track + 2);
  });
}

function zoomCode(zoom: Zoom, filmEnd: number): string[] {
  const { start, scale, type } = zoom;
  // A zoom that stops within a few frames of the end runs to the end instead,
  // so the picture never jumps back for the last frames.
  const toEnd = zoom.end >= filmEnd - 0.2;
  const end = toEnd ? filmEnd : zoom.end;
  const length = end - start;
  const origin = `${n(zoom.focus[0] * 100)}% ${n(zoom.focus[1] * 100)}%`;
  const lines = [`tl.set("#cam", { transformOrigin: "${origin}" }, ${n(start)});`];
  const tween = (from: number, to: number, duration: number, ease: string, at: number) =>
    `tl.fromTo("#cam", { scale: ${n(from)} }, { scale: ${n(to)}, duration: ${n(duration)}, ease: "${ease}", immediateRender: false }, ${n(at)});`;

  if (type === "punch") {
    lines.push(`tl.set("#cam", { scale: ${n(scale)} }, ${n(start)});`);
    if (!toEnd) lines.push(`tl.set("#cam", { scale: 1 }, ${n(end)});`);
  } else if (type === "push") {
    lines.push(tween(1, scale, length, "none", start));
    if (!toEnd) lines.push(`tl.set("#cam", { scale: 1 }, ${n(end)});`);
  } else {
    const zoomIn = Math.min(0.4, length * 0.4);
    const zoomOut = Math.min(0.35, length * 0.35);
    lines.push(tween(1, scale, zoomIn, "power2.out", start));
    lines.push(tween(scale, 1, zoomOut, "power2.inOut", end - zoomOut));
  }
  return lines;
}

export const ZOOM_START = "/* reel-zoom:start */";
export const ZOOM_END = "/* reel-zoom:end */";

/** The zoom code that goes between the markers in the root script. */
export function zoomBlock(zooms: Zoom[], filmEnd: number): string {
  return zooms.flatMap((z) => zoomCode(z, filmEnd)).join("\n      ");
}

export type IndexOptions = {
  pieces: Piece[];
  look?: Record<string, unknown>;
  cues?: Cue[];
  /** Empty seconds after the reel, so pieces can be moved around in the editor. */
  room?: number;
};

/**
 * The root composition: every piece of the cut as its own clip inside an
 * untimed camera wrapper (zooms scale the wrapper, never a timed video), which
 * sits in a stage that transitions move; then inserted clips, the veil that
 * flashes and dips, the captions scene, and the sound effects.
 */
export function indexHtml(resolved: Resolved, opts: IndexOptions): string {
  const duration = n(resolved.duration + (opts.room ?? 0));
  const cues = opts.cues ?? [];
  const zooms = zoomBlock(resolved.zooms, resolved.duration);
  const videos = [...opts.pieces]
    .sort((a, b) => a.start - b.start)
    .map((p) => pieceTag(p, opts.look))
    .join("\n          ");
  const audio = audioTags(cues);
  const sounds = audio.length ? `\n      ${audio.join("\n      ")}` : "";
  const layers = layerTags(resolved.layers ?? [], opts.look);
  const copies = layers.filter((l) => l.layer.kind === "fx").map((l) => `\n          ${l.tag}`).join("");
  const inserts = layers.filter((l) => l.layer.kind === "insert").map((l) => `\n      ${l.tag}`).join("");
  const motion = motionBlock(resolved.motions ?? []);
  const known = [...cues.map((c) => c.id), ...layers.map((l) => l.layer.id)].join(" ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${WIDTH}, height=${HEIGHT}" />
    <script src="${GSAP}"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: #000; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${WIDTH}" data-height="${HEIGHT}" data-reel-sfx="${known}">
      ${stageOpen(motion)}
        <div id="cam" data-reel-zoom="${textHash(zooms)}" style="position: absolute; inset: 0">
          ${videos}${copies}
        </div>
      </div>${inserts}
      ${VEIL}
      <div id="captions" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="${duration}" data-track-index="1" data-track-kind="captions" data-width="${WIDTH}" data-height="${HEIGHT}"></div>${sounds}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      ${ZOOM_START}
      ${zooms}
      ${ZOOM_END}
      ${MOTION_START}
      ${motion}
      ${MOTION_END}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
}

export type CaptionOptions = {
  style?: "highlight" | "reveal";
  accent?: string;
  uppercase?: boolean;
  /** Centre line of the captions in px from the top. Default sits 650 px above the bottom edge. */
  y?: number;
  /** Where an emoji pops: above the line (default) or beside it. */
  emoji?: "above" | "beside";
};

const FONT = "Montserrat";
const FONT_WEIGHT = 900;
const BASE_SIZE = 78;
const MAX_LINE = 720;
/** How much the spoken word grows. Kept small so it never touches its neighbours. */
const POP = 1.06;

/** A word as it is shown: trailing punctuation dropped, upper case unless turned off. */
export function captionText(word: Pick<CutWord, "text">, uppercase = true): string {
  const text = word.text.replace(/[.,;:]+$/, "");
  return uppercase ? text.toUpperCase() : text;
}

/**
 * The captions scene. Every group and word is written as markup with a stable
 * id; the timeline only shows, highlights and hides them. One group is visible
 * at a time and each is hard-hidden at its end so none can linger.
 */
export function captionsHtml(resolved: Resolved, opts: CaptionOptions = {}): string {
  const style = opts.style ?? "highlight";
  const accent = opts.accent ?? "#FFE600";
  const uppercase = opts.uppercase ?? true;
  const y = opts.y ?? HEIGHT - 650;
  const filmEnd = resolved.duration;
  // Style classes sit on each group, not on the root: the renderer scopes a
  // sub-composition by its root, so a rule keyed off the root's own class
  // cannot match.
  const groupClass = `cap-group cap-${style}${opts.emoji === "beside" ? " cap-emoji-beside" : ""}`;
  const byUid = new Map(resolved.words.map((w) => [w.uid, w]));

  const markup: string[] = [];
  const code: string[] = [];

  for (const group of resolved.groups) {
    const words = group.uids.map((uid) => byUid.get(uid)!).filter(Boolean);
    const texts = words.map((w) => captionText(w, uppercase));
    const emojiWord = words.find((w) => w.emoji);
    const gid = `cap-${group.id}`;
    const emojiId = emojiWord ? (emojiWord.uid.startsWith("w") ? `cap-e${emojiWord.uid.slice(1)}` : `cap-e-${emojiWord.uid}`) : "";

    const spans = words
      .map((w, i) => {
        const cls = w.emphasis ? "cap-word cap-em" : "cap-word";
        return `<span id="cap-${w.uid}" class="${cls}">${escapeHtml(texts[i]!)}</span>`;
      })
      .join("\n            ");
    const emoji = emojiWord
      ? `\n          <div id="${emojiId}" class="cap-emoji">${escapeHtml(emojiWord.emoji!)}</div>`
      : "";
    markup.push(`<div class="cap-slot">
        <div id="${gid}" class="${groupClass}" data-fit="${escapeHtml(texts.join(" "))}">${emoji}
          <div class="cap-line" data-layout-allow-overflow>
            ${spans}
          </div>
        </div>
      </div>`);

    const end = Math.min(group.end, filmEnd);
    code.push(`tl.set("#${gid}", { visibility: "visible", opacity: 1 }, ${n(group.start)});`);
    // A caption that is on screen from frame 0 is the thumbnail: it stands at
    // full size there instead of being caught mid pop-in.
    const opening = group.start === 0;
    if (!opening) {
      code.push(
        `tl.fromTo("#${gid}", { scale: 0.86 }, { scale: 1, duration: 0.12, ease: "back.out(2)", immediateRender: false }, ${n(group.start)});`,
      );
    }

    for (const [index, w] of words.entries()) {
      const sel = `#cap-${w.uid}`;
      if (style === "reveal") {
        // The first word arrives with its group, so a group is never shown empty.
        const at = index === 0 ? Math.min(w.start, group.start) : w.start;
        code.push(`tl.set("${sel}", { opacity: 1 }, ${n(at)});`);
        if (!(opening && index === 0)) code.push(
          `tl.fromTo("${sel}", { scale: 0.6 }, { scale: 1, duration: 0.14, ease: "back.out(2)", immediateRender: false }, ${n(at)});`,
        );
      } else {
        code.push(
          `tl.fromTo("${sel}", { color: "${WHITE}", scale: 1 }, { color: "${accent}", scale: ${POP}, duration: 0.08, ease: "power2.out", immediateRender: false }, ${n(w.start)});`,
        );
        if (!w.emphasis && w.end < end) {
          code.push(
            `tl.fromTo("${sel}", { color: "${accent}", scale: ${POP} }, { color: "${WHITE}", scale: 1, duration: 0.12, ease: "power2.out", immediateRender: false }, ${n(w.end)});`,
          );
        }
      }
    }

    if (emojiWord) {
      code.push(`tl.set("#${emojiId}", { opacity: 1 }, ${n(emojiWord.start)});`);
      code.push(
        `tl.fromTo("#${emojiId}", { scale: 0.2, rotation: -14 }, { scale: 1, rotation: 0, duration: 0.3, ease: "back.out(2.4)", immediateRender: false }, ${n(emojiWord.start)});`,
      );
    }

    code.push(`tl.set("#${gid}", { visibility: "hidden", opacity: 0 }, ${n(end)});`);
  }

  return `<template>
  <style>
    #root { position: absolute; inset: 0; }
    .cap-slot {
      position: absolute; left: 0; top: ${n(y - 150)}px; width: ${WIDTH}px; height: 300px;
      display: flex; align-items: center; justify-content: center; overflow: visible;
    }
    .cap-group {
      position: relative; visibility: hidden; opacity: 0; overflow: visible;
      font-family: "${FONT}", sans-serif; font-weight: ${FONT_WEIGHT}; font-size: ${BASE_SIZE}px;
    }
    .cap-line {
      display: flex; flex-wrap: nowrap; justify-content: center; align-items: baseline;
      gap: 0.4em; white-space: nowrap; line-height: 1.1;
    }
    .cap-word {
      display: inline-block; color: ${WHITE}; letter-spacing: -0.01em;
      -webkit-text-stroke: 0.13em #000; paint-order: stroke fill;
      text-shadow: 0 0.08em 0.2em rgba(0, 0, 0, 0.55);
    }
    .cap-reveal .cap-word { opacity: 0; }
    .cap-reveal .cap-em { color: ${accent}; }
    .cap-emoji {
      position: absolute; left: 0; right: 0; bottom: 100%; margin-bottom: 0.18em;
      text-align: center; font-size: 1.7em; line-height: 1; opacity: 0;
      -webkit-text-stroke: 0; text-shadow: none;
    }
    .cap-emoji-beside .cap-emoji {
      left: 100%; right: auto; bottom: auto; top: 50%; margin: -0.5em 0 0 0.22em;
      font-size: 1.25em; text-align: left;
    }
  </style>
  <div id="root" data-composition-id="captions" data-width="${WIDTH}" data-height="${HEIGHT}">
      ${markup.join("\n      ")}
  </div>
  <script>
    (function () {
      // Size each group so its line fits the title-safe width.
      var fit = window.__hyperframes && window.__hyperframes.fitTextFontSize;
      document.querySelectorAll(".cap-group").forEach(function (group) {
        var text = group.getAttribute("data-fit") || "";
        var size = ${BASE_SIZE};
        if (fit) {
          size = fit(text, { fontFamily: "${FONT}", fontWeight: ${FONT_WEIGHT}, maxWidth: ${MAX_LINE} }).fontSize;
        } else if (text.length * ${BASE_SIZE} * 0.7 > ${MAX_LINE}) {
          size = Math.max(42, Math.floor(${MAX_LINE} / (text.length * 0.7)));
        }
        group.style.fontSize = size + "px";
      });

      const tl = gsap.timeline({ paused: true });
      ${code.join("\n      ")}
      window.__timelines["captions"] = tl;
    })();
  </script>
</template>
`;
}

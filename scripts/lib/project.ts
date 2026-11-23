/**
 * Reading and patching a reel's index.html while it is open in the editor.
 *
 * The editor and this pipeline share one file. The rule that keeps them from
 * fighting: everything the pipeline places automatically carries a note of the
 * value it wrote. While the live value still equals that note, the item is
 * "still automatic" and may be re-placed when the cut changes. Once the two
 * differ, a person moved it, and it is never touched again.
 */
import {
  audioTag, LAYER_TRACK, layerTag, MOTION_END, MOTION_START, n, pieceTag, SOURCE, stageOpen, textHash, VEIL, ZOOM_END, ZOOM_START,
} from "./compose";
import type { Piece } from "./edit";
import { mergeGrading, type Grading, type Layer } from "./effects";
import type { Cue } from "./sounds";

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const escapeName = (name: string) => name.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
const attrPattern = (name: string) => new RegExp(`\\s${escapeName(name)}=(?:"([^"]*)"|'([^']*)')`);

/** The value of an attribute in an opening tag, entities decoded. */
export function attr(tag: string, name: string): string | undefined {
  const match = tag.match(attrPattern(name));
  if (!match) return undefined;
  return decode(match[1] ?? match[2] ?? "");
}

/** Set, add or (with null) remove one attribute of an opening tag, leaving the rest as it is. */
export function setAttr(tag: string, name: string, value: string | null): string {
  const pattern = attrPattern(name);
  if (value === null) return tag.replace(pattern, "");
  const written = value.includes('"')
    ? ` ${name}='${value.replace(/&/g, "&amp;").replace(/'/g, "&#39;")}'`
    : ` ${name}="${value.replace(/&/g, "&amp;")}"`;
  if (pattern.test(tag)) return tag.replace(pattern, () => written);
  return tag.replace(/\s*(\/?)>$/, (_, slash: string) => `${written}${slash}>`);
}

const same = (a: string | undefined, b: string | undefined) =>
  a !== undefined && b !== undefined && Math.abs(Number(a) - Number(b)) < 0.0015;

/**
 * A piece is any video clip a person can call theirs: the reel's own source or
 * an imported clip. Only the copies and inserts the pipeline lays on top
 * (marked `data-reel-layer`) are not.
 */
const isPiece = (tag: string) =>
  /^<video\b/.test(tag) && attr(tag, "data-reel-layer") === undefined && attr(tag, "data-duration") !== undefined;

const isMuted = (tag: string) => /\smuted(?=[\s=>/])/.test(tag) || Number(attr(tag, "data-volume") ?? 1) === 0;

/** The cut as it stands on the page: every video clip that is not a pipeline layer, in timeline order. */
export function readPieces(html: string): Piece[] {
  const pieces: Piece[] = [];
  for (const [tag] of html.matchAll(/<video\b[^<>]*>/g)) {
    if (!isPiece(tag)) continue;
    const src = attr(tag, "src");
    pieces.push({
      id: attr(tag, "id") ?? `piece-${pieces.length + 1}`,
      start: Number(attr(tag, "data-start") ?? 0),
      duration: Number(attr(tag, "data-duration")),
      mediaStart: Number(attr(tag, "data-media-start") ?? 0),
      ...(src && src !== SOURCE ? { src } : {}),
      ...(isMuted(tag) ? { muted: true } : {}),
    });
  }
  return pieces.sort((a, b) => a.start - b.start);
}

export type Hole = {
  /** The piece before the hole, or null when the reel does not start at 0. */
  after: string | null;
  at: number;
  seconds: number;
};

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Stretches of the reel where no piece plays: black frames and silence in the
 * export. They appear when a piece is deleted or dragged away in the editor
 * and its neighbours are not pulled together. A gap covered by another picture
 * (a title card, b-roll) is deliberate and does not count.
 */
export function findHoles(html: string): Hole[] {
  const covers: [number, number][] = [];
  for (const [tag] of html.matchAll(/<(?:video|img)\b[^<>]*>/g)) {
    if (isPiece(tag) || attr(tag, "data-reel-layer") === "fx") continue;
    const start = Number(attr(tag, "data-start"));
    const duration = Number(attr(tag, "data-duration"));
    if (Number.isFinite(start) && Number.isFinite(duration)) covers.push([start, start + duration]);
  }
  const holes: Hole[] = [];
  let cursor = 0;
  let previous: string | null = null;
  for (const piece of readPieces(html)) {
    const gap = piece.start - cursor;
    // Anything under two frames is rounding, not a hole.
    if (gap > 0.07 && !covers.some(([s, e]) => s < piece.start && e > cursor)) {
      holes.push({ after: previous, at: round3(cursor), seconds: round3(gap) });
    }
    cursor = Math.max(cursor, piece.start + piece.duration);
    previous = piece.id;
  }
  return holes;
}

/** Pull everything after each hole forward so the pieces sit back to back again. */
export function closeHoles(html: string): { html: string; holes: Hole[] } {
  const holes = findHoles(html);
  if (!holes.length) return { html, holes };
  const shiftAt = (t: number) => holes.reduce((sum, h) => (h.at + h.seconds <= t + 0.001 ? sum + h.seconds : sum), 0);
  const moved = html.replace(/<(?:video|audio|img)\b[^<>]*>/g, (tag) => {
    const start = attr(tag, "data-start");
    if (start === undefined) return tag;
    const shift = shiftAt(Number(start));
    if (!shift) return tag;
    let next = setAttr(tag, "data-start", n(Number(start) - shift));
    // An automatic sound stays automatic: its note moves with it.
    const note = attr(tag, "data-reel-start");
    if (note !== undefined) next = setAttr(next, "data-reel-start", n(Number(note) - shift));
    return next;
  });
  return { html: moved, holes };
}

function jsonEqual(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
  } catch {
    return a === b;
  }
}

/** Replace the first opening tag that carries this id. */
function patchTag(html: string, id: string, change: (tag: string) => string): string {
  const pattern = new RegExp(`<[a-zA-Z][\\w-]*\\b[^<>]*\\sid="${escapeName(id)}"[^<>]*>`);
  return html.replace(pattern, (tag) => change(tag));
}

/**
 * Set how long the composition runs: the root and the captions host that spans
 * it. In the editor that is the reel plus working room; for an export it is
 * the reel alone.
 */
export function withLength(html: string, seconds: number): string {
  const length = n(seconds);
  const set = (tag: string) => (same(attr(tag, "data-duration"), length) ? tag : setAttr(tag, "data-duration", length));
  return patchTag(patchTag(html, "root", set), "captions", set);
}

/** Index of the `</div>` that closes the `<div` opening at `open`, or -1. */
function closeOf(html: string, open: number): number {
  const tags = /<div\b|<\/div>/g;
  tags.lastIndex = open;
  let depth = 0;
  for (let m = tags.exec(html); m; m = tags.exec(html)) {
    if (m[0] === "</div>") {
      depth--;
      if (depth === 0) return m.index;
    } else depth++;
  }
  return -1;
}

const openTag = (html: string, id: string) =>
  html.match(new RegExp(`([ \\t]*)<[a-zA-Z][\\w-]*\\b[^<>]*\\sid="${escapeName(id)}"[^<>]*>`));

/**
 * Reels built before transitions existed have no stage around the camera, no
 * veil and no place for motion code. Add them, changing nothing else.
 */
export function ensureStage(html: string): string {
  if (!openTag(html, "stage")) {
    const cam = openTag(html, "cam");
    if (cam?.index === undefined) return html;
    const indent = cam[1]!;
    const open = cam.index + indent.length;
    const close = closeOf(html, open);
    if (close < 0) return html;
    const end = close + "</div>".length;
    html =
      `${html.slice(0, open)}${stageOpen("")}\n${indent}  ${html.slice(open, end)}\n${indent}</div>` +
      `${openTag(html, "veil") ? "" : `\n${indent}${VEIL}`}${html.slice(end)}`;
  }
  if (!html.includes(MOTION_START) && html.includes(ZOOM_END)) {
    html = html.replace(ZOOM_END, () => `${ZOOM_END}\n      ${MOTION_START}\n      \n      ${MOTION_END}`);
  }
  return html;
}

/**
 * A layer the pipeline placed and a person then moved or trimmed is theirs.
 * An insert becomes a clip like any other (so its place is saved with the
 * cut); an effect copy stays a copy but is never re-placed.
 */
export function releaseMoved(html: string): { html: string; notes: string[] } {
  const notes: string[] = [];
  const out = html.replace(/<video\b[^<>]*>/g, (tag) => {
    const kind = attr(tag, "data-reel-layer");
    const start = attr(tag, "data-reel-start");
    if (kind === undefined || start === undefined) return tag;
    const length = attr(tag, "data-reel-length");
    const moved = !same(start, attr(tag, "data-start")) || (length !== undefined && !same(length, attr(tag, "data-duration")));
    if (!moved) return tag;
    const id = attr(tag, "id") ?? "a layer";
    let next = setAttr(setAttr(tag, "data-reel-start", null), "data-reel-length", null);
    if (kind === "insert") {
      next = setAttr(next, "data-reel-layer", null);
      notes.push(`${id} was moved or trimmed by hand: it is a clip of its own now and stays where you put it`);
    } else {
      notes.push(`${id} (an effect) was moved or trimmed by hand: it stays as you left it`);
    }
    return next;
  });
  return { html: out, notes };
}

/** Ids the pipeline has placed on this page at some point: sounds and layers. */
export function knownIds(html: string): string[] {
  return (attr(openTag(html, "root")?.[0] ?? "", "data-reel-sfx") ?? "").split(/\s+/).filter(Boolean);
}

/** Layers a person deleted: placed once, no longer on the page. */
export function droppedLayers(html: string): string[] {
  return knownIds(html).filter((id) => !id.startsWith("sfx-") && !new RegExp(`\\sid="${escapeName(id)}"`).test(html));
}

/**
 * Make room on the timeline: everything that starts at `at` or later moves
 * `seconds` to the right, as if dragged. Automatic items stay automatic.
 */
export function openGap(html: string, at: number, seconds: number): string {
  return html.replace(/<(?:video|audio|img)\b[^<>]*>/g, (tag) => {
    const start = attr(tag, "data-start");
    if (start === undefined || Number(start) < at - 0.001) return tag;
    let next = setAttr(tag, "data-start", n(Number(start) + seconds));
    const note = attr(tag, "data-reel-start");
    if (note !== undefined) next = setAttr(next, "data-reel-start", n(Number(note) + seconds));
    return next;
  });
}

/** Add a piece to the cut: it goes inside the camera, after the pieces already there. */
export function addPiece(html: string, piece: Piece, look?: Grading): string {
  const cam = openTag(html, "cam");
  if (cam?.index === undefined) throw new Error("This reel has no camera to put the clip in. Rebuild it with build --reset.");
  const close = closeOf(html, cam.index + cam[1]!.length);
  const line = html.lastIndexOf("\n", close);
  return `${html.slice(0, line)}\n${cam[1]}  ${pieceTag(piece, look)}${html.slice(line)}`;
}

export type Reflow = {
  /** Length of the film: the end of the last piece. */
  duration: number;
  /** Empty seconds kept after the film in the editor (see workRoom). */
  room?: number;
  /** Where every automatic sound belongs now. */
  cues: Cue[];
  /** The zoom code for the current cut (see zoomBlock). */
  zooms: string;
  /** Effect copies and inserted clips for the current cut. */
  layers?: Layer[];
  /** The transition and motion-effect code for the current cut (see motionBlock). */
  motion?: string;
  /** The grade from edit.json, if any. */
  look?: Record<string, unknown>;
};

type Lane = { track: number; start: number; end: number };

/**
 * Keep a block of generated timeline code up to date, unless a person edited
 * it. The block sits between two markers; a fingerprint of what was written is
 * kept on `holder`.
 */
function syncBlock(
  html: string,
  block: { start: string; end: string; holder: string; attr: string; wanted: string; edited: string; lost: string },
  notes: string[],
): string {
  const holder = openTag(html, block.holder)?.[0];
  const from = html.indexOf(block.start);
  const to = html.indexOf(block.end);
  const wantedHash = textHash(block.wanted);
  if (holder && from >= 0 && to > from) {
    const current = html.slice(from + block.start.length, to);
    const stored = attr(holder, block.attr);
    if (stored !== undefined && textHash(current) === stored) {
      if (stored !== wantedHash) {
        html = `${html.slice(0, from)}${block.start}\n      ${block.wanted}\n      ${html.slice(to)}`;
        html = patchTag(html, block.holder, (tag) => setAttr(tag, block.attr, wantedHash));
      }
    } else if (textHash(current) !== wantedHash) {
      notes.push(block.edited);
    }
  } else if (block.wanted.trim()) {
    notes.push(block.lost);
  }
  return html;
}

/**
 * Bring a page up to date after the cut changed: film length, automatic
 * sounds and layers, zoom and transition code, and grade. Anything changed by
 * hand is left alone and mentioned in `notes`. Returns the page unchanged when
 * nothing needs doing.
 */
export function reflowIndex(html: string, next: Reflow): { html: string; notes: string[] } {
  const notes: string[] = [];
  const layers = next.layers ?? [];
  const motion = next.motion ?? "";
  // Only a reel that uses transitions or effects needs the stage; older reels stay as they are.
  if (motion.trim() || layers.length) html = ensureStage(html);
  html = withLength(html, next.duration + (next.room ?? 0));

  const known = knownIds(html);
  const present = new Set<string>();
  const busy: Lane[] = [];
  const occupy = (tag: string) =>
    busy.push({
      track: Number(attr(tag, "data-track-index") ?? 0),
      start: Number(attr(tag, "data-start") ?? 0),
      end: Number(attr(tag, "data-start") ?? 0) + Number(attr(tag, "data-duration") ?? 0),
    });
  const freeLane = (from: number, start: number, duration: number) => {
    let track = from;
    while (busy.some((b) => b.track === track && b.start < start + duration - 0.0005 && start < b.end - 0.0005)) track++;
    busy.push({ track, start, end: start + duration });
    return track;
  };
  const put = (tag: string, name: string, value: string | null, numeric = true) => {
    const current = attr(tag, name);
    const equal = value === null ? current === undefined : numeric ? same(current, value) : current === value;
    return equal ? tag : setAttr(tag, name, value);
  };

  // --- layers: effect copies and inserted clips ---------------------------
  const wantedLayers = new Map(layers.map((layer) => [layer.id, layer]));
  html = html.replace(/(\n[ \t]*)?<video\b[^<>]*>\s*<\/video>/g, (whole) => {
    const tag = whole.match(/<video\b[^<>]*>/)![0];
    const id = attr(tag, "id");
    const kind = attr(tag, "data-reel-layer");
    if (kind === undefined || !id || attr(tag, "data-reel-start") === undefined) {
      // A piece, or a layer a person took over: not ours to move.
      if (id) present.add(id);
      occupy(tag);
      return whole;
    }
    const layer = wantedLayers.get(id);
    if (!layer) return ""; // its moment is no longer in the reel
    present.add(id);
    let updated = tag;
    updated = put(updated, "data-start", n(layer.start));
    updated = put(updated, "data-duration", n(layer.duration));
    updated = put(updated, "data-media-start", n(layer.mediaStart));
    updated = put(updated, "data-reel-start", n(layer.start));
    updated = put(updated, "data-reel-length", n(layer.duration));
    if (layer.kind === "fx" && jsonEqual(attr(updated, "data-color-grading"), attr(updated, "data-reel-look"))) {
      const grading = JSON.stringify(mergeGrading(next.look, layer.grading));
      if (!jsonEqual(attr(updated, "data-color-grading"), grading)) {
        updated = setAttr(setAttr(updated, "data-color-grading", grading), "data-reel-look", grading);
      }
    }
    occupy(updated);
    return whole.replace(tag, () => updated);
  });

  // --- sounds -------------------------------------------------------------
  const wanted = new Map(next.cues.map((cue) => [cue.id, cue]));
  html = html.replace(/(\n[ \t]*)?<audio\b[^<>]*>\s*<\/audio>/g, (whole) => {
    const tag = whole.match(/<audio\b[^<>]*>/)![0];
    const id = attr(tag, "id");
    if (!id?.startsWith("sfx-")) {
      occupy(tag);
      return whole;
    }
    const auto = attr(tag, "data-reel-start");
    if (auto === undefined) {
      present.add(id);
      occupy(tag);
      return whole;
    }
    if (!same(auto, attr(tag, "data-start"))) {
      present.add(id);
      occupy(tag);
      notes.push(`${id} was moved by hand: it stays where you put it`);
      return whole.replace(tag, setAttr(tag, "data-reel-start", null));
    }
    const cue = wanted.get(id);
    if (!cue) return ""; // its moment is no longer in the reel
    present.add(id);
    let updated = tag;
    updated = put(updated, "data-start", n(cue.start));
    updated = put(updated, "data-duration", n(cue.duration));
    updated = put(updated, "data-media-start", cue.mediaStart > 0 ? n(cue.mediaStart) : null);
    updated = put(updated, "data-fade-out", cue.fadeOut ? n(cue.fadeOut) : null);
    updated = put(updated, "data-reel-start", n(cue.start));
    occupy(updated);
    return whole.replace(tag, updated);
  });

  // Something that was never on the page is new. Something that was, and is
  // gone, was deleted by hand and stays deleted.
  const isNew = (id: string) => !present.has(id) && !known.includes(id);
  const placed: string[] = [];

  const newLayers = layers.filter((layer) => isNew(layer.id));
  const copies = newLayers.filter((layer) => layer.kind === "fx");
  const inserts = newLayers.filter((layer) => layer.kind === "insert");
  const tagFor = (layer: Layer) => layerTag(layer, freeLane(LAYER_TRACK, layer.start, layer.duration), next.look);
  if (copies.length) {
    const cam = openTag(html, "cam");
    const close = cam?.index === undefined ? -1 : closeOf(html, cam.index + cam[1]!.length);
    if (cam && close >= 0) {
      const line = html.lastIndexOf("\n", close);
      html = `${html.slice(0, line)}${copies.map((layer) => `\n${cam[1]}  ${tagFor(layer)}`).join("")}${html.slice(line)}`;
      placed.push(...copies.map((layer) => layer.id));
    } else {
      notes.push("could not find where to add effects: the camera wrapper is missing");
    }
  }
  if (inserts.length) {
    const anchor = openTag(html, "veil") ?? openTag(html, "captions");
    if (anchor?.index !== undefined) {
      const indent = anchor[1]!;
      html = `${html.slice(0, anchor.index)}${inserts.map((layer) => `${indent}${tagFor(layer)}\n`).join("")}${html.slice(anchor.index)}`;
      placed.push(...inserts.map((layer) => layer.id));
    } else {
      notes.push("could not find where to add inserted clips: the captions host is missing");
    }
  }

  const added = next.cues.filter((cue) => isNew(cue.id));
  if (added.length) {
    const tags = added.map((cue) => audioTag(cue, freeLane(2, cue.start, cue.duration)));
    const host = /<div\b[^<>]*\sid="captions"[^<>]*>\s*<\/div>/;
    if (host.test(html)) {
      html = html.replace(host, (found) => `${found}\n      ${tags.join("\n      ")}`);
      placed.push(...added.map((cue) => cue.id));
    } else {
      notes.push("could not find where to add new sounds: the captions host is missing");
    }
  }
  if (placed.length) {
    const list = [...known, ...placed].join(" ");
    html = patchTag(html, "root", (tag) => setAttr(tag, "data-reel-sfx", list));
  }

  // --- zooms and transitions ----------------------------------------------
  html = syncBlock(
    html,
    {
      start: ZOOM_START, end: ZOOM_END, holder: "cam", attr: "data-reel-zoom", wanted: next.zooms,
      edited: "the zoom code was changed by hand: zooms stay as you left them",
      lost: "the zoom markers are gone: zooms stay as they are in the editor",
    },
    notes,
  );
  html = syncBlock(
    html,
    {
      start: MOTION_START, end: MOTION_END, holder: "stage", attr: "data-reel-motion", wanted: motion,
      edited: "the transition code was changed by hand: transitions stay as you left them",
      lost: "the transition markers are gone: transitions stay as they are in the editor",
    },
    notes,
  );

  // --- grade --------------------------------------------------------------
  const look = next.look ? JSON.stringify(next.look) : null;
  html = html.replace(/<video\b[^<>]*>/g, (tag) => {
    if (!isPiece(tag)) return tag;
    const current = attr(tag, "data-color-grading");
    if (!jsonEqual(current, attr(tag, "data-reel-look"))) return tag; // graded by hand
    if (look === null ? current === undefined : jsonEqual(current, look)) return tag;
    return setAttr(setAttr(tag, "data-color-grading", look), "data-reel-look", look);
  });

  return { html, notes };
}

/**
 * Caption words that were retyped by hand in the editor: every word whose text
 * on the page differs from what the pipeline would write. Keys are transcript
 * word ids, ready to merge into `captions.fixes`.
 */
export function captionFixes(captionsHtml: string, expected: Map<string, string>): Record<string, string> {
  const fixes: Record<string, string> = {};
  const span = /<span\b[^<>]*\sid="cap-((?:[a-z0-9-]+_)?w\d+)(?:-\d+)?"[^<>]*>([^<]*)<\/span>/g;
  for (const [, id, raw] of captionsHtml.matchAll(span)) {
    const text = decode(raw!).trim();
    const want = expected.get(id!);
    if (want !== undefined && text && text !== want) fixes[id!] = text;
  }
  return fixes;
}

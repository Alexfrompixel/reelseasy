import {
  copies, effectGrading, EFFECT_NAMES, GLITCH_AFTER, GLITCH_BEFORE, isMotionEffect, TRANSITIONS, transitionSound,
  type Layer, type Motion, type TransitionType,
} from "./effects";
import type { Moment } from "./sounds";
import type { Word } from "./transcript";

export type Range = [number, number];

/** A moment in the SOURCE clip: seconds, or a word id such as "w12". */
export type Anchor = number | string;

export type ZoomType = "smooth" | "punch" | "push";

/**
 * One clip on the timeline: `duration` seconds of the source starting at
 * `mediaStart`, placed at `start`. Pieces can be in any order, and the editor
 * can move, trim, split and delete them.
 */
export type Piece = {
  id: string;
  start: number;
  duration: number;
  mediaStart: number;
  /** The file it plays, relative to the reel folder. Left out for the reel's own source. */
  src?: string;
  /** Plays without its sound, so its words are not captioned. */
  muted?: boolean;
};

/** Where an imported clip lives inside a reel, and which clip a file is. */
export const clipSrc = (name: string) => `assets/clips/${name}.mp4`;
export const clipOf = (src: string | undefined) => src?.match(/^assets\/clips\/(.+)\.mp4$/)?.[1];

/** A second video brought into a reel with `import`. */
export type ClipInfo = { duration: number; sound: boolean; words: number; from?: string };

/** edit.json: every creative decision for one reel, in source time. */
export type Edit = {
  source: string;
  language?: string;
  model?: string;
  /** The first cut: source ranges that stay, in order. */
  keeps: Range[];
  /**
   * The cut as it stands on the timeline, saved back after every change in the
   * editor. When present it replaces `keeps`.
   */
  pieces?: { id: string; start: number; src: Range; file?: string; muted?: boolean }[];
  /** Videos imported into this reel, by name. Written by `import`. */
  clips?: Record<string, ClipInfo>;
  captions?: {
    style?: "highlight" | "reveal";
    maxWords?: number;
    accent?: string;
    uppercase?: boolean;
    /** Caption centre line in px from the top of the 1920 px frame. */
    y?: number;
    /**
     * Where an emoji pops: "above" the caption line (the default), or "beside"
     * it, for close-up footage where above would land on the speaker's mouth.
     */
    emoji?: "above" | "beside";
    /** Corrected spelling per word id, for names the transcript got wrong. */
    fixes?: Record<string, string>;
    /** Word ids that stay in the accent colour after they are spoken. */
    emphasis?: string[];
    /** Word ids spoken but not captioned. */
    hide?: string[];
  };
  zooms?: {
    from: Anchor;
    to: Anchor;
    scale?: number;
    /** Point to zoom toward, as fractions of the frame: [0.5, 0.35] is the face. */
    focus?: [number, number];
    type?: ZoomType;
    /** A sound from sfx/manifest.json played as the zoom starts, e.g. "whoosh-in". */
    sound?: string;
  }[];
  emojis?: { word: string; emoji: string; sound?: string }[];
  /** Sounds from sfx/manifest.json at any moment. `until` trims a long one. */
  sounds?: { at: Anchor; sound: string; volume?: number; until?: Anchor }[];
  /**
   * What happens at a cut. `into` names the piece the cut leads into: a piece
   * id ("p4"), or a word, meaning the piece that holds it.
   */
  transitions?: { into: string; type: TransitionType; sound?: string | false }[];
  /** A picture effect for a moment: glitch, vhs, bw, shake… (see EFFECT_NAMES). */
  effects?: { from: Anchor; to?: Anchor; effect: string; strength?: number; sound?: string }[];
  /**
   * An imported clip shown over the reel while the voice carries on: full
   * frame ("cover") or as a small window ("pip"). `from` is where in the clip
   * to start. Silent unless `volume` is set.
   */
  inserts?: {
    clip: string;
    at: Anchor;
    until?: Anchor;
    from?: number;
    mode?: "cover" | "pip";
    corner?: "top-right" | "top-left";
    volume?: number;
    sound?: string;
  }[];
  /** HyperFrames colour-grading payload, e.g. {"preset":"warm-daylight","intensity":0.8}. */
  look?: Record<string, unknown>;
};

/**
 * A word on the timeline. `id` is the transcript word; `uid` is unique on the
 * page even when the same source range is used in two pieces.
 */
export type CutWord = Word & { uid: string; seg: number; emphasis?: boolean; emoji?: string };
export type Group = { id: string; uids: string[]; start: number; end: number };
export type Zoom = {
  start: number;
  end: number;
  scale: number;
  focus: [number, number];
  type: ZoomType;
};
export type Resolved = {
  duration: number;
  words: CutWord[];
  groups: Group[];
  zooms: Zoom[];
  /** Sounds wanted, on the timeline, in time order. */
  moments: Moment[];
  /** Picture clips laid over the cut: effect copies and inserted clips. */
  layers: Layer[];
  /** Transitions and motion effects, as animation of the whole picture. */
  motions: Motion[];
  /** In lenient mode: what was left out because its anchor is no longer in the reel. */
  skipped: string[];
};

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Propose what to keep: everything except silences of `minSilence` or longer.
 * Each kept range reaches `pad` seconds into the silence around it so words
 * are not clipped, but never past the middle of that silence.
 */
export function speechKeeps(
  silences: Range[],
  duration: number,
  opts: { minSilence?: number; pad?: number; words?: { start: number; end: number }[]; unclear?: number } = {},
): Range[] {
  const minSilence = opts.minSilence ?? 0.45;
  const pad = opts.pad ?? 0.1;
  const long = quietRanges(silences, duration, opts.words, opts.unclear ?? 0.6)
    .filter(([s, e]) => e - s >= minSilence)
    .sort((a, b) => a[0] - b[0]);

  const keeps: Range[] = [];
  let cursor = 0;
  let startPad = 0;
  for (const [s, e] of long) {
    const reach = Math.min(pad, (e - s) / 2);
    if (s > cursor) keeps.push([round(Math.max(0, cursor - startPad)), round(s + reach)]);
    cursor = e;
    startPad = reach;
  }
  if (cursor < duration) keeps.push([round(Math.max(0, cursor - startPad)), round(duration)]);
  return keeps.filter(([s, e]) => e - s >= 0.15);
}

/**
 * The pauses of a clip. Silence alone is not enough on real footage: a room
 * clicks, breathes and hums, which chops one pause into several short
 * silences with blips of sound between them. So when the transcript is known,
 * a stretch of sound counts as speech only if a word falls in it. Sound with
 * no words joins the silence around it, unless it lasts `unclear` seconds or
 * more: that may be speech the transcript missed, so it is kept for a person
 * to judge.
 */
function quietRanges(
  silences: Range[],
  duration: number,
  words: { start: number; end: number }[] | undefined,
  unclear: number,
): Range[] {
  const sorted = [...silences].sort((a, b) => a[0] - b[0]);
  if (!words?.length) return sorted;

  const speech: Range[] = [];
  let cursor = 0;
  const consider = (from: number, to: number) => {
    if (to - from <= 0) return;
    const spoken = words.some((w) => Math.min(w.end, to) - Math.max(w.start, from) > 0);
    if (spoken || to - from >= unclear) speech.push([from, to]);
  };
  for (const [s, e] of sorted) {
    consider(cursor, s);
    cursor = Math.max(cursor, e);
  }
  consider(cursor, duration);

  const quiet: Range[] = [];
  let at = 0;
  for (const [s, e] of speech) {
    if (s > at) quiet.push([at, s]);
    at = e;
  }
  if (at < duration) quiet.push([at, duration]);
  return quiet;
}

/** Remove `cuts` from `keeps`; leftovers shorter than 0.1 s are dropped. */
export function subtractRanges(keeps: Range[], cuts: Range[]): Range[] {
  let out = keeps.map(([s, e]) => [s, e] as Range);
  for (const [cs, ce] of cuts) {
    const next: Range[] = [];
    for (const [s, e] of out) {
      if (ce <= s || cs >= e) {
        next.push([s, e]);
        continue;
      }
      if (cs > s) next.push([s, cs]);
      if (ce < e) next.push([ce, e]);
    }
    out = next;
  }
  return out.filter(([s, e]) => e - s >= 0.1).map(([s, e]) => [round(s), round(e)]);
}

/**
 * Move every cut onto a frame boundary (start earlier, end later), so the
 * picture and the sound of each kept range are exactly the same length.
 * Ranges that touch afterwards are joined.
 */
export function snapKeeps(keeps: Range[], fps = 30, duration = Infinity): Range[] {
  // Times are stored to the millisecond, so a value within that rounding of a
  // frame boundary already sits on it.
  const slack = 0.0006 * fps;
  const frame = (t: number, direction: "down" | "up") => {
    const exact = t * fps;
    const nearest = Math.round(exact);
    if (Math.abs(exact - nearest) <= slack) return nearest;
    return direction === "down" ? Math.floor(exact) : Math.ceil(exact);
  };
  const out: Range[] = [];
  for (const [s, e] of keeps) {
    const start = Math.max(0, frame(s, "down") / fps);
    const end = Math.min(duration, frame(e, "up") / fps);
    if (end - start <= 0) continue;
    const last = out[out.length - 1];
    if (last && start <= last[1] + 1e-6) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out.map(([s, e]) => [round(s), round(e)]);
}

export function cutDuration(keeps: Range[]): number {
  return round(keeps.reduce((sum, [s, e]) => sum + (e - s), 0));
}

/** The first cut as timeline pieces: the kept ranges laid back to back. */
export function piecesFromKeeps(keeps: Range[]): Piece[] {
  let cursor = 0;
  return keeps.map(([s, e], i) => {
    const piece = { id: `p${i + 1}`, start: round(cursor), duration: round(e - s), mediaStart: s };
    cursor += e - s;
    return piece;
  });
}

/** The pieces an edit describes: the cut saved from the editor, else the first proposal. */
export function editPieces(edit: Edit): Piece[] {
  if (edit.pieces?.length) {
    return edit.pieces.map((p) => ({
      id: p.id,
      start: p.start,
      duration: round(p.src[1] - p.src[0]),
      mediaStart: p.src[0],
      ...(p.file ? { src: p.file } : {}),
      ...(p.muted ? { muted: true } : {}),
    }));
  }
  return piecesFromKeeps(edit.keeps);
}

const inOrder = (pieces: Piece[]) => [...pieces].sort((a, b) => a.start - b.start);

export function timelineEnd(pieces: Piece[]): number {
  return round(pieces.reduce((end, p) => Math.max(end, p.start + p.duration), 0));
}

/**
 * Empty seconds kept after the last piece in the editor. The editor refuses to
 * move a clip past the end of the composition, so without room there is
 * nowhere to park a piece while reordering. The export stops at the last
 * piece and never includes this.
 */
export function workRoom(pieces: Piece[]): number {
  const longest = pieces.reduce((max, p) => Math.max(max, p.duration), 0);
  return round(longest + 2);
}

/**
 * Source seconds to seconds on the timeline, wherever that piece now sits.
 * A moment that was cut away snaps to the next kept moment of the source, or
 * to the end of the reel when nothing later was kept.
 */
export function toTimeline(t: number, pieces: Piece[]): number {
  // Seconds are seconds of the reel's own source, never of an imported clip.
  const ordered = inOrder(pieces).filter((p) => !p.src);
  for (const p of ordered) {
    if (t >= p.mediaStart - 1e-6 && t <= p.mediaStart + p.duration + 1e-6) {
      return round(p.start + (t - p.mediaStart));
    }
  }
  const later = ordered
    .filter((p) => p.mediaStart > t)
    .sort((a, b) => a.mediaStart - b.mediaStart)[0];
  return later ? round(later.start) : timelineEnd(pieces);
}

/** Which transcript a piece speaks from: "" is the reel's own source. */
const voiceOf = (src: string | undefined) => (src ? (clipOf(src) ?? "?") : "");

/**
 * The words that are in the reel, in timeline order and retimed. A word is in
 * a piece when its middle is. A word that appears in two pieces keeps its
 * transcript id and gets a numbered uid the second time. Each piece speaks the
 * words of its own file, and a muted piece speaks none.
 */
export function wordsOnTimeline(words: Word[], pieces: Piece[]): CutWord[] {
  const out: CutWord[] = [];
  const seen = new Map<string, number>();
  inOrder(pieces).forEach((p, seg) => {
    if (p.muted) return;
    const from = p.mediaStart;
    const to = p.mediaStart + p.duration;
    const voice = voiceOf(p.src);
    for (const word of words) {
      if ((word.clip ?? "") !== voice) continue;
      const mid = (word.start + word.end) / 2;
      if (mid < from || mid > to) continue;
      const count = (seen.get(word.id) ?? 0) + 1;
      seen.set(word.id, count);
      out.push({
        id: word.id,
        uid: count === 1 ? word.id : `${word.id}-${count}`,
        text: word.text,
        start: round(p.start + Math.max(word.start, from) - from),
        end: round(p.start + Math.min(word.end, to) - from),
        seg,
      });
    }
  });
  // Pieces that overlap in time (a second video over the first) are read as one stream.
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Split words into on-screen groups. A group breaks at the word limit, after
 * punctuation, at a pause, at a cut, or when the line would get too long.
 * Groups never overlap: one is on screen at a time.
 */
export function groupCaptions(
  words: CutWord[],
  opts: { maxWords?: number; maxChars?: number; pause?: number; hold?: number; lead?: number; opening?: number } = {},
): Group[] {
  const maxWords = opts.maxWords ?? 3;
  const maxChars = opts.maxChars ?? 18;
  const pause = opts.pause ?? 0.4;
  const hold = opts.hold ?? 0.3;
  const lead = opts.lead ?? 0.04;

  const chunks: CutWord[][] = [];
  let current: CutWord[] = [];
  const chars = (list: CutWord[]) => list.reduce((n, x) => n + x.text.length, 0) + list.length - 1;

  words.forEach((word, i) => {
    if (current.length && chars([...current, word]) > maxChars) {
      chunks.push(current);
      current = [];
    }
    current.push(word);
    const next = words[i + 1];
    const breaks =
      !next ||
      current.length >= maxWords ||
      /[,.:;!?…]$/.test(word.text) ||
      next.start - word.end >= pause ||
      next.seg !== word.seg;
    if (breaks) {
      chunks.push(current);
      current = [];
    }
  });

  return chunks.map((chunk, i) => {
    const first = chunk[0]!;
    const last = chunk[chunk.length - 1]!;
    const prevEnd = i > 0 ? chunks[i - 1]![chunks[i - 1]!.length - 1]!.end : 0;
    const nextStart = chunks[i + 1]?.[0]!.start;
    // The first frame is the thumbnail: when the reel opens on speech, its
    // caption is there from frame 0, not a few frames in.
    const opening = i === 0 && first.start <= (opts.opening ?? 0.6);
    const start = opening ? 0 : Math.max(first.start - lead, prevEnd, 0);
    const wanted = last.end + hold;
    const end = nextStart === undefined ? wanted : Math.min(wanted, nextStart - lead);
    return {
      id: `g${i}`,
      uids: chunk.map((x) => x.uid),
      start: round(start),
      end: round(Math.max(end, last.end)),
    };
  });
}

/**
 * Turn edit.json plus the source transcript into everything the composition
 * needs, on the timeline. `pieces` is the cut as it stands in the editor;
 * without it the edit's own pieces are used.
 *
 * Strict (the default, for an edit written in chat): throws one error listing
 * every problem. Lenient (after a change made by hand in the editor): an
 * effect whose word was cut away is left out and listed in `skipped`.
 */
export function resolveEdit(
  edit: Edit,
  sourceWords: Word[],
  opts: { pieces?: Piece[]; lenient?: boolean; dropped?: string[] } = {},
): Resolved {
  const problems: string[] = [];
  const skipped: string[] = [];
  const anchorProblem = (text: string) => (opts.lenient ? skipped : problems).push(text);

  const pieces = opts.pieces ?? editPieces(edit);
  const duration = timelineEnd(pieces);
  const byId = new Map(sourceWords.map((x) => [x.id, x]));
  const ordered = inOrder(pieces);
  let kept = wordsOnTimeline(sourceWords, pieces);
  const firstById = new Map<string, CutWord>();
  for (const word of kept) if (!firstById.has(word.id)) firstById.set(word.id, word);
  const layers: Layer[] = [];
  const motions: Motion[] = [];
  const dropped = new Set(opts.dropped ?? []);

  if (!opts.pieces && !edit.pieces?.length) {
    edit.keeps.forEach(([s, e], i) => {
      if (!(e > s)) problems.push(`keeps[${i}] is empty or reversed: [${s}, ${e}]`);
      if (i > 0 && s < edit.keeps[i - 1]![1]) {
        problems.push(`keeps[${i}] starts before keeps[${i - 1}] ends`);
      }
    });
  }

  const needKept = (id: string, what: string): CutWord | undefined => {
    if (!byId.has(id)) {
      anchorProblem(`${what}: word ${id} is not in the transcript`);
      return undefined;
    }
    const word = firstById.get(id);
    if (!word) anchorProblem(`${what}: word ${id} was cut out of the reel`);
    return word;
  };

  const moments: Moment[] = [];
  const spot = (anchor: Anchor, edge: "start" | "end", what: string): number | undefined => {
    if (typeof anchor === "number") return toTimeline(anchor, pieces);
    return needKept(anchor, what)?.[edge];
  };

  // Inserted clips come first: one that plays with sound brings its own words.
  const speaking: Piece[] = [];
  (edit.inserts ?? []).forEach((ins, i) => {
    const what = `inserts[${i}]`;
    const id = `ins-${i}`;
    const clip = edit.clips?.[ins.clip];
    if (!clip) {
      const have = Object.keys(edit.clips ?? {});
      problems.push(`${what}: no clip called "${ins.clip}" was imported into this reel${have.length ? `. Imported: ${have.join(", ")}` : ""}`);
      return;
    }
    // Moved by hand it is a piece of its own now; deleted by hand it stays gone.
    if (dropped.has(id) || pieces.some((p) => p.id === id)) return;
    const start = spot(ins.at, "start", what);
    const until = ins.until === undefined ? undefined : spot(ins.until, "end", what);
    if (start === undefined || (ins.until !== undefined && until === undefined)) return;
    const from = ins.from ?? 0;
    const length = Math.min(until === undefined ? Infinity : until - start, clip.duration - from, duration - start);
    if (!(length >= 0.2)) {
      anchorProblem(`${what}: would show for ${round(Math.max(0, length))}s, needs at least 0.2s`);
      return;
    }
    const volume = clip.sound ? (ins.volume ?? 0) : 0;
    layers.push({
      id,
      kind: "insert",
      src: clipSrc(ins.clip),
      start,
      duration: round(length),
      mediaStart: from,
      mode: ins.mode ?? "cover",
      ...(ins.corner ? { corner: ins.corner } : {}),
      ...(volume > 0 ? { volume } : {}),
    });
    if (volume > 0) speaking.push({ id, start, duration: round(length), mediaStart: from, src: clipSrc(ins.clip) });
    if (ins.sound) moments.push({ key: `ins-${i}`, at: start, sound: ins.sound });
  });
  if (speaking.length) {
    kept = wordsOnTimeline(sourceWords, [...pieces, ...speaking]);
    for (const word of kept) if (!firstById.has(word.id)) firstById.set(word.id, word);
  }

  const captions = edit.captions ?? {};
  const hidden = new Set(captions.hide ?? []);
  const emphasis = new Set(captions.emphasis ?? []);
  for (const id of emphasis) needKept(id, "emphasis");
  for (const id of Object.keys(captions.fixes ?? {})) {
    if (!byId.has(id)) anchorProblem(`fixes: word ${id} is not in the transcript`);
  }

  const emojiByUid = new Map<string, string>();
  for (const item of edit.emojis ?? []) {
    const word = needKept(item.word, "emoji");
    if (!word) continue;
    emojiByUid.set(word.uid, item.emoji);
    if (item.sound) moments.push({ key: `emoji-${item.word}`, at: word.start, sound: item.sound });
  }

  const words: CutWord[] = kept
    .filter((x) => !hidden.has(x.id))
    .map((x) => ({
      ...x,
      text: captions.fixes?.[x.id] ?? x.text,
      ...(emphasis.has(x.id) ? { emphasis: true } : {}),
      ...(emojiByUid.has(x.uid) ? { emoji: emojiByUid.get(x.uid)! } : {}),
    }));

  const at = spot;

  const zooms: Zoom[] = [];
  const zoomSounds: Moment[] = [];
  (edit.zooms ?? []).forEach((z, i) => {
    const what = `zooms[${i}]`;
    const start = at(z.from, "start", what);
    const end = at(z.to, "end", what);
    const scale = z.scale ?? 1.15;
    if (scale <= 1 || scale > 2) problems.push(`${what}: scale ${scale} must be above 1 and at most 2`);
    if (start === undefined || end === undefined) return;
    if (end - start < 0.2) {
      anchorProblem(`${what}: lasts ${round(end - start)}s on the timeline, needs at least 0.2s`);
      return;
    }
    zooms.push({ start, end, scale, focus: z.focus ?? [0.5, 0.38], type: z.type ?? "smooth" });
    if (z.sound) zoomSounds.push({ key: `zoom-${i}`, at: start, sound: z.sound });
  });
  zooms.sort((a, b) => a.start - b.start);
  for (let i = 1; i < zooms.length; i++) {
    if (zooms[i]!.start < zooms[i - 1]!.end) {
      const text = `zooms overlap: one ends at ${zooms[i - 1]!.end}s, the next starts at ${zooms[i]!.start}s`;
      if (!opts.lenient) {
        problems.push(text);
        continue;
      }
      // After a reorder by hand two zooms can collide: keep the earlier one.
      skipped.push(text);
      zooms.splice(i, 1);
      i--;
    }
  }
  moments.push(...zoomSounds);

  (edit.sounds ?? []).forEach((s, i) => {
    const what = `sounds[${i}]`;
    const start = at(s.at, "start", what);
    const until = s.until === undefined ? undefined : at(s.until, "end", what);
    if (start === undefined || (s.until !== undefined && until === undefined)) return;
    if (until !== undefined && until <= start) {
      anchorProblem(`${what}: "until" is not after "at"`);
      return;
    }
    moments.push({
      key: `sound-${i}`,
      at: start,
      sound: s.sound,
      ...(until !== undefined ? { until } : {}),
      ...(s.volume !== undefined ? { volume: s.volume } : {}),
    });
  });
  const usedCuts = new Set<string>();
  (edit.transitions ?? []).forEach((tr, i) => {
    const what = `transitions[${i}]`;
    if (!(TRANSITIONS as readonly string[]).includes(tr.type)) {
      problems.push(`${what}: unknown type "${tr.type}". Use one of: ${TRANSITIONS.join(", ")}`);
      return;
    }
    let piece = ordered.find((p) => p.id === tr.into);
    if (!piece) {
      if (!byId.has(tr.into)) {
        anchorProblem(`${what}: "${tr.into}" is neither a piece nor a word of this reel`);
        return;
      }
      const word = needKept(tr.into, what);
      if (!word) return;
      piece = ordered.find((p) => !p.muted && word.start >= p.start - 0.001 && word.start < p.start + p.duration);
      if (!piece) return;
    }
    if (ordered.indexOf(piece) === 0) {
      anchorProblem(`${what}: ${piece.id} opens the reel, so there is no cut before it`);
      return;
    }
    if (usedCuts.has(piece.id)) {
      problems.push(`${what}: the cut into ${piece.id} already has a transition`);
      return;
    }
    usedCuts.add(piece.id);
    const cut = piece.start;
    motions.push({ kind: tr.type, at: cut });
    if (tr.type === "glitch") {
      layers.push(...copies(`t-${piece.id}`, cut - GLITCH_BEFORE, cut + GLITCH_AFTER, ordered, effectGrading("glitch", 0.7)!));
    }
    const sound = transitionSound(tr.type, tr.sound);
    // A transition is over in a moment, so its sound is too, however long the file runs.
    if (sound) moments.push({ key: `trans-${piece.id}`, at: cut, sound, until: round(cut + 0.6) });
  });

  (edit.effects ?? []).forEach((fx, i) => {
    const what = `effects[${i}]`;
    if (!EFFECT_NAMES.includes(fx.effect)) {
      problems.push(`${what}: unknown effect "${fx.effect}". Use one of: ${EFFECT_NAMES.join(", ")}`);
      return;
    }
    const strength = fx.strength ?? 0.5;
    if (!(strength > 0 && strength <= 1)) problems.push(`${what}: strength ${strength} must be above 0 and at most 1`);
    if (fx.effect !== "flash" && fx.to === undefined) {
      problems.push(`${what}: needs "to", the moment the ${fx.effect} ends`);
      return;
    }
    const start = at(fx.from, "start", what);
    const end = fx.to === undefined ? undefined : at(fx.to, "end", what);
    if (start === undefined || (fx.to !== undefined && end === undefined)) return;
    if (fx.effect === "flash") {
      motions.push({ kind: "flash", at: start });
    } else if (end! - start < 0.1) {
      anchorProblem(`${what}: lasts ${round(end! - start)}s on the timeline, needs at least 0.1s`);
      return;
    } else if (isMotionEffect(fx.effect)) {
      motions.push({ kind: "shake", at: start, until: end! });
    } else {
      layers.push(...copies(`e${i}`, start, end!, ordered, effectGrading(fx.effect, strength)!));
    }
    // The sound of an effect ends with it.
    if (fx.sound) moments.push({ key: `fx-${i}`, at: start, sound: fx.sound, ...(end !== undefined ? { until: end } : {}) });
  });

  moments.sort((a, b) => a.at - b.at);
  layers.sort((a, b) => a.start - b.start);
  motions.sort((a, b) => a.at - b.at);

  if (problems.length) throw new Error(`edit.json has problems:\n- ${problems.join("\n- ")}`);

  const groups = groupCaptions(words, { maxWords: captions.maxWords ?? 3 });
  return { duration, words, groups, zooms, moments, layers, motions, skipped: [...new Set(skipped)] };
}

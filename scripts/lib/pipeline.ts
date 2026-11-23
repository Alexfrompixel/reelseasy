/**
 * The steps of making a reel, shared by the command line and the app:
 * ingest a clip, apply an edit, watch a reel that is open in the editor,
 * render.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, watch } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { captionsHtml, captionText, indexHtml, zoomBlock } from "./compose";
import {
  clipSrc,
  cutDuration,
  editPieces,
  piecesFromKeeps,
  resolveEdit,
  snapKeeps,
  speechKeeps,
  timelineEnd,
  workRoom,
  type Edit,
  type Piece,
} from "./edit";
import {
  displaySize, FPS, isHdr, levelFilter, levelGain, normaliseArgs, parseSilences, slugify, targetSize, TARGET_LUFS,
  type Level, type ProbeStream, type Size,
} from "./media";
import { motionBlock } from "./effects";
import {
  addPiece, captionFixes, closeHoles, droppedLayers, findHoles, openGap, readPieces, reflowIndex, releaseMoved, withLength,
} from "./project";
import { planCues, type SoundInfo } from "./sounds";
import { packTranscript, snapWordsToSpeech, wordsFromWhisper, type Word } from "./transcript";

export const ROOT = resolve(import.meta.dir, "../..");

const hyperframes = (root: string) => join(root, "node_modules/.bin/hyperframes");
const reelDir = (root: string, slug: string) => join(root, "reels", slug);
const readJson = async <T>(path: string) => (await Bun.file(path).json()) as T;
const pretty = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

export async function run(cmd: string[], opts: { cwd?: string; quiet?: boolean } = {}) {
  // HyperFrames reports usage to its maker unless told not to. Nothing here leaves this Mac.
  const env = { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1" };
  const proc = Bun.spawn(cmd, { cwd: opts.cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0 && !opts.quiet) {
    throw new Error(`${basename(cmd[0]!)} failed (exit ${code}):\n${(stderr || stdout).trim().slice(-2000)}`);
  }
  return { stdout, stderr, code };
}

export async function probe(file: string) {
  const { stdout } = await run([
    "ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file,
  ]);
  const data = JSON.parse(stdout) as {
    format: { duration: string };
    streams: (ProbeStream & { codec_type: string; codec_name: string })[];
  };
  const video = data.streams.find((s) => s.codec_type === "video");
  const audio = data.streams.find((s) => s.codec_type === "audio");
  if (!video) throw new Error(`${file} has no video stream`);
  return { duration: Number(data.format.duration), video, audio };
}

/** Write a file only when its content would change, so watchers stay quiet. */
async function writeIfChanged(path: string, content: string): Promise<boolean> {
  const file = Bun.file(path);
  if ((await file.exists()) && (await file.text()) === content) return false;
  await Bun.write(path, content);
  return true;
}

// ---------------------------------------------------------------------------
// Apply: bring a reel's project in line with edit.json and with the timeline.
// ---------------------------------------------------------------------------

export type Summary = {
  slug: string;
  /** True when the project was written from scratch, false when it was updated in place. */
  fresh: boolean;
  /** True when index.html or the captions were rewritten. */
  changed: boolean;
  duration: number;
  pieces: number;
  groups: number;
  sounds: number;
  /** Effect copies and inserted clips placed on top of the cut. */
  layers: number;
  /** Transitions and motion effects. */
  motions: number;
  /** Things left alone because they were changed by hand. */
  notes: string[];
  /** Effects left out because their word is no longer in the reel. */
  skipped: string[];
  captions: string[];
};

/**
 * Make the project match the edit.
 *
 * First time (or with `reset`): write index.html and the captions from
 * edit.json. After that the project is shared with the editor, so it is
 * updated in place: the cut is read from the timeline, captions are rebuilt
 * for it, and sounds, zooms and grade are re-placed unless they were changed
 * by hand. Either way the cut is saved back into edit.json.
 */
export async function applyReel(
  slug: string,
  opts: { root?: string; reset?: boolean; closeHoles?: boolean } = {},
): Promise<Summary> {
  const root = opts.root ?? ROOT;
  const dir = reelDir(root, slug);
  const editPath = join(dir, "edit.json");
  if (!existsSync(editPath)) throw new Error(`No edit.json in reels/${slug}. Ingest a clip first.`);
  const edit = await readJson<Edit>(editPath);
  const words = await readJson<Word[]>(join(dir, "work", "words.json"));
  // Imported clips bring their own words.
  for (const name of Object.keys(edit.clips ?? {})) {
    const file = join(dir, "work", "clips", `${name}.words.json`);
    if (existsSync(file)) words.push(...(await readJson<Word[]>(file)));
  }
  const pack = await readJson<Record<string, SoundInfo>>(join(root, "sfx", "manifest.json"));

  const indexPath = join(dir, "index.html");
  const captionsPath = join(dir, "compositions", "captions.html");
  const fresh = opts.reset === true || !existsSync(indexPath);
  mkdirSync(join(dir, "compositions"), { recursive: true });

  let pieces: Piece[];
  let notes: string[] = [];
  let changed = false;
  let index: string;

  if (fresh) {
    // An insert that was moved by hand was saved with the cut; a rebuild places it from edit.json again.
    pieces = edit.pieces?.length
      ? editPieces(edit).filter((p) => !/^ins-\d+$/.test(p.id))
      : piecesFromKeeps(snapKeeps(edit.keeps, FPS));
    if (!pieces.length) throw new Error("edit.json keeps nothing: the reel would be empty.");
    // A first cut written in chat is checked strictly. A cut that came back
    // from the editor may have lost words that effects point at: skip those.
    const resolved = resolveEdit(edit, words, { pieces, lenient: Boolean(edit.pieces?.length) });
    const cues = planCues(resolved.moments, pack, resolved.duration);
    index = indexHtml(resolved, { pieces, look: edit.look, cues, room: workRoom(pieces) });
    changed = (await writeIfChanged(indexPath, index)) || changed;
    changed = (await writeIfChanged(captionsPath, captionsHtml(resolved, edit.captions))) || changed;
    return finish(resolved, cues.length, resolved.skipped);
  }

  let before = await Bun.file(indexPath).text();
  // A piece deleted or dragged away leaves a hole: black frames in the reel.
  // While editing that is the user's layout and is only reported. An export
  // closes it, because nobody wants black in the finished video.
  const holeNotes: string[] = [];
  const where = (after: string | null) => (after ? `after ${after.toUpperCase()}` : "at the start");
  if (opts.closeHoles) {
    const closed = closeHoles(before);
    before = closed.html;
    for (const h of closed.holes) holeNotes.push(`closed a hole of ${h.seconds.toFixed(2)}s ${where(h.after)}`);
  } else {
    for (const h of findHoles(before)) {
      holeNotes.push(`hole of ${h.seconds.toFixed(2)}s ${where(h.after)}: black in the reel until the pieces are pulled together (exporting closes it)`);
    }
  }
  // A layer moved or trimmed by hand stops being ours before the cut is read.
  const released = releaseMoved(before);
  before = released.html;
  pieces = readPieces(before);
  if (!pieces.length) throw new Error(`reels/${slug} has no pieces left on its timeline.`);

  // Caption words retyped in the editor become fixes before captions are rebuilt.
  if (existsSync(captionsPath)) {
    const uppercase = edit.captions?.uppercase ?? true;
    const expected = new Map(
      words.map((w) => [w.id, captionText({ text: edit.captions?.fixes?.[w.id] ?? w.text }, uppercase)]),
    );
    const typed = captionFixes(await Bun.file(captionsPath).text(), expected);
    if (Object.keys(typed).length) {
      edit.captions = { ...edit.captions, fixes: { ...edit.captions?.fixes, ...typed } };
    }
  }

  const resolved = resolveEdit(edit, words, { pieces, lenient: true, dropped: droppedLayers(before) });
  const cues = planCues(resolved.moments, pack, resolved.duration);
  const flowed = reflowIndex(before, {
    duration: resolved.duration,
    room: workRoom(pieces),
    cues,
    zooms: zoomBlock(resolved.zooms, resolved.duration),
    layers: resolved.layers,
    motion: motionBlock(resolved.motions),
    look: edit.look,
  });
  index = flowed.html;
  notes = [...holeNotes, ...released.notes, ...flowed.notes];
  changed = (await writeIfChanged(indexPath, index)) || changed;
  changed = (await writeIfChanged(captionsPath, captionsHtml(resolved, edit.captions))) || changed;
  return finish(resolved, cues.length, resolved.skipped);

  async function finish(resolved: ReturnType<typeof resolveEdit>, sounds: number, skipped: string[]): Promise<Summary> {
    // Every sound the page uses must exist inside the reel.
    for (const [, file] of index.matchAll(/src="assets\/sfx\/([^"]+)"/g)) {
      const target = join(dir, "assets", "sfx", file!);
      const origin = join(root, "sfx", file!);
      if (!existsSync(target) && existsSync(origin)) {
        mkdirSync(join(dir, "assets", "sfx"), { recursive: true });
        copyFileSync(origin, target);
      }
    }
    // Save the cut as it stands, so edit.json always describes the whole reel.
    edit.pieces = pieces.map((p) => ({
      id: p.id,
      start: p.start,
      src: [p.mediaStart, Math.round((p.mediaStart + p.duration) * 1000) / 1000],
      ...(p.src ? { file: p.src } : {}),
      ...(p.muted ? { muted: true } : {}),
    }));
    await writeIfChanged(editPath, pretty(edit));

    const byUid = new Map(resolved.words.map((w) => [w.uid, w]));
    return {
      slug,
      fresh,
      changed,
      duration: resolved.duration,
      pieces: pieces.length,
      groups: resolved.groups.length,
      sounds,
      layers: resolved.layers.length,
      motions: resolved.motions.length,
      notes,
      skipped,
      captions: resolved.groups.map(
        (g) => `${g.start.toFixed(2)}-${g.end.toFixed(2)}  ${g.uids.map((uid) => byUid.get(uid)!.text).join(" ")}`,
      ),
    };
  }
}

/**
 * Keep a reel in step while it is open in the editor: whenever the timeline
 * or edit.json changes, apply again. Applying writes nothing when nothing
 * needs to change, so this settles after one pass.
 */
export function watchReel(
  slug: string,
  opts: { root?: string; onApply?: (summary: Summary) => void; onError?: (error: Error) => void } = {},
): { close: () => void } {
  const root = opts.root ?? ROOT;
  const dir = reelDir(root, slug);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let again = false;

  const apply = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      const summary = await applyReel(slug, { root });
      if (summary.changed) opts.onApply?.(summary);
    } catch (error) {
      opts.onError?.(error as Error);
    } finally {
      running = false;
      if (again) {
        again = false;
        schedule();
      }
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(apply, 300);
  };

  // The editor saves through a temporary file ("index.html.hf1a2b.tmp") that it
  // then renames, and the rename is reported under the temporary name. So match
  // on how the name starts, not on the exact name.
  const touches = (file: string | null, name: string) => typeof file === "string" && file.startsWith(name);
  const watcher = watch(dir, (_event, file) => {
    if (touches(file, "index.html") || touches(file, "edit.json")) schedule();
  });
  const captions = existsSync(join(dir, "compositions"))
    ? watch(join(dir, "compositions"), (_event, file) => {
        if (touches(file, "captions.html")) schedule();
      })
    : undefined;
  return {
    close: () => {
      clearTimeout(timer);
      watcher.close();
      captions?.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Ingest: a raw clip becomes a reel folder with a transcript and a first cut.
// ---------------------------------------------------------------------------

/** iPhone HDR (HLG / Dolby Vision) looks washed out unless it is tone-mapped to SDR first. */
async function toSdr(source: string, size: Size, out: string) {
  const preset = Math.max(size.width, size.height) > 1920 ? "Preset3840x2160" : "Preset1920x1080";
  await run(["avconvert", "--source", source, "--output", out, "--preset", preset, "--replace"]);
}

/** Loudness of a file as ffmpeg measures it, or undefined when it has no measurable sound. */
async function measureLoudness(file: string) {
  const out = await run(["ffmpeg", "-hide_banner", "-i", file, "-vn", "-af", "loudnorm=print_format=json", "-f", "null", "-"]);
  const stats = out.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/)?.[0];
  if (!stats) return undefined;
  const json = JSON.parse(stats) as { input_i: string; input_tp: string };
  return { integrated: Number(json.input_i), truePeak: Number(json.input_tp) };
}

/**
 * Write `out` as `raw` with its sound levelled to -14 LUFS. One fixed gain
 * from a measurement of the whole file, so the voice never pumps. Phone sound
 * is quiet with loud peaks, so a limiter holds the peaks; limiting costs a
 * little loudness, which up to two more passes make up for.
 */
async function levelInto(raw: string, out: string): Promise<Level> {
  const level = async (plan: Level) =>
    run([
      "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", raw,
      "-c:v", "copy", "-af", levelFilter(plan), "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out,
    ]);
  const before = await measureLoudness(raw);
  let plan = before ? levelGain(before.integrated, before.truePeak) : { gain: 0, limit: false };
  await level(plan);
  for (let pass = 0; plan.limit && pass < 2; pass++) {
    const after = await measureLoudness(out);
    const short = after ? TARGET_LUFS - after.integrated : 0;
    if (!Number.isFinite(short) || short <= 0.5) break;
    plan = { gain: Math.round((plan.gain + Math.min(short, 3)) * 10) / 10, limit: true };
    await level(plan);
  }
  return plan;
}

async function detectSilences(file: string, duration: number) {
  const detect = await run(
    ["ffmpeg", "-hide_banner", "-i", file, "-vn", "-af", "silencedetect=noise=-35dB:d=0.25", "-f", "null", "-"],
  );
  return parseSilences(detect.stderr, duration);
}

type SpeechOptions = { language?: string; engine?: string; model?: string };

/**
 * Words of a clip, timed. Parakeet (25 European languages) times words far
 * better than Whisper, which drifts by a second or more around pauses. Whisper
 * is the fallback for other languages: engine "whisper", model "large-v3",
 * plus a language. `dir` is where the transcript file is written.
 */
async function transcribe(root: string, source: string, dir: string, silences: [number, number][], duration: number, opts: SpeechOptions) {
  const engine = opts.engine ?? "parakeet";
  const cmd = [hyperframes(root), "transcribe", source, "--dir", dir, "--engine", engine, "--json"];
  if (engine === "whisper") {
    cmd.push("--model", opts.model ?? (!opts.language || opts.language === "en" ? "small.en" : "large-v3"));
  }
  if (opts.language) cmd.push("--language", opts.language);
  const result = JSON.parse((await run(cmd)).stdout.trim().split("\n").pop()!) as { transcriptPath: string };
  return snapWordsToSpeech(wordsFromWhisper(await readJson(result.transcriptPath)), silences, duration);
}

export type IngestOptions = {
  root?: string;
  name?: string;
  language?: string;
  engine?: string;
  model?: string;
  log?: (line: string) => void;
};

export async function ingestClip(clip: string, opts: IngestOptions = {}) {
  const root = opts.root ?? ROOT;
  const log = opts.log ?? (() => {});
  const source = resolve(clip);
  if (!existsSync(source)) throw new Error(`No such file: ${source}`);

  const slug = opts.name ?? slugify(source);
  const dir = reelDir(root, slug);
  const work = join(dir, "work");
  mkdirSync(join(dir, "compositions"), { recursive: true });
  mkdirSync(join(dir, "assets"), { recursive: true });
  mkdirSync(work, { recursive: true });

  const info = await probe(source);
  const size = displaySize(info.video);
  if (!info.audio) throw new Error("This clip has no sound, so there is nothing to transcribe or cut on.");

  let picture = source;
  if (isHdr(info.video)) {
    picture = join(work, "source-sdr.mov");
    log(`HDR footage (${info.video.color_transfer}): converting to SDR first…`);
    await toSdr(source, size, picture);
  }

  await Bun.write(
    join(dir, "hyperframes.json"),
    pretty({
      $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
      registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
      paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
      media: { autoProxy: true },
    }),
  );
  await Bun.write(join(dir, "meta.json"), pretty({ id: slug, name: slug, createdAt: new Date().toISOString() }));

  const silences = await detectSilences(source, info.duration);
  await Bun.write(join(work, "silences.json"), pretty(silences));

  log(`Transcribing with ${opts.engine ?? "parakeet"}…`);
  const words = await transcribe(root, source, dir, silences, info.duration, opts);
  await Bun.write(join(work, "words.json"), pretty(words));

  // The working copy: the whole clip, uncut. Every piece on the timeline plays from it.
  log("Preparing the working copy…");
  const working = join(dir, "assets", "source.mp4");
  const raw = join(work, "source-raw.mp4");
  const target = targetSize(size);
  await run(["ffmpeg", ...normaliseArgs({ source: picture, output: raw, size: target })]);
  const plan = await levelInto(raw, working);
  const gain = plan.gain;
  await Bun.file(raw).delete();
  const length = (await probe(working)).duration;

  const keeps = snapKeeps(speechKeeps(silences, length, { words }), FPS, length);
  const editPath = join(dir, "edit.json");
  if (!existsSync(editPath)) {
    const edit: Edit = {
      source: relative(root, source),
      ...(opts.language ? { language: opts.language } : {}),
      keeps,
      captions: { style: "highlight", maxWords: 3, accent: "#FFE600", fixes: {}, emphasis: [], hide: [] },
      zooms: [],
      emojis: [],
      sounds: [],
    };
    await Bun.write(editPath, pretty(edit));
  }

  return {
    slug,
    size,
    working: target,
    duration: length,
    codec: info.video.codec_name,
    words: words.length,
    keeps,
    kept: cutDuration(keeps),
    gain,
    limited: plan.limit,
    transcript: packTranscript(words, 0.4, silences),
  };
}

// ---------------------------------------------------------------------------
// Import: a second video becomes a clip inside an existing reel.
// ---------------------------------------------------------------------------

export type ImportOptions = SpeechOptions & {
  root?: string;
  /** Name of the clip inside the reel. Default: from the file name. */
  name?: string;
  /**
   * Where it goes on the timeline: "end" (the default) adds it after the last
   * piece, a piece id puts it right after that piece and moves the rest along,
   * "none" only makes it available to `inserts` in edit.json.
   */
  place?: string;
  /** Use only this part of the clip, in seconds of the clip. Default: all of it. */
  from?: number;
  to?: number;
  log?: (line: string) => void;
};

/**
 * Bring another video into a reel. It is converted the same way as the reel's
 * own clip (upright, 9:16, 30 fps, SDR, sound levelled), transcribed so its
 * speech gets captions, and put on the timeline as a piece like any other.
 */
export async function importClip(slug: string, clip: string, opts: ImportOptions = {}) {
  const root = opts.root ?? ROOT;
  const log = opts.log ?? (() => {});
  const dir = reelDir(root, slug);
  const editPath = join(dir, "edit.json");
  if (!existsSync(editPath)) throw new Error(`There is no reel called ${slug}. Start one first.`);
  const source = resolve(clip);
  if (!existsSync(source)) throw new Error(`No such file: ${source}`);
  const origin = relative(root, source);

  let edit = await readJson<Edit>(editPath);
  // The same file imported again replaces itself; a different file with the same name gets a number.
  const wanted = opts.name ?? (slugify(source) || "clip");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(wanted)) throw new Error(`"${wanted}" is not a usable clip name: use lower-case letters, digits and dashes.`);
  let name = wanted;
  for (let i = 2; edit.clips?.[name] && edit.clips[name]!.from !== origin; i++) name = `${wanted}-${i}`;

  const work = join(dir, "work", "clips", name);
  mkdirSync(work, { recursive: true });
  mkdirSync(join(dir, "assets", "clips"), { recursive: true });
  const info = await probe(source);
  const size = displaySize(info.video);
  const sound = Boolean(info.audio);

  let picture = source;
  if (isHdr(info.video)) {
    picture = join(work, "source-sdr.mov");
    log(`HDR footage (${info.video.color_transfer}): converting to SDR first…`);
    await toSdr(source, size, picture);
  }
  log("Converting the clip…");
  const output = join(dir, clipSrc(name));
  const raw = join(work, "raw.mp4");
  await run(["ffmpeg", ...normaliseArgs({ source: picture, output: raw, size: targetSize(size), sound })]);
  let level: Level | undefined;
  if (sound) {
    level = await levelInto(raw, output);
    await Bun.file(raw).delete();
  } else {
    renameSync(raw, output);
  }
  const length = (await probe(output)).duration;

  let words: Word[] = [];
  let silences: [number, number][] = [];
  if (sound) {
    silences = await detectSilences(source, info.duration);
    log(`Transcribing with ${opts.engine ?? "parakeet"}…`);
    const heard = await transcribe(root, source, work, silences, info.duration, opts);
    words = heard.map((w, i) => ({ ...w, id: `${name}_w${i}`, clip: name }));
  }
  await Bun.write(join(dir, "work", "clips", `${name}.words.json`), pretty(words));
  rmSync(work, { recursive: true, force: true });

  // Read edit.json again: the conversion took a while and the editor may have saved the cut meanwhile.
  edit = await readJson<Edit>(editPath);
  edit.clips = { ...edit.clips, [name]: { duration: Math.round(length * 1000) / 1000, sound, words: words.length, from: origin } };
  await Bun.write(editPath, pretty(edit));

  // On the timeline it is a piece like the others: drag it, trim it, split it.
  const place = opts.place ?? "end";
  const indexPath = join(dir, "index.html");
  let placed: { id: string; at: number } | undefined;
  if (place !== "none" && existsSync(indexPath)) {
    let html = await Bun.file(indexPath).text();
    const pieces = readPieces(html);
    // Whole frames, like every other piece.
    const frames = (t: number) => Math.round(t * FPS) / FPS;
    const first = Math.min(Math.max(0, frames(opts.from ?? 0)), Math.floor(length * FPS) / FPS);
    const last = Math.min(opts.to === undefined ? Infinity : frames(opts.to), Math.floor(length * FPS) / FPS);
    const whole = last - first;
    if (!(whole >= 0.2)) throw new Error(`That part of the clip is ${Math.max(0, whole).toFixed(2)}s long; it needs at least 0.2s. The clip runs ${length.toFixed(2)}s.`);
    let at = timelineEnd(pieces);
    if (place !== "end") {
      const after = pieces.find((p) => p.id === place);
      if (!after) throw new Error(`There is no piece called ${place} in ${slug}. Pieces: ${pieces.map((p) => p.id).join(", ")}`);
      at = Math.round((after.start + after.duration) * 1000) / 1000;
      html = openGap(html, at, whole);
    }
    let id = `c-${name}`;
    for (let i = 2; new RegExp(`\\sid="${id}"`).test(html); i++) id = `c-${name}-${i}`;
    html = addPiece(html, { id, start: at, duration: Math.round(whole * 1000) / 1000, mediaStart: Math.round(first * 1000) / 1000, src: clipSrc(name), ...(sound ? {} : { muted: true }) }, edit.look);
    await Bun.write(indexPath, html);
    placed = { id, at };
  }
  const summary = existsSync(indexPath) ? await applyReel(slug, { root }) : undefined;

  return {
    slug,
    name,
    size,
    duration: length,
    codec: info.video.codec_name,
    sound,
    gain: level?.gain,
    limited: level?.limit ?? false,
    words: words.length,
    placed,
    summary,
    transcript: words.length ? packTranscript(words, 0.4, silences) : "",
  };
}

// ---------------------------------------------------------------------------
// Render and list.
// ---------------------------------------------------------------------------

export async function renderReel(slug: string, opts: { root?: string } = {}) {
  const root = opts.root ?? ROOT;
  const dir = reelDir(root, slug);
  // Pick up anything changed in the editor since the last apply.
  const summary = await applyReel(slug, { root, closeHoles: true });
  mkdirSync(join(root, "exports"), { recursive: true });
  const output = join(root, "exports", `${slug}.mp4`);

  // The editor timeline has empty working room after the reel. Export from a
  // copy cut back to the reel itself, so the open editor is never touched and
  // no time is spent rendering the empty tail.
  const started = Date.now();
  const stage = join(dir, "work", "render");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, "compositions"), { recursive: true });
  const index = await Bun.file(join(dir, "index.html")).text();
  await Bun.write(join(stage, "index.html"), withLength(index, summary.duration));
  for (const file of ["compositions/captions.html", "hyperframes.json", "meta.json"]) {
    copyFileSync(join(dir, file), join(stage, file));
  }
  symlinkSync(join(dir, "assets"), join(stage, "assets"));
  await run([hyperframes(root), "render", stage, "--output", output, "--fps", String(FPS), "--quality", "high", "--quiet"]);
  rmSync(stage, { recursive: true, force: true });

  const info = await probe(output);
  const size = displaySize(info.video);
  return {
    output,
    summary,
    size,
    codec: info.video.codec_name,
    audio: info.audio?.codec_name,
    duration: info.duration,
    megabytes: Bun.file(output).size / 1e6,
    seconds: (Date.now() - started) / 1000,
    ok: size.width === 1080 && size.height === 1920 && info.video.codec_name === "h264" && !!info.audio,
  };
}

export type ReelInfo = { slug: string; built: boolean; rendered: boolean; modified: number; seconds?: number; pieces?: number };

/** How long a reel is and how many pieces it has, from the cut saved in its edit.json. */
function cutFacts(file: string): { seconds?: number; pieces?: number } {
  try {
    const pieces = (JSON.parse(readFileSync(file, "utf8")) as { pieces?: { start: number; src: [number, number] }[] }).pieces ?? [];
    if (!pieces.length) return {};
    const audible = pieces.filter((piece) => Array.isArray(piece.src));
    return { pieces: pieces.length, seconds: Math.max(...audible.map((piece) => piece.start + piece.src[1] - piece.src[0])) };
  } catch {
    return {};
  }
}

export async function listReels(root = ROOT): Promise<ReelInfo[]> {
  const base = join(root, "reels");
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((slug) => existsSync(join(base, slug, "edit.json")))
    .map((slug) => ({
      slug,
      built: existsSync(join(base, slug, "index.html")),
      rendered: existsSync(join(root, "exports", `${slug}.mp4`)),
      modified: statSync(join(base, slug, "edit.json")).mtimeMs,
      ...cutFacts(join(base, slug, "edit.json")),
    }))
    .sort((a, b) => b.modified - a.modified);
}

#!/usr/bin/env bun
/**
 * ReelsEasy command line.
 *
 *   bun scripts/reel.ts ingest <clip> [--name slug] [--language xx] [--engine whisper --model large-v3]
 *   bun scripts/reel.ts import <slug> <clip> [--name n] [--after p3 | --no-place] [--from s] [--to s]
 *   bun scripts/reel.ts build  <slug> [--reset]
 *   bun scripts/reel.ts render <slug>
 *   bun scripts/reel.ts list
 *   bun scripts/reel.ts serve  [--port 4310]
 *   bun scripts/reel.ts sounds [--force]
 *
 * ingest  transcribes a clip, prepares its working copy and writes a starter edit.json
 * import  brings another video into a reel: converted, transcribed and put on the
 *         timeline after the last piece (or after the piece named with --after).
 *         --no-place only makes it available to "inserts" in edit.json; --from and
 *         --to (seconds of the clip) put only that part on the timeline
 * build   applies edit.json to the reel's project. Safe to run on a reel that was
 *         edited by hand: the cut and anything moved by hand are kept. --reset
 *         rebuilds everything from edit.json (the cut is still kept).
 * render  renders the reel to exports/<slug>.mp4 and checks the file
 * serve   runs the local app: reel list, editor and export, on this Mac only
 * sounds  makes the sounds this repository may not hand out itself, from the
 *         originals inside HyperFrames. Runs by itself after "bun install".
 */
import { relative } from "node:path";
import { buildPack } from "./lib/pack";
import { applyReel, importClip, ingestClip, listReels, renderReel, ROOT, type Summary } from "./lib/pipeline";

export type Args = { command?: string; targets: string[]; options: Record<string, string | true> };

export function parseArgs(argv: string[]): Args {
  const [command, ...rest] = argv;
  const targets: string[] = [];
  const options: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const item = rest[i]!;
    if (!item.startsWith("--")) {
      targets.push(item);
      continue;
    }
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options[item.slice(2)] = next;
      i++;
    } else {
      options[item.slice(2)] = true;
    }
  }
  return { command, targets, options };
}

const text = (value: string | true | undefined) => (typeof value === "string" ? value : undefined);

function report(summary: Summary): string {
  const lines = [
    `${summary.fresh ? "Built" : summary.changed ? "Updated" : "Already up to date:"} reels/${summary.slug}: ${summary.duration.toFixed(2)}s, ${summary.pieces} pieces, ${summary.groups} caption groups, ${summary.sounds} sounds${summary.layers ? `, ${summary.layers} effect and insert layers` : ""}${summary.motions ? `, ${summary.motions} transitions and motion effects` : ""}`,
  ];
  if (summary.notes.length) lines.push("", "Notes:", ...summary.notes.map((note) => `  ${note}`));
  if (summary.skipped.length) lines.push("", "Left out, no longer in the reel:", ...summary.skipped.map((item) => `  ${item}`));
  lines.push("", "Captions on the timeline:", ...summary.captions.map((line) => `  ${line}`));
  return lines.join("\n");
}

const commands: Record<string, (args: Args) => Promise<void>> = {
  async ingest({ targets, options }) {
    const clip = targets[0];
    if (!clip) throw new Error("usage: reel.ts ingest <clip> [--name slug] [--language xx] [--engine whisper --model large-v3]");
    const result = await ingestClip(clip, {
      name: text(options.name),
      language: text(options.language),
      engine: text(options.engine),
      model: text(options.model),
      log: (line) => console.log(line),
    });
    const { width, height } = result.size;
    console.log(`
Reel:      reels/${result.slug}
Source:    ${width}x${height}, ${result.duration.toFixed(2)}s, ${result.codec}${height > width ? "" : "  (not vertical: it is centre-cropped to 9:16)"}
Working:   ${result.working.width}x${result.working.height}, sound ${result.gain >= 0 ? "+" : ""}${result.gain} dB${result.limited ? ", peaks limited" : ""}
Words:     ${result.words}
Proposed:  keep ${result.keeps.length} ranges, ${result.kept.toFixed(2)}s of ${result.duration.toFixed(2)}s
Keeps:     ${JSON.stringify(result.keeps)}

Transcript (source time, word ids, pause after each phrase):
${result.transcript}

Next: edit reels/${result.slug}/edit.json, then: bun scripts/reel.ts build ${result.slug}`);
  },

  async import({ targets, options }) {
    const [slug, clip] = targets;
    if (!slug || !clip) throw new Error("usage: reel.ts import <slug> <clip> [--name n] [--after p3 | --no-place] [--from s] [--to s]");
    const r = await importClip(slug, clip, {
      name: text(options.name),
      place: options["no-place"] === true ? "none" : (text(options.after) ?? "end"),
      from: text(options.from) === undefined ? undefined : Number(text(options.from)),
      to: text(options.to) === undefined ? undefined : Number(text(options.to)),
      language: text(options.language),
      engine: text(options.engine),
      model: text(options.model),
      log: (line) => console.log(line),
    });
    const { width, height } = r.size;
    const where = r.placed
      ? `on the timeline as piece ${r.placed.id}, at ${r.placed.at.toFixed(2)}s`
      : "not on the timeline: use it with \"inserts\" in edit.json";
    console.log(`
Clip:      ${r.name} in reels/${r.slug}  (${where})
Source:    ${width}x${height}, ${r.duration.toFixed(2)}s, ${r.codec}${height > width ? "" : "  (not vertical: it is centre-cropped to 9:16)"}
Sound:     ${r.sound ? `${r.gain! >= 0 ? "+" : ""}${r.gain} dB${r.limited ? ", peaks limited" : ""}, ${r.words} words` : "none: it plays silent"}
${r.transcript ? `
Transcript (clip time, word ids, pause after each phrase):
${r.transcript}
` : ""}${r.summary ? "\n" + report(r.summary) : ""}`);
  },

  async build({ targets, options }) {
    const slug = targets[0];
    if (!slug) throw new Error("usage: reel.ts build <slug> [--reset]");
    console.log(report(await applyReel(slug, { reset: options.reset === true })));
  },

  async render({ targets }) {
    const slug = targets[0];
    if (!slug) throw new Error("usage: reel.ts render <slug>");
    console.log("Rendering…");
    const r = await renderReel(slug);
    console.log(`
${r.ok ? "Done" : "Rendered, but the file is NOT what Reels and TikTok expect"}: ${relative(ROOT, r.output)}
${r.size.width}x${r.size.height}, ${r.codec}${r.audio ? " + " + r.audio : ", NO AUDIO"}, ${r.duration.toFixed(2)}s, ${r.megabytes.toFixed(1)} MB, rendered in ${r.seconds.toFixed(0)}s`);
    if (r.summary.notes.length) console.log(["", "Notes:", ...r.summary.notes.map((note) => `  ${note}`)].join("\n"));
    if (!r.ok) process.exit(1);
  },

  async list() {
    for (const reel of await listReels()) {
      console.log(`${reel.slug}${reel.built ? "" : "  (not built)"}${reel.rendered ? "  exported" : ""}`);
    }
  },

  async serve({ options }) {
    const { startServer } = await import("./lib/server");
    const server = await startServer({ port: Number(text(options.port) ?? 4310), log: (line) => console.log(line) });
    console.log(`ReelsEasy is running at ${server.url} (this Mac only). Ctrl-C stops it.`);
    await new Promise(() => {});
  },

  async sounds({ options }) {
    // After "bun install" this must never stop the install: say what is missing and carry on.
    try {
      const r = await buildPack(ROOT, { force: options.force === true });
      if (r.made.length) console.log(`Made ${r.made.length} sounds in sfx/ from HyperFrames' own: ${r.made.join(", ")}`);
      if (r.missing.length) console.log(`Could not find HyperFrames' originals for: ${r.missing.join(", ")}. Run "bun install", then "bun scripts/reel.ts sounds".`);
      if (!r.made.length && !r.missing.length) console.log("All sounds are already there.");
    } catch (error) {
      console.log(`Sounds were not made (${(error as Error).message}). Install ffmpeg (brew install ffmpeg), then run "bun scripts/reel.ts sounds".`);
    }
  },
};

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const handler = args.command ? commands[args.command] : undefined;
  if (!handler) {
    console.error("usage: bun scripts/reel.ts <ingest|import|build|render|list|serve|sounds> …");
    process.exit(2);
  }
  handler(args).catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
  });
}

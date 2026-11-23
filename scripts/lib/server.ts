/**
 * The local app behind the ReelsEasy window: a page that lists reels, and
 * the requests that ingest a clip, open the timeline editor on a reel and
 * export it. It listens on 127.0.0.1 only. There are no accounts and nothing
 * is sent anywhere.
 */
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { basename, extname, isAbsolute, join } from "node:path";
import { slugify } from "./media";
import { applyReel, importClip, ingestClip, listReels, renderReel, ROOT, watchReel, type ReelInfo } from "./pipeline";
import { ASSISTANTS, findTool, isAssistant, prepareLauncher, readSettings, writeSettings, type AssistantId, type Settings } from "./assistant";
import { BRAND, studioSkinCss, studioSkinJs, tokensCss } from "./theme";

const VIDEO = new Set([".mov", ".mp4", ".m4v"]);

export const isSlug = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9][a-z0-9-]*$/.test(value);

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const length = (seconds: number) => {
  const whole = Math.round(seconds);
  return whole >= 60 ? `${Math.floor(whole / 60)} min ${whole % 60} s` : `${whole} s`;
};

/** What the page needs to know about editing by chat: has the user answered, with what, and which tools are on this Mac. */
export type AssistantView = { asked: boolean; assistant?: Settings["assistant"]; tools: Record<AssistantId, boolean> };

const ASK: Record<AssistantId, string> = { claude: "Ask Claude", codex: "Ask Codex" };

/** The first-launch question, shown until it is answered. */
function setupCard(ai: AssistantView): string {
  const found = (Object.keys(ASSISTANTS) as AssistantId[]).filter((id) => ai.tools[id]).map((id) => ASSISTANTS[id].name);
  return `<section class="setup glass" data-setup>
      <h2>Do you edit with an AI?</h2>
      <p>${BRAND} has no AI of its own. If you use Claude Code or Codex, the coding agent from the makers of ChatGPT, it can edit your reels when you tell it what you want. Pick one and it opens in your reel folder, ready to go.</p>
      <div class="actions">
        <button class="primary" data-assistant="claude">${ASSISTANTS.claude.label}</button>
        <button data-assistant="codex">${ASSISTANTS.codex.label}</button>
        <button class="quiet" data-assistant="none">Not now</button>
      </div>
      <p class="found">${found.length ? `Found on this Mac: ${found.join(" and ")}.` : "Neither is on this Mac yet. Pick one and you are shown where to get it."}</p>
    </section>`;
}

/** The home page: reels to edit or export, and clips waiting in the inbox. */
export function launcherHtml(reels: ReelInfo[], inbox: string[], ai?: AssistantView): string {
  const chosen = ai?.asked && isAssistant(ai.assistant) ? ai.assistant : undefined;
  const aiButtons = !ai?.asked
    ? ""
    : chosen
      ? `<button class="primary" data-assistant="${chosen}">${ASK[chosen]}</button><button class="quiet" data-assistant="reset">Change</button>`
      : `<button class="quiet" data-assistant="reset">Set up AI editing</button>`;
  const state = (r: ReelInfo) => (r.rendered ? "Exported" : r.built ? "Not exported yet" : "New");
  const facts = (r: ReelInfo) =>
    [r.seconds ? length(r.seconds) : "", r.pieces ? `${r.pieces} ${r.pieces === 1 ? "piece" : "pieces"}` : ""].filter(Boolean).join(" · ");
  const reelCards = reels
    .map(
      (r) => `<li class="reel glass">
        <button class="thumb" data-open="${esc(r.slug)}" aria-label="Edit ${esc(r.slug)}">
          <img src="/thumb/${esc(r.slug)}.jpg?v=${Math.round(r.modified)}" alt="" loading="lazy" onerror="this.remove()">
          <span class="state${r.rendered ? " done" : ""}">${state(r)}</span>
        </button>
        <div class="meta"><strong>${esc(r.slug)}</strong><span>${facts(r) || "Not cut yet"}</span></div>
        <div class="actions">
          <button class="primary" data-open="${esc(r.slug)}">Edit</button>
          <button data-render="${esc(r.slug)}">Export</button>
          ${r.rendered ? `<button class="quiet" data-reveal="${esc(r.slug)}">Show file</button>` : ""}
        </div>
      </li>`,
    )
    .join("\n");
  const built = reels.filter((r) => r.built);
  const addTo = (file: string) =>
    built.length
      ? `<select data-import="${esc(file)}" aria-label="Add ${esc(file)} to a reel">
            <option value="">Add to a reel…</option>
            ${built.map((r) => `<option value="${esc(r.slug)}">${esc(r.slug)}</option>`).join("")}
          </select>`
      : "";
  const clipRows = inbox
    .map(
      (file) => `<li class="clip">
        <strong>${esc(file)}</strong>
        <div class="actions"><button class="primary" data-ingest="${esc(file)}">Start a reel</button>${addTo(file)}</div>
      </li>`,
    )
    .join("\n");
  const noReels = `<p class="empty glass">No reels yet. Put an iPhone clip in the <code>inbox</code> folder, or drop one on the ${BRAND} icon in the Dock, then press Start a reel.</p>`;
  const noClips = `<p class="hint">No new clips. Put an iPhone clip in the <code>inbox</code> folder, or drop one on the ${BRAND} icon in the Dock.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${BRAND}</title>
<link rel="icon" href="/brand/icon.png">
<style>
  ${tokensCss()}
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; padding-bottom: 64px; background: var(--bg); color: var(--ink); font: 14px/1.45 -apple-system, "SF Pro Text", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  /* Two soft lights behind the glass: the control blue and the logo's pink. */
  body::before { content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
    background: radial-gradient(900px 520px at 14% -12%, rgba(79, 140, 255, 0.2), transparent 62%), radial-gradient(720px 440px at 96% -6%, rgba(240, 51, 155, 0.13), transparent 60%); }
  .glass { background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.022)); border: 1px solid var(--line); border-radius: 18px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 14px 34px rgba(0, 0, 0, 0.3); -webkit-backdrop-filter: blur(20px) saturate(1.4); backdrop-filter: blur(20px) saturate(1.4); }
  .bar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 12px; height: 60px; padding: 0 24px; background: rgba(10, 14, 23, 0.62);
    -webkit-backdrop-filter: blur(24px) saturate(1.5); backdrop-filter: blur(24px) saturate(1.5); border-bottom: 1px solid var(--line); }
  .bar img { width: 32px; height: 32px; display: block; }
  .bar .name { font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
  .bar .note { margin-left: auto; color: var(--muted); font-size: 13px; }
  .layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 24px; align-items: start; padding: 28px 24px; max-width: 1480px; margin: 0 auto; }
  h1 { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 16px; }
  h1 span, h2 span { color: var(--muted); font-weight: 500; margin-left: 6px; }
  h2 { font-size: 15px; font-weight: 650; margin: 0 0 12px; }
  ul { list-style: none; margin: 0; padding: 0; }
  .reels { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 280px)); gap: 18px; }
  .reel { padding: 10px; display: flex; flex-direction: column; gap: 10px; transition: transform 0.18s ease, border-color 0.18s ease; }
  .reel:hover { transform: translateY(-2px); border-color: var(--line-strong); }
  .thumb { position: relative; display: block; width: 100%; height: 0; padding: 0 0 177.78%; border: 0; border-radius: 12px; overflow: hidden; cursor: pointer;
    background: linear-gradient(160deg, var(--raised), var(--input)); }
  .thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.3s ease; }
  .thumb:hover img { transform: scale(1.03); }
  .state { position: absolute; left: 8px; top: 8px; padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--ink);
    background: rgba(10, 14, 23, 0.62); border: 1px solid var(--line-strong); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
  .state.done { color: #9be7c0; }
  .meta { padding: 0 4px; min-width: 0; }
  .meta strong { display: block; font-size: 15px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta span { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .reel .actions .primary { flex: 1; }
  button, select { font: inherit; font-weight: 600; height: 34px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--line-strong); background: rgba(255, 255, 255, 0.05);
    color: var(--ink); cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease, transform 0.08s ease; }
  button:hover, select:hover { background: rgba(255, 255, 255, 0.1); }
  button:active { transform: scale(0.97); }
  button.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  button.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
  button.quiet { border-color: transparent; background: transparent; color: var(--muted); padding: 0 8px; }
  button.quiet:hover { color: var(--ink); background: rgba(255, 255, 255, 0.06); }
  button:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button:disabled, select:disabled { opacity: 0.5; cursor: default; }
  select { max-width: 100%; padding: 0 10px; }
  .inbox { padding: 18px; position: sticky; top: 84px; }
  .clip { padding: 12px 0; border-top: 1px solid var(--line); display: grid; gap: 10px; }
  .clip:first-child { border-top: 0; padding-top: 0; }
  .clip strong { font-weight: 600; overflow-wrap: anywhere; }
  .hint { color: var(--muted); margin: 0 0 14px; }
  .inbox > button { width: 100%; margin-top: 14px; }
  .empty { color: var(--muted); padding: 22px; margin: 0; max-width: 560px; }
  .setup { padding: 22px 24px; margin-bottom: 28px; max-width: 760px; }
  .setup h2 { font-size: 18px; margin-bottom: 8px; }
  .setup p { color: var(--muted); margin: 0 0 16px; max-width: 64ch; }
  .setup .found { margin: 14px 0 0; font-size: 13px; }
  code { background: rgba(255, 255, 255, 0.08); padding: 1px 6px; border-radius: 6px; color: var(--ink); }
  #status { position: fixed; left: 0; right: 0; bottom: 0; z-index: 5; display: flex; align-items: center; gap: 10px; min-height: 46px; padding: 10px 24px; color: var(--muted);
    background: rgba(10, 14, 23, 0.7); -webkit-backdrop-filter: blur(24px) saturate(1.5); backdrop-filter: blur(24px) saturate(1.5); border-top: 1px solid var(--line); }
  #status.error { color: var(--danger); }
  #status.busy::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.25; transform: scale(0.7); } }
  @media (max-width: 980px) { .layout { grid-template-columns: 1fr; } .inbox { position: static; } }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
</style>
</head>
<body>
<header class="bar">
  <img src="/brand/icon.png" alt="" onerror="this.remove()">
  <span class="name">${BRAND}</span>
  <span class="note">Everything stays on this Mac. No account, no upload.</span>
  ${aiButtons}
</header>
<div class="layout">
  <main>
    ${ai && !ai.asked ? setupCard(ai) : ""}
    <h1>Reels<span>${reels.length || ""}</span></h1>
    ${reels.length ? `<ul class="reels">${reelCards}</ul>` : noReels}
  </main>
  <aside class="inbox glass">
    <h2>New clips<span>${inbox.length || ""}</span></h2>
    ${inbox.length ? `<ul>${clipRows}</ul>` : noClips}
    <button data-inbox>Open inbox folder</button>
  </aside>
</div>
<div id="status" role="status"></div>
<script>
  const status = document.getElementById("status");
  const say = (text, kind) => { status.textContent = text; status.className = kind || ""; };
  async function post(path, body) {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Reel-Editor": "1" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Something went wrong");
    return data;
  }
  async function act(button, message, work) {
    document.querySelectorAll("button, select").forEach((b) => (b.disabled = true));
    say(message, "busy");
    try { await work(); if (status.className === "busy") say(""); } catch (error) { say(error.message, "error"); }
    document.querySelectorAll("button, select").forEach((b) => (b.disabled = false));
  }
  document.addEventListener("change", (event) => {
    const pick = event.target.closest("select[data-import]");
    if (!pick || !pick.value) return;
    const slug = pick.value, file = pick.dataset.import;
    pick.value = "";
    act(pick, "Adding " + file + " to " + slug + ". This takes up to a minute…", async () => {
      const r = await post("/api/import", { slug, file });
      say("Added " + file + " to the end of " + slug + " as piece " + r.piece + " (" + r.duration.toFixed(1) + " s" +
        (r.sound ? ", " + r.words + " words captioned" : ", no sound") + "). Press Edit on " + slug + " and drag it where you want it.");
    });
  });
  document.addEventListener("click", (event) => {
    const b = event.target.closest("button");
    if (!b) return;
    if (b.dataset.open) act(b, "Opening the editor…", async () => {
      const { url } = await post("/api/open", { slug: b.dataset.open });
      location.href = url;
    });
    if (b.dataset.render) act(b, "Exporting. A 30 second reel takes about half a minute…", async () => {
      const r = await post("/api/render", { slug: b.dataset.render });
      const closed = (r.notes || []).filter((note) => note.startsWith("closed a hole"));
      say("Exported " + r.file + " (" + r.duration.toFixed(1) + " s, " + r.megabytes.toFixed(1) + " MB)" +
        (closed.length ? ". Pulled the pieces together first: " + closed.join("; ") : ""));
      await post("/api/reveal", { slug: b.dataset.render });
    });
    if (b.dataset.reveal) act(b, "", () => post("/api/reveal", { slug: b.dataset.reveal }));
    if ("inbox" in b.dataset) act(b, "", () => post("/api/inbox", {}));
    if (b.dataset.assistant) act(b, "", async () => {
      const choice = b.dataset.assistant;
      const r = await post("/api/assistant", { choice });
      if (choice === "none" || choice === "reset") return location.reload();
      const setup = document.querySelector("section.setup");
      if (setup) setup.remove();
      say(r.installed
        ? r.name + " is opening in Terminal, in your reel folder. Try: Edit the new clip in my inbox into a reel."
        : r.name + " is not on this Mac yet. The Terminal window that opened shows where to get it: " + r.install);
    });
    if (b.dataset.ingest) act(b, "Transcribing and proposing a cut. This takes up to a minute…", async () => {
      const { slug } = await post("/api/ingest", { file: b.dataset.ingest });
      const { url } = await post("/api/open", { slug });
      location.href = url;
    });
  });
</script>
</body>
</html>
`;
}

function freePort(from: number): Promise<number> {
  return new Promise((resolvePort) => {
    const probe = createServer();
    probe.once("error", () => resolvePort(freePort(from + 1)));
    probe.once("listening", () => probe.close(() => resolvePort(from)));
    probe.listen(from, "127.0.0.1");
  });
}

type Editor = { url: string; port: number; proc: ReturnType<typeof Bun.spawn>; watcher: { close: () => void } };

export type AppOptions = {
  root?: string;
  log?: (line: string) => void;
  /** Opens a file with the system, as a double-click would. Replaced in tests. */
  launch?: (path: string) => void;
  /** Finds a command line tool on this Mac. Replaced in tests. */
  findTool?: (command: string) => string | undefined;
};

export function createApp(opts: AppOptions = {}) {
  const root = opts.root ?? ROOT;
  const log = opts.log ?? (() => {});
  const launch = opts.launch ?? ((path: string) => void Bun.spawn(["open", path]));
  const tool = opts.findTool ?? ((command: string) => findTool(command));

  function assistantView(): AssistantView {
    const settings = readSettings(root);
    return { asked: settings.asked === true, assistant: settings.assistant, tools: { claude: Boolean(tool("claude")), codex: Boolean(tool("codex")) } };
  }
  const editors = new Map<string, Editor>();

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  const fail = (error: string, status = 400) => json({ error }, status);

  function inbox(): string[] {
    const dir = join(root, "inbox");
    if (!existsSync(dir)) return [];
    const taken = new Set(existsSync(join(root, "reels")) ? readdirSync(join(root, "reels")) : []);
    return readdirSync(dir)
      .filter((file) => VIDEO.has(extname(file).toLowerCase()) && !taken.has(slugify(file)))
      .sort();
  }

  /**
   * A small picture of a reel for the list: a frame of the export when there
   * is one (it has the captions), else of the first kept piece. Made once and
   * kept in the reel's work folder until the reel changes.
   */
  async function thumbnail(slug: string): Promise<string | null> {
    const reel = join(root, "reels", slug);
    const exported = join(root, "exports", `${slug}.mp4`);
    const source = join(reel, "assets", "source.mp4");
    const from = existsSync(exported) ? exported : existsSync(source) ? source : null;
    if (!from) return null;
    const out = join(reel, "work", "thumb.jpg");
    const changed = Math.max(statSync(from).mtimeMs, statSync(join(reel, "edit.json")).mtimeMs);
    if (existsSync(out) && statSync(out).mtimeMs >= changed) return out;

    let at = 0.4;
    if (from === source) {
      const edit = (await Bun.file(join(reel, "edit.json")).json().catch(() => ({}))) as { pieces?: { src?: unknown[] }[]; keeps?: unknown[][] };
      const first = edit.pieces?.[0]?.src?.[0] ?? edit.keeps?.[0]?.[0];
      if (typeof first === "number") at = first + 0.4;
    }
    mkdirSync(join(reel, "work"), { recursive: true });
    const made = Bun.spawn(["ffmpeg", "-v", "error", "-y", "-ss", String(at), "-i", from, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", out], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await made.exited;
    return existsSync(out) ? out : null;
  }

  /** Start the timeline editor on a reel (once) and keep the reel in step while it is open. */
  async function openEditor(slug: string): Promise<string> {
    await applyReel(slug, { root });
    const running = editors.get(slug);
    if (running && running.proc.exitCode === null) return running.url;

    const port = await freePort(4311);
    const proc = Bun.spawn(
      [join(root, "node_modules/.bin/hyperframes"), "preview", join(root, "reels", slug), "--port", String(port), "--no-open", "--foreground"],
      { stdout: "ignore", stderr: "ignore", env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1" } },
    );
    const base = `http://localhost:${port}`;
    for (let i = 0; ; i++) {
      if (proc.exitCode !== null) throw new Error("The editor could not start for this reel.");
      const up = await fetch(base).then((r) => r.ok, () => false);
      if (up) break;
      if (i > 120) {
        proc.kill();
        throw new Error("The editor took too long to start.");
      }
      await Bun.sleep(250);
    }
    const watcher = watchReel(slug, {
      root,
      onApply: (s) => log(`${slug}: timeline changed, captions and effects re-placed (${s.pieces} pieces, ${s.duration.toFixed(2)}s)`),
      onError: (e) => log(`${slug}: ${e.message}`),
    });
    const url = `${base}/#project/${slug}`;
    editors.set(slug, { url, port, proc, watcher });
    log(`${slug}: editor open at ${url}`);
    return url;
  }

  async function handle(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    try {
      if (req.method === "GET" && pathname === "/") {
        return new Response(launcherHtml(await listReels(root), inbox(), assistantView()), {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        });
      }
      if (req.method === "GET" && pathname === "/api/state") {
        return json({ reels: await listReels(root), inbox: inbox() });
      }
      if (req.method === "GET" && pathname === "/skin.css") {
        return new Response(studioSkinCss(), { headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" } });
      }
      if (req.method === "GET" && pathname === "/skin.js") {
        return new Response(studioSkinJs(new URL(req.url).origin), { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" } });
      }
      if (req.method === "GET" && pathname === "/brand/icon.png") {
        const icon = join(root, "brand", "icon.png");
        return existsSync(icon) ? new Response(Bun.file(icon)) : fail("Not found", 404);
      }
      const picture = req.method === "GET" && /^\/thumb\/([^/]+)\.jpg$/.exec(pathname);
      if (picture) {
        const slug = picture[1]!;
        const file = isSlug(slug) && existsSync(join(root, "reels", slug, "edit.json")) ? await thumbnail(slug) : null;
        return file ? new Response(Bun.file(file), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } }) : fail("Not found", 404);
      }
      if (req.method !== "POST" || !pathname.startsWith("/api/")) return fail("Not found", 404);

      // Only this app's own page sends this header; another website cannot.
      if (req.headers.get("X-Reel-Editor") !== "1") return fail("Not allowed", 403);
      const body = (await req.json().catch(() => ({}))) as { slug?: unknown; file?: unknown; choice?: unknown };

      // Editing by chat: remember the answer and start the chosen assistant in the reel folder.
      if (pathname === "/api/assistant") {
        if (body.choice === "reset") {
          writeSettings(root, {});
          return json({ ok: true });
        }
        if (body.choice === "none") {
          writeSettings(root, { asked: true, assistant: "none" });
          return json({ ok: true });
        }
        if (!isAssistant(body.choice)) return fail("Choose Claude, ChatGPT or not now");
        const assistant = ASSISTANTS[body.choice];
        writeSettings(root, { asked: true, assistant: body.choice });
        launch(prepareLauncher(root, body.choice));
        return json({ ok: true, name: assistant.name, installed: Boolean(tool(assistant.command)), install: assistant.install });
      }

      if (pathname === "/api/inbox") {
        mkdirSync(join(root, "inbox"), { recursive: true });
        Bun.spawn(["open", join(root, "inbox")]);
        return json({ ok: true });
      }

      if (pathname === "/api/ingest") {
        if (typeof body.file !== "string" || !body.file) return fail("No clip given");
        const path = isAbsolute(body.file) ? body.file : join(root, "inbox", basename(body.file));
        if (!existsSync(path) || !statSync(path).isFile()) return fail(`No such clip: ${basename(body.file)}`);
        if (!VIDEO.has(extname(path).toLowerCase())) return fail("That is not a video file (.mov, .mp4 or .m4v)");
        const result = await ingestClip(path, { root, log });
        await applyReel(result.slug, { root });
        return json({ slug: result.slug });
      }

      if (!isSlug(body.slug)) return fail("That is not a valid reel name");
      const slug = body.slug;
      if (!existsSync(join(root, "reels", slug, "edit.json"))) return fail(`There is no reel called ${slug}`);

      if (pathname === "/api/import") {
        if (typeof body.file !== "string" || !body.file) return fail("No clip given");
        const path = isAbsolute(body.file) ? body.file : join(root, "inbox", basename(body.file));
        if (!existsSync(path) || !statSync(path).isFile()) return fail(`No such clip: ${basename(body.file)}`);
        if (!VIDEO.has(extname(path).toLowerCase())) return fail("That is not a video file (.mov, .mp4 or .m4v)");
        if (!existsSync(join(root, "reels", slug, "index.html"))) await applyReel(slug, { root });
        const r = await importClip(slug, path, { root, log });
        return json({ clip: r.name, piece: r.placed?.id, duration: r.duration, sound: r.sound, words: r.words });
      }
      if (pathname === "/api/open") return json({ url: await openEditor(slug) });
      if (pathname === "/api/render") {
        const r = await renderReel(slug, { root });
        if (!r.ok) return fail("The export finished but is not a 1080x1920 H.264 file with sound", 500);
        return json({
          file: `exports/${slug}.mp4`,
          duration: r.duration,
          megabytes: r.megabytes,
          seconds: r.seconds,
          notes: r.summary.notes,
        });
      }
      if (pathname === "/api/reveal") {
        const file = join(root, "exports", `${slug}.mp4`);
        if (!existsSync(file)) return fail("This reel has not been exported yet");
        Bun.spawn(["open", "-R", file]);
        return json({ ok: true });
      }
      return fail("Not found", 404);
    } catch (error) {
      log(`error: ${(error as Error).message}`);
      return fail((error as Error).message, 500);
    }
  }

  function close() {
    for (const editor of editors.values()) {
      editor.watcher.close();
      editor.proc.kill();
    }
    editors.clear();
  }

  return { handle, close };
}

export async function startServer(opts: AppOptions & { port?: number } = {}) {
  const app = createApp(opts);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port ?? 4310,
    idleTimeout: 0,
    fetch: app.handle,
  });
  const stop = () => {
    app.close();
    server.stop(true);
  };
  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stop();
    process.exit(0);
  });
  return { url: `http://127.0.0.1:${server.port}`, stop };
}

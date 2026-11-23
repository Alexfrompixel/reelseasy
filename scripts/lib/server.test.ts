import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, isSlug, launcherHtml } from "./server";

describe("isSlug", () => {
  test("accepts reel folder names and nothing that could leave the reels folder", () => {
    expect(isSlug("img-4821")).toBe(true);
    expect(isSlug("../etc")).toBe(false);
    expect(isSlug("a/b")).toBe(false);
    expect(isSlug("")).toBe(false);
  });
});

describe("launcherHtml", () => {
  const html = launcherHtml(
    [
      { slug: "img-4821", built: true, rendered: true, modified: 2, seconds: 41.83, pieces: 12 },
      { slug: "draft", built: false, rendered: false, modified: 1 },
    ],
    ["IMG_5000.MOV", "<script>.mov"],
  );

  test("lists every reel with edit and export", () => {
    expect(html).toContain('data-open="img-4821"');
    expect(html).toContain('data-render="img-4821"');
    expect(html).toContain('data-open="draft"');
  });

  test("offers clips waiting in the inbox and escapes their names", () => {
    expect(html).toContain('data-ingest="IMG_5000.MOV"');
    expect(html).toContain("&lt;script&gt;.mov");
    expect(html).not.toContain("<script>.mov");
  });

  test("a waiting clip can also be added to a reel that is already built", () => {
    expect(html).toMatch(/<select data-import="IMG_5000.MOV"[^>]*>\s*<option value="">Add to a reel…<\/option>\s*<option value="img-4821">img-4821<\/option>\s*<\/select>/);
    expect(launcherHtml([{ slug: "draft", built: false, rendered: false, modified: 1 }], ["a.mov"])).not.toContain("<select");
  });

  test("carries the app's name and shows each reel as a picture with its length", () => {
    expect(html).toContain("<title>ReelsEasy</title>");
    expect(html).toContain('src="/thumb/img-4821.jpg?v=2"');
    expect(html).toContain("42 s · 12 pieces");
    expect(html).toContain("Exported");
    expect(html).toContain('data-inbox');
  });

  test("asks once which AI the user edits with, and afterwards offers a button to start it", () => {
    const tools = { claude: true, codex: false };
    const first = launcherHtml([], [], { asked: false, tools });
    expect(first).toContain("data-setup");
    expect(first).toContain('data-assistant="claude"');
    expect(first).toContain('data-assistant="codex"');
    expect(first).toContain('data-assistant="none"');
    expect(first).toContain("ChatGPT");
    const chosen = launcherHtml([], [], { asked: true, assistant: "claude", tools });
    expect(chosen).not.toContain("data-setup");
    expect(chosen).toMatch(/<button[^>]*data-assistant="claude"[^>]*>Ask Claude<\/button>/);
    const declined = launcherHtml([], [], { asked: true, assistant: "none", tools });
    expect(declined).not.toContain("data-setup");
    expect(declined).toContain('data-assistant="reset"');
    // Pages built without the setting (older callers) simply do not ask.
    expect(launcherHtml([], [])).not.toContain("data-setup");
  });

  test("says what to do when there is nothing yet", () => {
    expect(launcherHtml([], [])).toContain("inbox");
  });
});

describe("the app's requests", () => {
  let root: string;
  let app: ReturnType<typeof createApp>;
  const launched: string[] = [];
  const call = (path: string, init?: RequestInit) => app.handle(new Request(`http://127.0.0.1:4310${path}`, init));
  const post = (path: string, body: unknown, headers: Record<string, string> = { "X-Reel-Editor": "1" }) =>
    call(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } });

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "reel-app-"));
    mkdirSync(join(root, "inbox"), { recursive: true });
    mkdirSync(join(root, "reels", "demo"), { recursive: true });
    await Bun.write(join(root, "inbox", "IMG_1.MOV"), "x");
    await Bun.write(join(root, "inbox", "notes.txt"), "x");
    await Bun.write(join(root, "reels", "demo", "edit.json"), "{}");
    app = createApp({ root, launch: (path) => launched.push(path), findTool: (command) => (command === "claude" ? "/fake/bin/claude" : undefined) });
  });
  afterAll(() => {
    app.close();
    rmSync(root, { recursive: true, force: true });
  });

  test("the home page is the launcher", async () => {
    const res = await call("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('data-open="demo"');
  });

  test("state lists reels and only video files from the inbox", async () => {
    const state = (await (await call("/api/state")).json()) as { reels: { slug: string }[]; inbox: string[] };
    expect(state.reels.map((r) => r.slug)).toEqual(["demo"]);
    expect(state.inbox).toEqual(["IMG_1.MOV"]);
  });

  test("a request from another website is refused", async () => {
    const res = await post("/api/open", { slug: "demo" }, {});
    expect(res.status).toBe(403);
  });

  test("a bad reel name is refused before anything runs", async () => {
    const res = await post("/api/open", { slug: "../../etc" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("reel");
  });

  test("a clip that does not exist is reported, not crashed on", async () => {
    const res = await post("/api/ingest", { file: "missing.mov" });
    expect(res.status).toBe(400);
  });

  test("adding a clip to a reel checks the reel, the file and its type first", async () => {
    expect((await post("/api/import", { slug: "nope", file: "IMG_1.MOV" })).status).toBe(400);
    expect((await post("/api/import", { slug: "demo", file: "missing.mov" })).status).toBe(400);
    const res = await post("/api/import", { slug: "demo", file: "notes.txt" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("not a video");
    expect((await post("/api/import", { slug: "demo", file: "IMG_1.MOV" }, {})).status).toBe(403);
  });

  test("the timeline skin is served as a stylesheet and a script", async () => {
    const css = await call("/skin.css");
    expect(css.headers.get("Content-Type")).toContain("text/css");
    expect(await css.text()).toContain("--color-bg-0");
    const js = await call("/skin.js");
    expect(js.headers.get("Content-Type")).toContain("javascript");
    expect(await js.text()).toContain("MutationObserver");
  });

  test("a reel with no video yet has no picture, and a bad name is not looked up", async () => {
    expect((await call("/thumb/demo.jpg")).status).toBe(404);
    expect((await call("/thumb/..%2F..%2Fsecret.jpg")).status).toBe(404);
  });

  test("opening the inbox folder is only for the app's own page", async () => {
    expect((await post("/api/inbox", {}, {})).status).toBe(403);
  });

  test("the first page asks about the AI until the user answers", async () => {
    expect(await (await call("/")).text()).toContain("data-setup");
    expect((await post("/api/assistant", { choice: "claude" }, {})).status).toBe(403);
    expect((await post("/api/assistant", { choice: "siri" })).status).toBe(400);
    expect(await (await call("/")).text()).toContain("data-setup");
  });

  test("choosing an assistant remembers it and starts it in the reel folder", async () => {
    const res = await post("/api/assistant", { choice: "claude" });
    expect(await res.json()).toMatchObject({ ok: true, name: "Claude Code", installed: true });
    expect(launched).toHaveLength(1);
    expect(launched[0]!.endsWith(".command")).toBe(true);
    expect(await Bun.file(launched[0]!).text()).toContain("exec claude");
    const page = await (await call("/")).text();
    expect(page).not.toContain("data-setup");
    expect(page).toContain("Ask Claude");
    const codex = (await (await post("/api/assistant", { choice: "codex" })).json()) as { installed: boolean; install: string };
    expect(codex.installed).toBe(false);
    expect(codex.install).toMatch(/^https:/);
  });

  test("saying no is remembered too, and the question can be brought back", async () => {
    await post("/api/assistant", { choice: "none" });
    expect(await (await call("/")).text()).not.toContain("data-setup");
    expect(launched).toHaveLength(2);
    await post("/api/assistant", { choice: "reset" });
    expect(await (await call("/")).text()).toContain("data-setup");
  });

  test("unknown paths are 404", async () => {
    expect((await call("/nope")).status).toBe(404);
  });
});

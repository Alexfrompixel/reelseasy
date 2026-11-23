import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASSISTANTS, findTool, launcherScript, prepareLauncher, readSettings, writeSettings } from "./assistant";

describe("the assistants ReelsEasy knows how to start", () => {
  test("are Claude Code and Codex, each with its command and where to get it", () => {
    expect(ASSISTANTS.claude).toMatchObject({ name: "Claude Code", command: "claude" });
    expect(ASSISTANTS.codex).toMatchObject({ name: "Codex", command: "codex" });
    for (const a of Object.values(ASSISTANTS)) expect(a.install).toMatch(/^https:\/\//);
  });
});

describe("findTool", () => {
  test("looks on the PATH and in the folders these tools install themselves to", () => {
    const there = (path: string) => path === "/Users/me/.local/bin/claude";
    expect(findTool("claude", { PATH: "/usr/bin:/bin", HOME: "/Users/me" }, there)).toBe("/Users/me/.local/bin/claude");
    expect(findTool("codex", { PATH: "/usr/bin:/bin", HOME: "/Users/me" }, there)).toBeUndefined();
    expect(findTool("codex", { PATH: "/opt/tools:/bin", HOME: "/Users/me" }, (p) => p === "/opt/tools/codex")).toBe("/opt/tools/codex");
  });
});

describe("launcherScript", () => {
  const script = launcherScript("/Users/me/Movies/Reels Easy", "claude");

  test("goes to the reel folder and starts the assistant there", () => {
    expect(script.startsWith("#!/bin/zsh\n")).toBe(true);
    expect(script).toContain("cd '/Users/me/Movies/Reels Easy' || exit 1");
    expect(script.trimEnd().endsWith("exec claude")).toBe(true);
  });

  test("says what to ask for, and where to get the assistant when it is missing", () => {
    expect(script).toContain("Edit the new clip in my inbox into a reel.");
    expect(script).toContain("command -v claude");
    expect(script).toContain(ASSISTANTS.claude.install);
  });

  test("a folder name with a quote in it cannot break out of the command", () => {
    expect(launcherScript("/Users/me/it's here", "codex")).toContain("cd '/Users/me/it'\\''s here' || exit 1");
  });
});

describe("on disk", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "reel-assistant-"));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("nothing is remembered until the user has answered", () => {
    expect(readSettings(root)).toEqual({});
    writeSettings(root, { asked: true, assistant: "claude" });
    expect(readSettings(root)).toEqual({ asked: true, assistant: "claude" });
  });

  test("the launcher is a file Terminal can run", () => {
    const path = prepareLauncher(root, "claude");
    expect(path.endsWith(".command")).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).mode & 0o111).not.toBe(0);
  });
});

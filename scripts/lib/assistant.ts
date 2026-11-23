/**
 * Editing by chat: ReelsEasy does not contain an AI. It hands the reel folder
 * to a coding agent the user already has (Claude Code, or Codex from the
 * makers of ChatGPT), which reads CLAUDE.md or AGENTS.md there and runs the
 * same commands a person would. This module remembers which one the user
 * picked and starts it in the right folder.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type AssistantId = "claude" | "codex";

export const ASSISTANTS: Record<AssistantId, { name: string; label: string; command: string; install: string }> = {
  claude: { name: "Claude Code", label: "Claude", command: "claude", install: "https://claude.com/claude-code" },
  codex: { name: "Codex", label: "ChatGPT (Codex)", command: "codex", install: "https://openai.com/codex/" },
};

export const isAssistant = (value: unknown): value is AssistantId => value === "claude" || value === "codex";

/** `asked` is set once the user has answered the first-launch question, whatever the answer. */
export type Settings = { asked?: boolean; assistant?: AssistantId | "none" };

const settingsFile = (root: string) => join(root, ".reelseasy.json");

export function readSettings(root: string): Settings {
  try {
    return JSON.parse(readFileSync(settingsFile(root), "utf8")) as Settings;
  } catch {
    return {};
  }
}

export function writeSettings(root: string, settings: Settings): void {
  writeFileSync(settingsFile(root), JSON.stringify(settings, null, 2) + "\n");
}

/** Where a command line tool is, or undefined. An app started from the Dock gets a short PATH, so the usual install folders are searched too. */
export function findTool(
  command: string,
  env: { PATH?: string; HOME?: string } = process.env,
  there: (path: string) => boolean = existsSync,
): string | undefined {
  const home = env.HOME ?? "";
  const folders = [...(env.PATH ?? "").split(":"), `${home}/.local/bin`, `${home}/.claude/local`, "/opt/homebrew/bin", "/usr/local/bin"];
  return folders.filter(Boolean).map((folder) => join(folder, command)).find(there);
}

const quoted = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

/** A script Terminal runs: go to the reel folder, say what to ask for, start the assistant. */
export function launcherScript(root: string, id: AssistantId): string {
  const { name, command, install } = ASSISTANTS[id];
  return `#!/bin/zsh
# Opens ${name} in your ReelsEasy folder. Written by ReelsEasy; safe to delete.
export PATH="$HOME/.local/bin:$HOME/.claude/local:/opt/homebrew/bin:/usr/local/bin:$PATH"
cd ${quoted(root)} || exit 1
clear
print "ReelsEasy: ${name} is starting in your reel folder."
print "Tell it what you want, for example:"
print "  Edit the new clip in my inbox into a reel."
print ""
if ! command -v ${command} >/dev/null 2>&1; then
  print "${name} is not installed on this Mac yet. Get it here:"
  print "  ${install}"
  print "Then press the button in ReelsEasy again."
  exit 0
fi
exec ${command}
`;
}

/** Writes the launcher for an assistant and returns its path. */
export function prepareLauncher(root: string, id: AssistantId): string {
  const folder = join(root, ".reelseasy");
  mkdirSync(folder, { recursive: true });
  const path = join(folder, `Open ReelsEasy with ${ASSISTANTS[id].name}.command`);
  writeFileSync(path, launcherScript(root, id));
  chmodSync(path, 0o755);
  return path;
}

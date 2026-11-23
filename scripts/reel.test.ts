import { describe, expect, test } from "bun:test";
import { parseArgs } from "./reel";

describe("parseArgs", () => {
  test("splits a command line into command, targets and options", () => {
    expect(parseArgs(["ingest", "inbox/a.mov", "--name", "first", "--language", "de"])).toEqual({
      command: "ingest",
      targets: ["inbox/a.mov"],
      options: { name: "first", language: "de" },
    });
  });

  test("an option without a value is a switch", () => {
    expect(parseArgs(["build", "first", "--reset"])).toEqual({
      command: "build",
      targets: ["first"],
      options: { reset: true },
    });
    expect(parseArgs(["serve", "--port", "4310", "--quiet"]).options).toEqual({ port: "4310", quiet: true });
  });

  test("no command at all", () => {
    expect(parseArgs([])).toEqual({ command: undefined, targets: [], options: {} });
  });
});

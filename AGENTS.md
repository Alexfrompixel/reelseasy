# ReelsEasy: instructions for coding agents

Everything an agent needs to edit reels in this folder is in [CLAUDE.md](CLAUDE.md): the commands, every field of a reel's `edit.json`, how edits made by hand in the app are kept, and the rules that are easy to break.

Read `CLAUDE.md` in full before you run anything or change a file. It applies to every agent, whatever its name.

The short version of the job: the user drops a clip in `inbox/` and says what they want. You run `bun scripts/reel.ts ingest`, write the creative decisions into `reels/<name>/edit.json`, run `bun scripts/reel.ts build <name>`, tell the user your plan before rendering, and render with `bun scripts/reel.ts render <name>`. You never upload or post anything.

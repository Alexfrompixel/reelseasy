# Contributing

Thank you for wanting to help. ReelsEasy is a developer preview, so the most useful things right now are reports from real use.

## Reports

Open an issue and say:

- your Mac (chip and macOS version);
- what you did, what you expected and what happened;
- for a clip that goes wrong: its length, how it was filmed (which phone, upright or sideways, HDR or not) and, if you can share it, the clip.

Never attach a clip with someone in it who has not agreed to that.

## Changes

1. `bun install`, then `bun test`. Everything should pass before you start.
2. Write the test first. Each file in `scripts/lib/` has a test file of the same name next to it.
3. Keep to what the project promises: everything runs on the user's Mac, with no account, no upload and no paid service. A change that sends anything anywhere, or needs a key, will not be merged without a discussion in an issue first.
4. Run `bun test` again, and for anything that changes a screen, build the app (`bash app/build.sh`) and look at it.
5. Open a pull request that says what changed and how you checked it.

`CLAUDE.md` explains how the pieces fit together and lists the rules that are easy to break. `docs/architecture.md` is the plan; if you want to take on part of it, say so in an issue first so two people do not build the same thing.

## What may not go into the repository

- Videos, exports or reels of yours: `inbox/`, `reels/` and `exports/` are ignored by git on purpose.
- Sound files you do not have the right to hand out. New sounds must be CC0 or your own, with the source added to `sfx/CREDITS.md`.

By contributing you agree that your contribution is licensed under the Apache License 2.0, like the rest of the code.

# ReelsEasy: architecture for a published, open-source app

Written 23 November 2026. This is a plan. Nothing in "Target" is built yet.

## What was decided

Decided on 23 November 2026:

| Question | Decision |
| --- | --- |
| What is the product? | A Mac app. Everything runs on the user's Mac: no accounts, no servers. |
| How do people get the AI part? | The app works alone (automatic cut and captions, editing by hand). People who use Claude Code or a similar agent can also instruct it to edit their reels. |
| How far does the redesign go? | Our own screens redesigned, and our colours laid over the timeline editor. |
| How is it distributed? | Free and open source, from reelseasy.com and GitHub. |

## Where it stands today

The app runs from a clone of this repository, on a Mac with the developer tools installed. There is no download that just opens yet, because:

- **It is a window around this project folder.** The folder's path and the path to `bun` are compiled into the app when it is built. Reels, clips and exports live inside the source code folder.
- **It needs tools installed by hand:** bun, ffmpeg, Node, and HyperFrames with its browser renderer and the Parakeet speech model (about 640 MB) already downloaded.
- **It is not signed.** macOS warns about, or blocks, an unsigned app downloaded from the internet.

What is already right for a product: no sign-in, requests accepted only from the app's own page, everything on localhost, one project shared by chat edits and hand edits, 192 tests.

## Target

```
ReelsEasy.app
├── Shell          Swift window (exists). Starts the engine, shows its pages, stops it on quit.
├── Engine         The TypeScript pipeline (exists), shipped inside the app as one program:
│                  ingest, build, import, render, and the local pages.
├── Tools          ffmpeg and the HyperFrames editor, shipped inside the app.
└── Skin           Our colours and name over the timeline editor (exists).

~/Movies/ReelsEasy/            the user's library: inbox, reels, exports
~/Library/Application Support/ReelsEasy/
                               downloaded on first run: speech model, browser renderer
reelseasy (command)            the same engine from a terminal, for agents
```

### The parts

1. **Shell.** Stays Swift and small. New: it finds the engine inside its own bundle instead of a compiled-in path, shows a first-run screen, and checks for updates.
2. **Engine.** The code in `scripts/` compiled to one program with `bun build --compile`, so users need neither bun nor Node. It takes the library folder as a setting instead of assuming the project folder.
3. **Tools inside the app.** ffmpeg, in a build whose licence allows redistribution (the Homebrew build is GPL; an LGPL build avoids putting GPL terms on the whole app). HyperFrames (Apache-2.0) as it is today, pinned to one version.
4. **Downloaded on first run, with a progress screen.** The speech model and the browser renderer are about 1 GB together. Shipping them inside the download would make it very large, and each has its own licence to respect. First run needs the internet once; after that the app works offline.
5. **Library.** `~/Movies/ReelsEasy` with `inbox`, `reels` and `exports`, chosen at first run and changeable. This separates the user's videos from the app, so updates never touch them.
6. **Agent interface.** How "instruct your Claude Code to use this app" works:
   - A `reelseasy` command (the engine under another name), installed from the app's menu.
   - An instructions file placed in the library folder (the user-facing part of today's `CLAUDE.md`: the commands, `edit.json`, the rules). Anyone who opens Claude Code or another agent in that folder can say "cut the pauses and add a glitch before the second sentence".
   - The contract is what exists today: the agent edits `edit.json` and runs `build`; hand edits in the app are never overwritten.
   - Later, if wanted: the same commands as an MCP server, so agents find them without reading a file.
7. **Updates.** Sparkle (the usual open-source updater for Mac apps), reading a feed from GitHub Releases.
8. **Website.** reelseasy.com as one static page: what it does, a short video, the download button (pointing at GitHub Releases), the link to the code. No accounts and no tracking.

### What does not change

- No account, no upload, no paid service. The app talks to the internet only for the first-run downloads and update checks.
- The user uploads to Instagram and TikTok themself.
- `edit.json` plus `build` stays the single way an edit is described.

## Licences and credits

- **Our code** is under Apache-2.0. The name ReelsEasy and the logo are not covered by it.
- **Sounds.** Five are CC0 and in the repository. Fourteen are under the Pixabay Content License and are not: they are cut on the user's Mac from the originals HyperFrames ships (`scripts/lib/pack.ts`). A packaged app would carry them inside the app, as part of a larger work.
- **HyperFrames** (Apache-2.0) is the timeline editor and the renderer. Its licence allows shipping and changing it, including hiding HeyGen's buttons and logo as the skin does, and requires keeping its licence and notice files in what is shipped. The README and `NOTICE` credit it.
- **Still to read and list before a packaged release:** the licences of the Parakeet speech model, the browser renderer, ffmpeg and the caption font. The Parakeet model's terms have not been verified.
- **The logo** was made with an image generator. If the name or logo is to be registered as a trademark, have it redrawn as a vector file and ask a lawyer first: how far generated artwork can be protected is not settled.

## Phases

Estimates are mine, in working days, and assume no surprises in phase 2.

| Phase | What | Days | Done when |
| --- | --- | --- | --- |
| 1 | Library outside the project folder; first-run screen that downloads the model and renderer | 3 to 4 | The app works from `/Applications` with reels in `~/Movies/ReelsEasy` |
| 2 | Engine and tools inside the app; nothing to install by hand | 4 to 6 | It runs on a Mac that has never seen bun, Node or ffmpeg |
| 3 | `reelseasy` command and the agent instructions file | 2 | A fresh Claude Code session in the library folder edits a reel from one sentence |
| 4 | Open-source preparation: licence, sounds, clean repository, README, contributing notes | done 23 Nov 2026 | A public repository that builds from a fresh clone |
| 5 | Signing, notarization, disk image, updates, website | 3 to 4 | A stranger downloads it from reelseasy.com and it opens without a warning |

Phase 5 needs an Apple Developer account ($99 a year).

Later, each its own decision: our own timeline editor in place of the skinned one; a built-in chat with the user's own AI key; Windows.

## Risks

- **Phase 2 is the uncertain one.** HyperFrames starts a browser to render. Whether that works from inside a signed, notarized app has not been tried. If it does not, the fallback is to keep the renderer in Application Support, outside the app bundle.
- **The skin depends on HyperFrames' internals:** its colour variables and the words on its buttons. An update can undo parts of it. The version is pinned, and each update needs a look.
- **Apple Silicon only at first.** Nothing has been run on an Intel Mac.
- **Still untested from earlier:** a clip from a real iPhone, dragging with a mouse, noisy locations. A public release should not happen before the first two.
- **Size.** About 1 GB is downloaded on first run. The first-run screen has to say so before it starts.

## Open decisions

1. Create the Apple Developer account now, or after phases 1 to 3?
2. Oldest macOS to support? Today the app asks for macOS 13.

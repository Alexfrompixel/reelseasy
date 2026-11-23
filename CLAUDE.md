# ReelsEasy

Turns a vertical iPhone clip into a finished 1080x1920 reel: pauses and filler cut, word-by-word captions, zooms, emojis, sound effects, transitions between pieces, picture effects (glitch, VHS and more), other clips brought in, a colour grade, sound levelled to -14 LUFS. Everything runs on this Mac for free, with no account and no sign-in. The user uploads the result to Instagram and TikTok themself; nothing here posts anywhere.

A reel can be edited two ways, and they share one project:

- **In chat**: the user describes a change, you edit `reels/<slug>/edit.json` and run `build`.
- **By hand**: the user opens the reel in the ReelsEasy app (a timeline editor) and drags pieces, trims, splits, moves sounds and effects, changes the grade, retypes captions.

## How a reel gets made

1. The user drops a clip in `inbox/`, or on the ReelsEasy icon in the Dock.
2. `bun scripts/reel.ts ingest inbox/<clip>` transcribes it, finds the silences, makes the working copy and writes `reels/<slug>/edit.json` with a proposed cut. It prints the transcript with word ids (`w12`) and the real pause after each phrase. (The app does this step itself for a dropped clip.) The speech model leaves out "um" and "uh", and can turn one into a wrong word; where a pause holds half a second or more of sound with no words, the transcript says so. Cut those by shortening the keep.
3. Read that transcript and write the creative decisions into `edit.json` (below). Tell the user the plan in a few lines and wait for their OK before rendering, unless they said not to ask.
4. `bun scripts/reel.ts build <slug>` applies the edit. It is always safe: see "Two editors, one project".
5. A second video (b-roll, a screen recording, another take) comes in with `bun scripts/reel.ts import <slug> <clip>`: see "Bringing in another clip".
6. Look before rendering: `node_modules/.bin/hyperframes snapshot reels/<slug> --at 0.5,3.2,… --no-end --output reels/<slug>/work/snaps`, then read `contact-sheet.jpg`.
7. `bun scripts/reel.ts render <slug>` writes `exports/<slug>.mp4` and checks it is 1080x1920 H.264 with sound.

## Two editors, one project

The cut is not baked into a video file. Every kept piece is its own clip on the timeline (`<video id="p1" … data-media-start>` in `index.html`), playing from the working copy `assets/source.mp4` or, for an imported clip, from `assets/clips/<name>.mp4`. That is what lets the user drag, trim, split and delete pieces in the editor. Every video clip on the timeline is a piece of the cut, whatever file it plays, except the layers the pipeline puts on top (below).

`build` (and the app, automatically, a third of a second after any change) does this:

- **The cut** is read from the timeline, never overwritten. It is saved back to `edit.json` as `pieces`, so `edit.json` always describes the whole reel.
- **Captions** are always rebuilt for the current cut, so they follow a piece wherever it goes. A caption word retyped in the editor is kept: it is stored in `captions.fixes` first.
- **Sounds, zooms and the grade** follow the cut too, but only while they are still where the pipeline put them. Each carries a note of the value that was written (`data-reel-start`, `data-reel-zoom`, `data-reel-look`). Once the user moves a sound, edits a zoom keyframe or regrades a piece, that item is theirs and is never touched again. `build` lists what it left alone.
- **Effects and inserted clips are layers on their own lane.** An effect is a short copy of the piece under it that carries the effect; an insert is a clip from `inserts`. They follow the cut like sounds do. One that the user moves or trims is theirs from then on: an insert becomes a piece like any other (saved with the cut), an effect copy just stops being re-placed. They can change an effect in the editor's inspector, where it shows as the clip's colour grading.
- **Transitions are code on the picture.** They show in the editor as keyframes on the "Stage" and "Veil" rows and are rewritten when the cut changes, unless that code was edited by hand.
- **A sound, effect or insert deleted by hand stays deleted.** An effect whose word was cut out of the reel is dropped and reported, not an error.
- **A hole is reported while editing and closed on export.** Deleting or dragging a piece away leaves a stretch with no picture. `build` lists it and leaves the layout alone, because that is the user's arrangement in progress. `render` and the app's Export pull the pieces together first (in the project, so the editor shows it) and say so. A gap covered by another picture, such as a title card, is left alone.

So after the first build, change effects by editing `edit.json` and running `build`. To change the cut from chat, use the editor's own commands so the result is identical to a drag: `node_modules/.bin/hyperframes timeline move|trim|split|delete '#p3' … --dir reels/<slug>`, then `build`.

`build --reset` regenerates the project from `edit.json`. The cut survives (it is in `pieces`); sounds, zooms and grades changed by hand are replaced. Ask before using it on a reel the user has edited.

The editor timeline is longer than the reel: there is empty "working room" after the last piece, because the editor refuses to move a clip past the end and pieces need somewhere to park while reordering. Exports stop at the last piece.

## edit.json

All times are in the SOURCE clip: seconds, or word ids from the transcript. Word ids survive any change to the cut, so prefer them.

- `keeps`: the first cut, source ranges in order. Start from the proposal (speech between pauses of 0.45 s or more, padded 0.1 s). A pause is silence plus any sound that holds no words: clicks, breaths and room noise do not become pieces. Sound of 0.6 s or more with no words is kept, in case the speech model missed something. Only used until the first build; after that `pieces` is the cut.
- `pieces`: written by the pipeline. Each is `{id, start, src: [from, to]}`, plus `file` when it plays an imported clip and `muted` when it is silent.
- `clips`: written by `import`: the videos brought into this reel, by name, with length, whether they have sound, and how many words.
- `captions.fixes`: `{"w5": "ReelsEasy"}` corrects a misheard word. `emphasis`: word ids that stay in the accent colour. `hide`: spoken but not captioned. `style`: `highlight` (all words shown, the spoken one lights up) or `reveal` (words pop in one by one). `maxWords`: 2 to 3 for energy, up to 5 for calm. `y`: caption centre in px from the top (default 1270). `accent`, `uppercase`. `emoji`: `above` (default) pops emojis over the caption line, `beside` puts them at the end of it; use `beside` when the face is close to the camera, or `above` lands on the mouth.
- `zooms`: `{"from": "w15", "to": "w18", "scale": 1.18, "focus": [0.5, 0.4], "type": "punch", "sound": "whoosh-in"}`. Types: `punch` (hard cut in and out), `smooth` (eases in and out), `push` (slow creep over the whole range, then a cut back). `focus` is the point to zoom toward as fractions of the frame; put it on the face. Scale 1.1 to 1.3 is the useful range. Zooms must not overlap.
- `emojis`: `{"word": "w23", "emoji": "⚡", "sound": "pop"}` pops the emoji above the caption when that word is spoken. A few per reel, not one per line.
- `sounds`: `[{"at": "w29", "sound": "typing-long", "until": "w30", "volume": 0.4}]` for a sound at any moment. `until` trims a long sound and fades it.
- `transitions`: `{"into": "w15", "type": "glitch"}` puts a transition on the cut that leads into a piece. `into` is a word (the piece that holds it) or a piece id (`"p4"`, `"c-take2"`). Types: `glitch`, `whip`, `zoom`, `flash`, `blur`, `dip` (to black), `shake`. Glitch, whip and zoom come with a sound; `"sound": "impact"` picks another, `"sound": false` none. A cut with no entry stays a hard cut. The first piece has no cut before it.
- `effects`: `{"from": "w20", "to": "w21", "effect": "glitch", "strength": 0.5, "sound": "glitch"}` changes the picture for that stretch. Effects: `glitch`, `rgb` (colour split), `vhs`, `crt`, `film`, `pixelate`, `blur`, `glow`, `bw`, `halftone`, `ascii`, `shake`, and `flash` (needs only `from`). Strength runs to 1; 0.5 is the standard amount.
- `inserts`: `{"clip": "broll", "at": "w22", "until": "w28", "mode": "pip"}` shows an imported clip over the speaker while the voice carries on. `mode`: `cover` (full frame, the default) or `pip` (a window in the top right; `"corner": "top-left"` moves it). `from` is where in the clip to start. Silent unless `volume` is set; with volume, its speech is captioned.
- `look`: a HyperFrames grade, e.g. `{"preset": "warm-daylight", "intensity": 0.8}`. Presets: `node_modules/.bin/hyperframes media-treatment --capability presets --json`. Leave it out for no grade.

## Bringing in another clip

`bun scripts/reel.ts import <slug> <clip>` converts a second video the same way as the first (upright, 9:16 centre crop, 30 fps, SDR, sound levelled), transcribes it and prints its transcript. Its word ids carry the clip name (`take2_w3`) and work everywhere a word id does. `--name` gives it a short name; use one, the default is the file name.

- With nothing else it goes on the timeline after the last piece, as a piece: it has its own sound and captions, and the user drags it where they want it. A clip with no sound track plays silent.
- `--after p3` puts it right after that piece and moves the rest along. `--from 1.5 --to 9.7` uses only that part of the clip.
- `--no-place` keeps it off the timeline, for use in `inserts`: that is the way to show b-roll over the voice.

In the app, a clip waiting in `inbox/` has "Add to a reel…" next to "Start a reel". It does the first of these.

## Sound pack

19 sounds in `sfx/`, all trimmed and levelled the same way, so one volume number means the same loudness for each. the user can listen to them in `sfx/preview.html`.

- Fly in and out: `whoosh-in` (builds and lands on the moment), `whoosh-out` (starts on the moment and trails off), `whoosh` (pass-by), `whoosh-fast`, `whoosh-long`.
- Typing: `typing` (1 s burst), `typing-long` (4 s laptop), `typing-mechanical` (7 s clicky), `key-press`.
- Accents: `pop`, `click`, `ping`, `chime`, `notification`, `sparkle`, `impact`, `riser`, `error`, `glitch`.

Timing is automatic: a sound that builds (`whoosh-in`, `whoosh`, `whoosh-long`, `riser`) starts early so its peak lands on the moment; the rest start on it. Sounds sit 10 to 15 dB under the voice at their default volume. Use them sparingly.

Licences are in `sfx/CREDITS.md`. Five sounds are CC0 and are in the repository. The other fourteen are under the Pixabay Content License, which does not allow handing the files out on their own, so they are not in the repository: `bun scripts/reel.ts sounds` (run by `bun install`) cuts them on this Mac from the originals that HyperFrames ships, using the cut points and levels in `scripts/lib/pack.ts`.

## The Mac app

`ReelsEasy.app` in the project folder is a native window around a local server. Build it with `bash app/build.sh` (needs only the Xcode command line tools). It is not in git, and it remembers where this folder is, so rebuild it if the folder moves.

- The app starts `bun scripts/reel.ts serve` on 127.0.0.1:4310 and stops it on quit. The server lists reels, ingests clips, starts the timeline editor on a reel (one HyperFrames Studio process per open reel, from port 4311) and exports.
- **Editing by chat is set up from the app.** The first time the reel list opens it asks whether the user edits with Claude Code or Codex (the coding agent from the makers of ChatGPT). Picking one writes a small script into `.reelseasy/` and opens it in Terminal: it goes to this folder and starts that tool, which then reads this file (Codex reads `AGENTS.md`, which points here). The answer is kept in `.reelseasy.json`; afterwards the list has an "Ask Claude" or "Ask Codex" button. ReelsEasy itself contains no AI and sends nothing anywhere. Only the Claude Code path has been tried; Codex is untested.
- No accounts. Requests are refused unless they come from the app's own page. Every request the editor page made in testing went to localhost.
- The timeline editor is HyperFrames Studio (Apache-2.0), shown under our own skin. Inside the app window the skin (`scripts/lib/theme.ts`, served as `/skin.css` and `/skin.js`) forces Studio dark in our navy and blue, puts the ReelsEasy mark where the HeyGen logo was, and hides what belongs to HeyGen's own product: "Install the desktop app", "Share", the theme switch, "Describe a change to the agent", and Studio's Export. In a plain browser Studio shows unskinned.
- **Export from "All Reels".** Studio's own Export renders the whole editor timeline, including the empty working room at the end; that is why the skin hides it.
- The skin works by Studio's own colour variables and by the words on its buttons. After any HyperFrames update, open a reel in the app and look: a renamed button comes back, a renamed variable goes warm grey.
- Colours live in `TOKENS` in `scripts/lib/theme.ts`: navy surfaces, blue for controls, the logo's coral-to-magenta only on the mark. Logo and icon files are in `brand/`, rebuilt from `brand/source/` by `bash brand/build.sh`.
- The name is ReelsEasy (site: reelseasy.com). The plan for a packaged, signed release is `docs/architecture.md`.
- To see the app's pages without the app: `bun scripts/reel.ts serve`, then open http://127.0.0.1:4310 in a browser.

## Rules that are easy to break

- To take the start off a clip from chat, do not use `hyperframes timeline trim --start`: it moves where the clip sits and keeps playing it from the same point. Import the part you want with `--from` and `--to`, or shorten the end with `trim --end`.
- Transitions and effects are seasoning. One kind of transition on two or three cuts and an effect or two reads as a choice; one on every cut reads as a template. Each effect layer is a second video playing at once, so many of them slow the editor's preview.
- Cuts belong on silences. Word timings are approximate (about 0.2 s); the silences in `work/silences.json` are exact. Never trim a piece to a word time without leaving padding.
- Platform UI covers the top 168 px and everything below 1330 px of the 1920 px frame. Captions and emojis stay between those lines.
- The first frame is the thumbnail: it needs a face and a caption, never black. When the reel opens on speech (first word within 0.6 s), the first caption is on screen from frame 0 at full size; a reel that opens on a longer silence has no caption there, so trim the start.
- Look at where the face is before choosing zooms and emojis. In a selfie the face fills the frame: the default zoom focus and an emoji above the caption can both land on the mouth. Set `focus` to the face in the snapshot and use `captions.emoji: "beside"`.
- Sound is levelled to -14 LUFS with one fixed gain. Phone clips are quiet with loud peaks, so a limiter holds the peaks at -2 dB; `ingest` says "peaks limited" when it did. If a clip needs more than about 20 dB, it was recorded too quietly and will hiss.
- Restart the app (or `serve`) after changing code in `scripts/`: a running server keeps the old code and rewrites open reels with it.
- Never write `index.html` wholesale on a built reel, and never edit `compositions/captions.html` by hand: the first is shared with the editor, the second is regenerated. Go through `edit.json` and `build`.
- Tests come first: a hook blocks a new code file without a same-named `.test.ts`. Run `bun test` after any change in `scripts/`. Use bun, never npm or npx.
- HyperFrames is pinned in `package.json`; run it as `node_modules/.bin/hyperframes`. Its telemetry is turned off on this Mac and stays off: skip the "usage beacon" line in its skill.
- The HyperFrames skills are the reference for anything beyond this pipeline (b-roll, title cards, music, transitions from its catalogue, other caption styles). They are not in this repository: `node_modules/.bin/hyperframes skills` installs them for the coding agent in use.

## What has been tested, and what has not

Tested on 21 November 2026 with real footage: 50 s of an unedited selfie video of a man speaking English ("Daniel speaking English", Wikitongues, CC BY-SA 4.0, from Wikimedia Commons; a test clip, not in this repository).

- Ingest, cut proposal, captions, zooms, emojis, sounds, grade and export all ran. The finished export was transcribed again and compared with its captions: every word matched, half of them within 0.06 s, the worst 0.26 s off, with no drift. Loudness -13.8 LUFS, no black frames.
- In the app: "Start a reel" from the inbox, Edit, and Export. With the editor open, a delete, a split and a swap of two pieces (through the editor's own commands) were followed by captions, sounds and zooms, the open editor refreshed by itself, and the export had the words in the new order.
- An iPhone-like file made from the same footage (4K, 60 fps, stored sideways with a rotation flag, mono, HDR-tagged, spaces and brackets in its name) came out upright at 1440x2560, 30 fps, stereo.

Tested on 22 November 2026 on the same reel, with two more clips made from the same footage: a 12 s take with speech (HEVC, mono) and an 8 s landscape clip with no sound.

- Import: both converted (the landscape one centre-cropped, the silent one muted). The take went into the cut after P3 using only seconds 1.5 to 9.7, and its eight words were captioned. The silent one was shown as a window and as a full-frame cutaway over the voice. From the app, "Add to a reel…" added a clip to a reel built before any of this existed.
- All seven transitions and the glitch, VHS, black-and-white and shake effects were looked at in stills and rendered. The export was transcribed again: all 61 words matched, the imported take included, half within 0.06 s, the worst 0.33 s. No black frames, -13.5 LUFS, 28 s to render 42 s.
- Through the editor's own commands: a moved insert became a piece of its own, a deleted effect stayed deleted, and after two pieces were swapped the transitions and effects followed them.
- In the editor the effect copies and inserts show on a lane of their own, and the transitions as keyframes on the Stage and Veil rows.

Not proven:

- No clip filmed on a real iPhone yet. The HDR step ran, but on footage that was only labelled HDR, so its colours are still unchecked on a real HDR clip.
- Nobody has dragged with a mouse yet: the automated browser could not drive Studio's drag handling. Whether Studio lets a piece be dropped between two others, or needs free space first, is unknown.
- Not yet tried by hand: dropping a clip on the Dock icon, retyping a caption in Studio, changing a grade in Studio, Studio's keyboard shortcuts inside the app window.
- The limiter's effect on the voice was measured (about 12% of the speech touches it, 4% by more than 3 dB) but not listened to.
- Noisy places: silence is found at a fixed -35 dB. Outdoors or with music playing, there may be no silences to cut on.
- Transitions and effects were judged from stills, not watched in motion: their timing and how they feel are the user's call. The sounds that come with them were placed, not listened to.
- An effect copy must show exactly the frame of the piece under it. In stills it did; a one-frame mismatch would show as a flicker at an effect's edges in motion.
- A file dropped straight into the editor window, bypassing the app: it becomes a piece, but it is not converted, so an iPhone HDR clip may look washed out or fail to render. Import through the app or the command.
- Dropping a clip on the Dock icon always starts a new reel; adding it to an open reel from there is not built.
- Speech in an imported clip is captioned, but its pauses are not cut for you: trim it by hand or import the part you want.
- Studio's own catalogue of 52 shader transitions is not wired in; the seven here are our own.
- A piece whose speed is changed in the editor will have mistimed captions: the pipeline assumes normal speed.
- Whisper large-v3 was compared with Parakeet on the sample clip on 22 November 2026, against the loudness of the audio itself. Words: the same, except that Whisper did not turn the "um" into "Nine". Timing: worse. Whisper pushed the last word before a pause into the pause ("language." 1.3 s late, "name?" 0.4 s late) and ran about a second early through "I will teach you some words"; Parakeet's words sat on the bursts of sound. Parakeet stays the default. Only English was compared.
- Speech model: Parakeet, 25 European languages including English, German, Russian and Ukrainian. For others: `ingest … --engine whisper --model large-v3 --language xx` (a 3 GB download the first time, and looser word timing).

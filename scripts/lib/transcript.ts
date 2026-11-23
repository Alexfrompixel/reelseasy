/** A spoken word. `clip` names the imported clip it belongs to; left out for the reel's own source. */
export type Word = { id: string; text: string; start: number; end: number; clip?: string };

type WhisperToken = { text: string; offsets?: { from: number; to: number } };
type WhisperJson = { transcription: { tokens?: WhisperToken[] }[] };
type LooseWord = { text: string; start: number; end: number };

const round = (n: number) => Math.round(n * 1000) / 1000;
const isSpecial = (t: string) => /^\[_.*\]$/.test(t.trim());
const isNoise = (t: string) => /^[♪�♪-♯\s]*$/.test(t);

/**
 * Turn whisper.cpp JSON (what `hyperframes transcribe` writes) into whole words.
 * Whisper emits sub-word tokens: a token starting with a space opens a new word,
 * anything else (word pieces, punctuation) belongs to the word before it.
 */
export function wordsFromWhisper(input: WhisperJson | LooseWord[]): Word[] {
  const raw: LooseWord[] = [];

  if (Array.isArray(input)) {
    for (const w of input) raw.push({ text: w.text.trim(), start: w.start, end: w.end });
  } else {
    for (const segment of input.transcription ?? []) {
      let opened = false;
      for (const token of segment.tokens ?? []) {
        if (!token.offsets || isSpecial(token.text)) continue;
        const start = token.offsets.from / 1000;
        const end = token.offsets.to / 1000;
        const startsWord = token.text.startsWith(" ") || !opened;
        if (startsWord) {
          raw.push({ text: token.text.trim(), start, end });
          opened = true;
        } else {
          const last = raw[raw.length - 1]!;
          last.text += token.text;
          last.end = Math.max(last.end, end);
        }
      }
    }
  }

  return raw
    .filter((w) => w.text.length > 0 && !isNoise(w.text))
    .map((w, i) => ({ id: `w${i}`, text: w.text, start: round(w.start), end: round(w.end) }));
}

/**
 * Speech models time words loosely around pauses: a word's end gets smeared
 * across the silence after it, or a word is placed a little before the speech
 * it belongs to. The detected silences are the truth about where sound is, so
 * every word is moved into the stretch of speech it belongs to and squeezed to
 * fit there. Text and order never change.
 */
export function snapWordsToSpeech(
  words: Word[],
  silences: [number, number][],
  duration: number,
): Word[] {
  if (!silences.length || !words.length) return words;

  const islands: [number, number][] = [];
  let cursor = 0;
  for (const [s, e] of [...silences].sort((a, b) => a[0] - b[0])) {
    if (s - cursor > 0.05) islands.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (duration - cursor > 0.05) islands.push([cursor, duration]);
  if (!islands.length) return words;

  // Each word goes to the island it overlaps most, else the nearest one,
  // never an island before the previous word's.
  const members: Word[][] = islands.map(() => []);
  let from = 0;
  for (const word of words) {
    let best = from;
    let bestScore = -Infinity;
    for (let i = from; i < islands.length; i++) {
      const [a, b] = islands[i]!;
      const overlap = Math.min(word.end, b) - Math.max(word.start, a);
      const distance = Math.max(a - word.end, word.start - b, 0);
      const score = overlap > 0 ? overlap : -distance - 1000;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    members[best]!.push(word);
    from = best;
  }

  const out: Word[] = [];
  members.forEach((list, index) => {
    if (!list.length) return;
    const [a, b] = islands[index]!;
    const room = Math.min(0.12, (b - a) / list.length);
    const clamp = (t: number) => Math.min(Math.max(t, a), b);
    const starts = list.map((w) => clamp(w.start));
    for (let i = 1; i < starts.length; i++) starts[i] = Math.max(starts[i]!, starts[i - 1]! + room);
    for (let i = starts.length - 1; i >= 0; i--) {
      starts[i] = Math.min(starts[i]!, b - (starts.length - i) * room);
    }
    list.forEach((word, i) => {
      const limit = i < list.length - 1 ? starts[i + 1]! : b;
      const end = Math.min(Math.max(clamp(word.end), starts[i]! + room), limit);
      out.push({ ...word, start: round(starts[i]!), end: round(end) });
    });
  });
  return out;
}

const stamp = (s: number) => s.toFixed(2).padStart(6, "0");

/**
 * A compact reading view of the transcript: one line per phrase, broken at
 * pauses, with word ids and the pause that follows. This is what the editor
 * reads to decide cuts, zooms and emoji, instead of the raw JSON.
 */
export function packTranscript(words: Word[], gap = 0.4, silences: [number, number][] = []): string {
  const lines: string[] = [];
  let phrase: Word[] = [];
  const quiet = [...silences].sort((a, b) => a[0] - b[0]);

  // Seconds of sound between two times: what is left once the silences are taken out.
  const soundBetween = (from: number, to: number) => {
    let silent = 0;
    for (const [s, e] of quiet) silent += Math.max(0, Math.min(e, to) - Math.max(s, from));
    return to - from - silent;
  };

  const flush = (next?: Word) => {
    if (!phrase.length) return;
    const first = phrase[0]!;
    const last = phrase[phrase.length - 1]!;
    const ids = first.id === last.id ? first.id : `${first.id}-${last.id}`;
    let pause = "";
    if (next) {
      const length = next.start - last.end;
      // The speech model leaves out "um" and "uh". Sound with no words is the hint.
      const sound = quiet.length ? soundBetween(last.end, next.start) : 0;
      const hint = sound >= 0.5 ? `, of which ${sound.toFixed(2)}s is sound with no words: um, breath or noise` : "";
      pause = `  (gap ${length.toFixed(2)}s${hint})`;
    }
    const text = phrase.map((w) => w.text).join(" ");
    lines.push(`[${stamp(first.start)}-${stamp(last.end)}] ${ids}  ${text}${pause}`);
    phrase = [];
  };

  words.forEach((word, i) => {
    phrase.push(word);
    const next = words[i + 1];
    if (!next || next.start - word.end >= gap) flush(next);
  });

  return lines.join("\n");
}

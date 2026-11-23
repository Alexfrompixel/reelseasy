/** One entry of sfx/manifest.json. */
export type SoundInfo = {
  file: string;
  duration: number;
  /** Seconds into the file that should land on the cue: 0 for a hit, the peak for a build. */
  sync: number;
  volume: number;
  use?: string;
};

/**
 * A sound wanted at a moment on the timeline. `key` names where it came from
 * (a zoom, an emoji, an entry in the sounds list) so the same sound keeps the
 * same id when the timeline is rearranged.
 */
export type Moment = { key?: string; at: number; sound: string; volume?: number; until?: number };

/** A sound placed on the timeline, ready to become an <audio> clip. */
export type Cue = {
  id: string;
  sound: string;
  file: string;
  start: number;
  mediaStart: number;
  duration: number;
  volume: number;
  fadeOut?: number;
};

const round = (n: number) => Math.round(n * 1000) / 1000;
const FADE = 0.08;

/**
 * Place each wanted sound on the timeline. A sound is shifted so its sync
 * point lands on the moment (a fly-in starts early and peaks on it), it never
 * runs past `until` or the end of the film, and anything cut short fades out.
 */
export function planCues(
  moments: Moment[],
  pack: Record<string, SoundInfo>,
  filmDuration: number,
): Cue[] {
  const unknown = [...new Set(moments.map((m) => m.sound).filter((name) => !pack[name]))];
  if (unknown.length) {
    throw new Error(
      `Unknown sound: ${unknown.join(", ")}. The pack has: ${Object.keys(pack).join(", ")}`,
    );
  }

  const cues: (Omit<Cue, "id"> & { key?: string })[] = [];
  for (const moment of moments) {
    const info = pack[moment.sound]!;
    let start = moment.at - info.sync;
    let mediaStart = 0;
    if (start < 0) {
      mediaStart = -start;
      start = 0;
    }
    const full = info.duration - mediaStart;
    const limit = Math.min(moment.until ?? Infinity, filmDuration) - start;
    const duration = Math.min(full, limit);
    if (duration < 0.05) continue;
    cues.push({
      ...(moment.key ? { key: moment.key } : {}),
      sound: moment.sound,
      file: info.file,
      start: round(start),
      mediaStart: round(mediaStart),
      duration: round(duration),
      volume: moment.volume ?? info.volume,
      ...(duration < full - 0.001 ? { fadeOut: FADE } : {}),
    });
  }

  return cues
    .sort((a, b) => a.start - b.start)
    .map(({ key, ...cue }, i) => ({ id: `sfx-${key ?? i}`, ...cue }));
}

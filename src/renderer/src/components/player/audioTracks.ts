import { preferredAudioLanguage, preferredAudioOrder } from "@shared/types";

export interface PlayerAudioTrack {
  id: string;
  label: string;
  language: string;
}

/** Keep only English, Arabic, and French manifest tracks, without losing engine indexes. */
export function supportedAudioTracks(tracks: PlayerAudioTrack[]): PlayerAudioTrack[] {
  return tracks.filter((track) =>
    preferredAudioLanguage(`${track.language} ${track.label}`) !== null,
  );
}

export function preferredTrack(tracks: PlayerAudioTrack[], preferred: string): PlayerAudioTrack | null {
  for (const language of preferredAudioOrder(preferred)) {
    const match = tracks.find(
      (track) => preferredAudioLanguage(`${track.language} ${track.label}`) === language,
    );
    if (match) return match;
  }
  return null;
}

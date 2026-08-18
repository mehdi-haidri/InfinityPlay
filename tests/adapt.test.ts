import { describe, expect, it } from "vitest";
import {
  cleanMovieBoxTitle,
  detectAudioLanguage,
  captionsToSubtitles,
} from "../src/main/providers/moviebox/adapt";
import { ORIGINAL_AUDIO } from "../src/shared/types";

describe("MovieBox title cleaning", () => {
  it("strips audio dub tags in brackets", () => {
    expect(cleanMovieBoxTitle("Spider-Man: Brand New Day [Hindi]")).toBe("Spider-Man: Brand New Day");
    expect(cleanMovieBoxTitle("Inception[French]")).toBe("Inception");
    expect(cleanMovieBoxTitle("Avengers: Endgame [Arabic]")).toBe("Avengers: Endgame");
  });

  it("strips CAM tags", () => {
    expect(cleanMovieBoxTitle("Deadpool & Wolverine [CAM]")).toBe("Deadpool & Wolverine");
    expect(cleanMovieBoxTitle("Avatar 3[Hindi][CAM]")).toBe("Avatar 3");
  });

  it("strips dubbed parentheses markers", () => {
    expect(cleanMovieBoxTitle("Kalki 2898 AD (Dubbed)")).toBe("Kalki 2898 AD");
    expect(cleanMovieBoxTitle("RRR (Hindi Dubbed)")).toBe("RRR");
  });

  it("strips trailing season suffix", () => {
    expect(cleanMovieBoxTitle("Stranger Things S4")).toBe("Stranger Things");
    expect(cleanMovieBoxTitle("The Boys S03")).toBe("The Boys");
    expect(cleanMovieBoxTitle("House of the Dragon S2-S3")).toBe("House of the Dragon");
  });

  it("preserves legitimate titles containing S words", () => {
    expect(cleanMovieBoxTitle("Shrek")).toBe("Shrek");
    expect(cleanMovieBoxTitle("Spider-Man: No Way Home")).toBe("Spider-Man: No Way Home");
  });
});

describe("Audio language detection", () => {
  it("detects Hindi and English dub markers", () => {
    expect(detectAudioLanguage("Stranger Things [Hindi]")).toBe("Hindi");
    expect(detectAudioLanguage("Spider-Man (English)")).toBe("English");
    expect(detectAudioLanguage("Dune (French)")).toBe("French");
    expect(detectAudioLanguage("Money Heist (Arabic)")).toBe("Arabic");
  });

  it("falls back to ORIGINAL_AUDIO when no dub marker is present", () => {
    expect(detectAudioLanguage("The Dark Knight")).toBe(ORIGINAL_AUDIO);
    expect(detectAudioLanguage("Oppenheimer")).toBe(ORIGINAL_AUDIO);
  });
});

describe("Captions mapping", () => {
  it("transforms raw captions into SubtitleOption models with language codes", () => {
    const payload = {
      extCaptions: [
        {
          id: "cap-1",
          lan: "en",
          lanName: "English",
          url: "https://subtitles.example.com/en.vtt",
        },
        {
          id: "cap-2",
          lan: "ar",
          lanName: "Arabic",
          url: "https://subtitles.example.com/ar.vtt",
        },
      ],
    };

    const mapped = captionsToSubtitles(payload);
    expect(mapped.length).toBe(2);
    expect(mapped[0].name).toBe("English");
    expect(mapped[0].lang).toBe("en");
    expect(mapped[0].url).toBe("https://subtitles.example.com/en.vtt");
    expect(mapped[1].name).toBe("Arabic");
    expect(mapped[1].lang).toBe("ar");
  });
});

import { describe, expect, it } from "vitest";
import { cleanSubtitleCueText, srtToVtt } from "../src/main/providers/subtitles";
import { cleanCueText, parseVttCues } from "../src/renderer/src/components/player/subtitles";

describe("Arabic and Translated Subtitle Normalization", () => {
  it("removes literal /n, \\n, and \\N from Arabic subtitle text and converts to real line breaks", () => {
    expect(cleanSubtitleCueText("مرحبا/nكيف حالك")).toBe("مرحبا\nكيف حالك");
    expect(cleanSubtitleCueText("مرحبا /n كيف حالك")).toBe("مرحبا\nكيف حالك");
    expect(cleanSubtitleCueText("مرحبا\\Nكيف حالك")).toBe("مرحبا\nكيف حالك");
    expect(cleanSubtitleCueText("مرحبا \\N كيف حالك")).toBe("مرحبا\nكيف حالك");
    expect(cleanSubtitleCueText("مرحبا\\nكيف حالك")).toBe("مرحبا\nكيف حالك");
    expect(cleanSubtitleCueText("مرحبا \\n كيف حالك")).toBe("مرحبا\nكيف حالك");
    expect(cleanSubtitleCueText("مرحبا/Nكيف حالك")).toBe("مرحبا\nكيف حالك");
  });

  it("strips ASS/SSA tags and HTML formatting from subtitle cues", () => {
    expect(cleanSubtitleCueText("{\\an8}مرحبا /n كيف حالك")).toBe("مرحبا\nكيف حالك");
    expect(cleanSubtitleCueText("<i>مرحبا</i><br>/nكيف حالك")).toBe("مرحبا\nكيف حالك");
    expect(cleanCueText("{\\pos(192,200)}أهلاً وسهلاً /n بك")).toBe("أهلاً وسهلاً\nبك");
  });

  it("converts SRT containing /n to valid WebVTT without /n literals", () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
مرحبا /n كيف حالك اليوم؟

2
00:00:05,000 --> 00:00:08,000
أنا بخير،\\Nشكراً لك.
`;

    const vtt = srtToVtt(srt);
    expect(vtt).toContain("WEBVTT");
    expect(vtt).not.toContain("/n");
    expect(vtt).not.toContain("\\N");
    expect(vtt).toContain("مرحبا\nكيف حالك اليوم؟");
    expect(vtt).toContain("أنا بخير،\nشكراً لك.");
  });

  it("parses WebVTT cues properly with cleaned text", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
مرحبا /n كيف حالك

00:00:05.000 --> 00:00:08.000
{\\an8}وداعاً \\n أراك لاحقاً
`;

    const cues = parseVttCues(vtt);
    expect(cues.length).toBe(2);
    expect(cues[0].text).toBe("مرحبا\nكيف حالك");
    expect(cues[1].text).toBe("وداعاً\nأراك لاحقاً");
  });
});

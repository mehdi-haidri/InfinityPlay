import { describe, expect, it } from "vitest";
import { formatBytes, formatTime, qualityLabel } from "../src/renderer/src/lib/format";

describe("Format Utilities", () => {
  it("formats file sizes cleanly", () => {
    expect(formatBytes(0)).toBe("");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024 * 500)).toBe("500 MB");
    expect(formatBytes(1024 * 1024 * 1024 * 2.5)).toBe("2.5 GB");
  });

  it("formats video timestamps cleanly", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(3665)).toBe("1:01:05");
  });

  it("resolves user-facing quality labels", () => {
    expect(qualityLabel(2160)).toBe("4K");
    expect(qualityLabel(1080)).toBe("1080p");
    expect(qualityLabel(720)).toBe("720p");
    expect(qualityLabel(480)).toBe("480p");
    expect(qualityLabel(0)).toBe("Auto");
  });
});

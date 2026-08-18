import { describe, expect, it } from "vitest";
import { parseM3u, channelCountry } from "../src/main/providers/m3u";

describe("M3U Playlist Parsing", () => {
  it("parses EXTINF attributes, categories, and stream URLs", () => {
    const m3uContent = `#EXTM3U
#EXTINF:-1 tvg-id="cnn.us" tvg-name="CNN US" tvg-logo="https://logo.example/cnn.png" group-title="News" tvg-country="US",CNN HD
https://stream.example/cnn/index.m3u8
#EXTINF:-1 tvg-id="sky.sports.uk" group-title="Sports" tvg-country="GB",Sky Sports News
https://stream.example/skysports.m3u8
`;

    const channels = parseM3u(m3uContent);
    expect(channels.length).toBe(2);

    expect(channels[0].name).toBe("CNN HD");
    expect(channels[0].id).toBe("cnn.us");
    expect(channels[0].group).toBe("News");
    expect(channels[0].country).toBe("US");
    expect(channels[0].logo).toBe("https://logo.example/cnn.png");
    expect(channels[0].streamUrl).toBe("https://stream.example/cnn/index.m3u8");

    expect(channels[1].name).toBe("Sky Sports News");
    expect(channels[1].id).toBe("sky.sports.uk");
    expect(channels[1].group).toBe("Sports");
    expect(channels[1].country).toBe("GB");
    expect(channels[1].streamUrl).toBe("https://stream.example/skysports.m3u8");
  });

  it("extracts country from tvg-country or tvg-id suffix", () => {
    expect(channelCountry('tvg-country="FR"', "france24.fr")).toBe("FR");
    expect(channelCountry("", "aljazeera.qa")).toBe("QA");
    expect(channelCountry('tvg-country="US;CA"', "abc.us")).toBe("US");
  });

  it("parses EXTVLCOPT custom referrer and user-agent headers", () => {
    const m3uWithHeaders = `#EXTM3U
#EXTINF:-1 tvg-id="protected.tv",Protected Live TV
#EXTVLCOPT:http-referrer=https://authorized.example.com
#EXTVLCOPT:http-user-agent=InfinityPlayCustomAgent
https://stream.example/protected.m3u8
`;
    const channels = parseM3u(m3uWithHeaders);
    expect(channels.length).toBe(1);
    expect(channels[0].headers?.Referer).toBe("https://authorized.example.com");
    expect(channels[0].headers?.["User-Agent"]).toBe("InfinityPlayCustomAgent");
  });
});

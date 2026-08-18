import { describe, expect, it } from "vitest";
import { parseXmlTv } from "../src/main/providers/epg";

describe("XMLTV EPG Parsing", () => {
  it("parses valid programme schedules for matching channel IDs", () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const year = now.getUTCFullYear();
    const month = pad(now.getUTCMonth() + 1);
    const day = pad(now.getUTCDate());
    const startStr = `${year}${month}${day}120000 +0000`;
    const stopStr = `${year}${month}${day}130000 +0000`;

    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
    <tv>
      <channel id="bbc1.uk">
        <display-name>BBC One</display-name>
      </channel>
      <programme start="${startStr}" stop="${stopStr}" channel="bbc1.uk">
        <title lang="en">BBC News &amp; Weather</title>
        <desc>Latest national &amp; international news updates.</desc>
      </programme>
      <programme start="${startStr}" stop="${stopStr}" channel="itv1.uk">
        <title>ITV News</title>
        <desc>Afternoon headlines</desc>
      </programme>
    </tv>`;

    const parsed = parseXmlTv(sampleXml, ["bbc1.uk"]);
    expect(parsed["bbc1.uk"]).toBeDefined();
    expect(parsed["bbc1.uk"].length).toBe(1);
    expect(parsed["bbc1.uk"][0].title).toBe("BBC News & Weather");
    expect(parsed["bbc1.uk"][0].description).toBe("Latest national & international news updates.");
    expect(parsed["itv1.uk"]).toBeUndefined();
  });

  it("handles CDATA and numeric HTML entities safely", () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const year = now.getUTCFullYear();
    const month = pad(now.getUTCMonth() + 1);
    const day = pad(now.getUTCDate());
    const startStr = `${year}${month}${day}100000 +0000`;
    const stopStr = `${year}${month}${day}110000 +0000`;

    const sampleXml = `
      <programme start="${startStr}" stop="${stopStr}" channel="test.ch">
        <title><![CDATA[Special &amp; Live Event]]></title>
        <desc>Watch &#39;The Show&#39; &#x26; more</desc>
      </programme>
    `;

    const parsed = parseXmlTv(sampleXml, ["test.ch"]);
    expect(parsed["test.ch"]?.[0]?.title).toBe("Special & Live Event");
    expect(parsed["test.ch"]?.[0]?.description).toContain("The Show");
  });
});

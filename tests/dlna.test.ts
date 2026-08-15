import { describe, expect, it } from "vitest";
import {
  didlMetadata,
  hms,
  parseDescription,
  secondsFromHms,
  ssdpLocation,
} from "../src/shared/dlna";
import { srtToVtt } from "../src/main/providers/subtitles";

describe("DLNA discovery and metadata", () => {
  it("reads case-insensitive SSDP location headers", () => {
    expect(ssdpLocation("HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.4/device.xml\r\n"))
      .toBe("http://192.168.1.4/device.xml");
  });

  it("resolves renderer control URLs", () => {
    const description = parseDescription(`
      <root><device><friendlyName>Living Room TV</friendlyName><modelName>Panel 4K</modelName>
      <serviceList><service>
        <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
        <controlURL>/upnp/control/avtransport</controlURL>
      </service></serviceList></device></root>
    `, "http://192.168.1.9:1400/device.xml");

    expect(description.name).toBe("Living Room TV");
    expect(description.transport?.controlUrl).toBe("http://192.168.1.9:1400/upnp/control/avtransport");
  });

  it("advertises the selected VTT sidecar using common renderer extensions", () => {
    const xml = didlMetadata({
      url: "http://192.168.1.2:4000/movie.mp4",
      title: "A & B",
      mimeType: "video/mp4",
      subtitleUrl: "http://192.168.1.2:4000/captions.vtt",
      durationSeconds: 3723,
    });

    expect(xml).toContain("A &amp; B");
    expect(xml).toContain("sec:CaptionInfo");
    expect(xml).toContain("sec:CaptionInfoEx");
    expect(xml).toContain("pv:subtitleFileUri");
    expect(xml).toContain("text/vtt");
    expect(xml).toContain('duration="1:02:03"');
  });

  it("round-trips UPnP clock values", () => {
    expect(hms(3723.9)).toBe("1:02:03");
    expect(secondsFromHms("1:02:03.500")).toBe(3723.5);
  });
});

describe("cast subtitle normalization", () => {
  it("turns SRT into receiver-compatible WebVTT", () => {
    const vtt = srtToVtt("1\r\n00:00:01,250 --> 00:00:03,500\r\nHello TV\r\n");
    expect(vtt).toContain("WEBVTT");
    expect(vtt).toContain("00:00:01.250 --> 00:00:03.500");
    expect(vtt).toContain("Hello TV");
    expect(vtt).not.toMatch(/^1$/m);
  });
});

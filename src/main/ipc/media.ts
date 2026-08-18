import type { PreparedLiveStream } from "@shared/types";
import { generateMediaPreview, prepareLiveStream, setDecodableCodecs, stageManifest } from "../live";
import { handle } from "./handle";

export function registerMediaIpc(): void {
  handle("media:prepareLive", (url: string, startAt: number, resolution: number): Promise<PreparedLiveStream> =>
    prepareLiveStream(url, startAt, resolution),
  );
  handle("media:preview", (url: string, position: number, resolution: number) =>
    generateMediaPreview(url, position, resolution),
  );
  handle("media:stageManifest", (xml: string) => stageManifest(xml));
  handle("media:decodable", (codecs: string[]) => {
    setDecodableCodecs(Array.isArray(codecs) ? codecs : []);
    return true;
  });
}

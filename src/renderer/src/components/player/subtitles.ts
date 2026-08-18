export interface VttCue {
  start: number;
  end: number;
  text: string;
}

export function parseVttTime(timeStr: string): number {
  const parts = timeStr.trim().replace(",", ".").split(":");
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  } else if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(timeStr) || 0;
}

export function cleanCueText(text: string): string {
  if (!text) return "";
  return text
    // Strip ASS/SSA tags like {\an8}, {\pos(100,200)}, {\c&H0000FF&}
    .replace(/\{[^}]*\}/g, "")
    // Convert HTML break tags to real newlines
    .replace(/<br\s*\/?>/gi, "\n")
    // Remove other HTML formatting tags (<i>, <b>, <font>, etc.)
    .replace(/<[^>]+>/g, "")
    // Convert literal escaped newlines common in Arabic and machine-translated subs:
    // \N (ASS hard break), \n, /n, /N, \\n, \\N, \r\n, etc.
    .replace(/(?:\\+r\\+n|\\+n|\\+N|\/[nN])/g, "\n")
    // Collapse multiple consecutive newlines into one
    .replace(/[ \t]*\n(?:[ \t]*\n)+/g, "\n")
    // Clean up spaces around newlines
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

export function parseVttCues(vttText: string): VttCue[] {
  if (!vttText) return [];
  const cues: VttCue[] = [];
  const blocks = vttText.replace(/^\uFEFF/, "").replace(/^WEBVTT[^\n]*\n/i, "").split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^([\d:.ms,]+)\s*-->\s*([\d:.ms,]+)/);
      if (match) {
        const start = parseVttTime(match[1]);
        const end = parseVttTime(match[2]);
        const rawText = lines.slice(i + 1).join("\n");
        const text = cleanCueText(rawText);
        if (text) cues.push({ start, end, text });
        break;
      }
    }
  }
  return cues;
}

/**
 * Release notes for the build that is running.
 *
 * RELEASES.md is inlined at build time, so About can show what shipped in this version with no
 * network call. Notes for a *newer* version come from the update itself — electron-updater
 * carries the GitHub release body, which is this same file at that version.
 */
import source from "../../../../RELEASES.md?raw";

export interface ReleaseSection {
  version: string;
  body: string;
}

/** `## 0.3.0 (Latest Update)` — the parenthetical is a label, not part of the version. */
const HEADING = /^##\s+([0-9][^\s(]*)/;

function sections(markdown: string): ReleaseSection[] {
  const found: ReleaseSection[] = [];
  let current: { version: string; lines: string[] } | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading) {
      if (current) found.push({ version: current.version, body: current.lines.join("\n").trim() });
      current = { version: heading[1], lines: [] };
      continue;
    }
    // A horizontal rule separates versions in this file; it carries no meaning inside a section.
    if (current && line.trim() !== "---") current.lines.push(line);
  }

  if (current) found.push({ version: current.version, body: current.lines.join("\n").trim() });
  return found;
}

const parsed = sections(source);

/** The notes for a specific version, or null when the file has no section for it. */
export function notesForVersion(version: string): ReleaseSection | null {
  const wanted = version.trim().replace(/^v/i, "");
  return parsed.find((entry) => entry.version === wanted) ?? null;
}

/** The topmost section, used when the running version predates the notes file. */
export function newestNotes(): ReleaseSection | null {
  return parsed[0] ?? null;
}

/**
 * Normalizes updater-provided notes to one release. GitHub may return the whole notes
 * file, while electron-updater may return a single release body; About should never
 * render historical sections below the newest/main update.
 */
export function latestNotesFrom(markdown: string, version = ""): ReleaseSection | null {
  const body = markdown.trim();
  if (!body) return null;
  const remote = sections(body);
  if (remote.length === 0) {
    return { version: version.trim().replace(/^v/i, ""), body };
  }
  const wanted = version.trim().replace(/^v/i, "");
  return remote.find((entry) => entry.version === wanted) ?? remote[0];
}

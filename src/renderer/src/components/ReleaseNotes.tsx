import { Fragment, type ReactNode } from "react";

/**
 * Renders the small Markdown subset RELEASES.md actually uses: `###` group headings, `-` bullets,
 * `**bold**`, `` `code` `` and links. Pulling in a Markdown library for five constructs would cost
 * more than it returns, and this keeps the notes as elements rather than raw HTML.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`;

    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }

    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    // Links render as plain text: the notes live inside the app, and opening a browser from
    // here is exactly what the update card is meant to avoid.
    if (link) return <Fragment key={key}>{link[1]}</Fragment>;

    return <Fragment key={key}>{part}</Fragment>;
  });
}

export function ReleaseNotes({ body }: { body: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flush = () => {
    if (bullets.length === 0) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul className="release-notes-list" key={`list-${blocks.length}`}>
        {items.map((item, index) => (
          <li key={index}>{inline(item, `b${blocks.length}-${index}`)}</li>
        ))}
      </ul>,
    );
  };

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();

    if (line.startsWith("- ")) {
      bullets.push(line.slice(2));
      continue;
    }

    flush();
    if (line.startsWith("### ")) {
      blocks.push(
        <h4 className="release-notes-heading" key={`h-${blocks.length}`}>
          {line.slice(4)}
        </h4>,
      );
    } else if (line.length > 0) {
      blocks.push(
        <p className="release-notes-text" key={`p-${blocks.length}`}>
          {inline(line, `p${blocks.length}`)}
        </p>,
      );
    }
  }
  flush();

  return <div className="release-notes">{blocks}</div>;
}

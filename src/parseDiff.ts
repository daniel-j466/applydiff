export type HunkLineKind = 'context' | 'add' | 'remove';

export interface HunkLine {
  kind: HunkLineKind;
  text: string;
  /** 1-indexed line number within the diff file itself, for parse-error reporting. */
  diffLine: number;
}

export interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  /** 1-indexed line number of the "@@ ... @@" header, within the diff file. */
  headerLine: number;
  lines: HunkLine[];
}

export interface ParsedDiff {
  hunks: Hunk[];
}

export class DiffParseError extends Error {
  constructor(
    message: string,
    readonly diffPath: string,
    readonly line: number,
    readonly column: number,
    readonly sourceLine: string,
  ) {
    super(message);
    this.name = 'DiffParseError';
  }
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parses a unified diff (as produced by `diff -u` or `git diff`) into hunks.
 * Only a single file's worth of hunks is expected; file header lines
 * (---, +++, diff, index) are recognized and skipped rather than parsed.
 */
export function parseDiff(diffText: string, diffPath: string): ParsedDiff {
  const rawLines = diffText.split('\n');
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }

  const hunks: Hunk[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];

    if (
      line.trim() === '' ||
      line.startsWith('---') ||
      line.startsWith('+++') ||
      line.startsWith('diff ') ||
      line.startsWith('index ')
    ) {
      i++;
      continue;
    }

    if (!line.startsWith('@@')) {
      throw new DiffParseError(
        'unexpected line outside of a hunk',
        diffPath,
        i + 1,
        1,
        line,
      );
    }

    const match = HUNK_HEADER.exec(line);
    if (!match) {
      throw new DiffParseError(
        'malformed hunk header, expected "@@ -<start>[,<count>] +<start>[,<count>] @@"',
        diffPath,
        i + 1,
        1,
        line,
      );
    }

    const oldStart = Number(match[1]);
    const oldCount = match[2] !== undefined ? Number(match[2]) : 1;
    const newStart = Number(match[3]);
    const newCount = match[4] !== undefined ? Number(match[4]) : 1;
    const headerLine = i + 1;
    i++;

    const lines: HunkLine[] = [];
    let seenOld = 0;
    let seenNew = 0;

    while (seenOld < oldCount || seenNew < newCount) {
      if (i >= rawLines.length) {
        throw new DiffParseError(
          `hunk ends before its declared line counts are satisfied ` +
            `(expected ${oldCount} old line(s) and ${newCount} new line(s))`,
          diffPath,
          headerLine,
          1,
          rawLines[headerLine - 1],
        );
      }

      const raw = rawLines[i];
      const prefix = raw.charAt(0);
      const text = raw.slice(1);

      if (prefix === ' ') {
        lines.push({ kind: 'context', text, diffLine: i + 1 });
        seenOld++;
        seenNew++;
      } else if (prefix === '-') {
        lines.push({ kind: 'remove', text, diffLine: i + 1 });
        seenOld++;
      } else if (prefix === '+') {
        lines.push({ kind: 'add', text, diffLine: i + 1 });
        seenNew++;
      } else if (raw === '') {
        // Some diff tools emit a bare blank line to mean an empty context line.
        lines.push({ kind: 'context', text: '', diffLine: i + 1 });
        seenOld++;
        seenNew++;
      } else if (raw.startsWith('\\')) {
        // e.g. "\ No newline at end of file" — not a content line.
      } else {
        throw new DiffParseError(
          `expected a line starting with ' ', '+', or '-' inside a hunk, found ${JSON.stringify(prefix)}`,
          diffPath,
          i + 1,
          1,
          raw,
        );
      }

      i++;
    }

    hunks.push({ oldStart, oldCount, newStart, newCount, headerLine, lines });
  }

  if (hunks.length === 0) {
    throw new DiffParseError('no hunks found in diff', diffPath, 1, 1, rawLines[0] ?? '');
  }

  return { hunks };
}

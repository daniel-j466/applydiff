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

export interface FileDiff {
  /** Path from the "---" header, with a leading "a/" stripped, or null for "/dev/null". */
  oldPath: string | null;
  /** Path from the "+++" header, with a leading "b/" stripped, or null for "/dev/null". */
  newPath: string | null;
  hunks: Hunk[];
}

export interface ParsedDiff {
  files: FileDiff[];
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

/** Strips the "a/" or "b/" prefix git diffs put on paths, and drops the trailing timestamp `diff -u` adds. */
function parseHeaderPath(rest: string): string | null {
  const path = rest.split('\t')[0].trimEnd();
  if (path === '/dev/null') return null;
  return /^[ab]\//.test(path) ? path.slice(2) : path;
}

/**
 * Parses a unified diff (as produced by `diff -u` or `git diff`) into one or
 * more per-file hunk lists. A "---"/"+++" pair starts a new file section;
 * every hunk that follows belongs to that file until the next such pair.
 * Diffs with no file header lines at all are treated as a single anonymous
 * file, so bare hunks still work.
 */
export function parseDiff(diffText: string, diffPath: string): ParsedDiff {
  const rawLines = diffText.split('\n');
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }

  const files: FileDiff[] = [];
  let currentFile: FileDiff | null = null;
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];

    if (line.trim() === '' || line.startsWith('diff ') || line.startsWith('index ')) {
      i++;
      continue;
    }

    if (line.startsWith('--- ') || line === '---') {
      const oldPath = parseHeaderPath(line.slice(3).trimStart());
      const headerLineNo = i + 1;
      i++;
      if (i >= rawLines.length || !(rawLines[i].startsWith('+++ ') || rawLines[i] === '+++')) {
        throw new DiffParseError(
          'expected a "+++" line after "---"',
          diffPath,
          headerLineNo,
          1,
          line,
        );
      }
      const newPath = parseHeaderPath(rawLines[i].slice(3).trimStart());
      i++;
      currentFile = { oldPath, newPath, hunks: [] };
      files.push(currentFile);
      continue;
    }

    if (line.startsWith('+++')) {
      throw new DiffParseError(
        'unexpected "+++" line without a preceding "---" line',
        diffPath,
        i + 1,
        1,
        line,
      );
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

    if (!currentFile) {
      // A bare diff with no "---"/"+++" headers at all; treat it as one unnamed file.
      currentFile = { oldPath: null, newPath: null, hunks: [] };
      files.push(currentFile);
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

    currentFile.hunks.push({ oldStart, oldCount, newStart, newCount, headerLine, lines });
  }

  if (files.length === 0) {
    throw new DiffParseError('no hunks found in diff', diffPath, 1, 1, rawLines[0] ?? '');
  }

  return { files };
}

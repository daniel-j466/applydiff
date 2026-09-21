import type { Hunk } from './parseDiff.js';

export class PatchError extends Error {
  constructor(
    message: string,
    readonly targetPath: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(message);
    this.name = 'PatchError';
  }
}

function findFirstDifference(expected: string, actual: string): number {
  const len = Math.min(expected.length, actual.length);
  for (let i = 0; i < len; i++) {
    if (expected[i] !== actual[i]) return i;
  }
  return len;
}

function mismatchError(
  targetPath: string,
  lineNumber: number,
  expected: string,
  actual: string,
  hunk: Hunk,
): PatchError {
  const column = findFirstDifference(expected, actual) + 1;
  const gutterWidth = `  ${lineNumber} | `.length;
  const pointer = ' '.repeat(gutterWidth + column - 1) + '^';

  const message =
    `context mismatch at ${targetPath}:${lineNumber}:${column}\n\n` +
    `  expected | ${lineNumber} | ${expected}\n` +
    `  actual   | ${lineNumber} | ${actual}\n` +
    `${pointer}\n\n` +
    `hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ ` +
    `(diff line ${hunk.headerLine}) does not match ${targetPath} at this position.\n` +
    `the file may have local edits, or the diff was made against a different revision.`;

  return new PatchError(message, targetPath, lineNumber, column);
}

function oldLinesOf(hunk: Hunk): string[] {
  const lines: string[] = [];
  for (const line of hunk.lines) {
    if (line.kind === 'context' || line.kind === 'remove') lines.push(line.text);
  }
  return lines;
}

/**
 * Swaps a hunk's old and new sides so applying it undoes the original edit:
 * added lines become lines to remove, removed lines become lines to add, and
 * the declared start/count pairs swap along with them. Context lines are
 * unaffected since they're unchanged by the edit in either direction.
 */
function reverseHunk(hunk: Hunk): Hunk {
  return {
    oldStart: hunk.newStart,
    oldCount: hunk.newCount,
    newStart: hunk.oldStart,
    newCount: hunk.oldCount,
    headerLine: hunk.headerLine,
    lines: hunk.lines.map((line) => {
      if (line.kind === 'add') return { ...line, kind: 'remove' };
      if (line.kind === 'remove') return { ...line, kind: 'add' };
      return line;
    }),
  };
}

export function reverseHunks(hunks: Hunk[]): Hunk[] {
  return hunks.map(reverseHunk);
}

function matchesAt(lines: string[], pos: number, oldLines: string[]): boolean {
  for (let k = 0; k < oldLines.length; k++) {
    if (lines[pos + k] !== oldLines[k]) return false;
  }
  return true;
}

/**
 * Looks for where a hunk's old-side lines actually occur, starting from its
 * declared position and expanding outward one line at a time in both
 * directions. Preceding hunks earlier in the same diff can shift a file's
 * line numbers (added or removed lines change everything below them), so a
 * later hunk's declared start is often off by exactly that amount; searching
 * outward finds the nearest place the content actually lines up rather than
 * requiring every hunk to be re-numbered by hand. Returns null if nothing
 * within the file matches, in which case the caller falls back to the
 * declared position to produce a precise mismatch error.
 */
function findShiftedPosition(
  lines: string[],
  minPos: number,
  declaredPos: number,
  oldLines: string[],
): number | null {
  if (oldLines.length === 0) {
    return declaredPos >= minPos && declaredPos <= lines.length ? declaredPos : null;
  }

  const maxPos = lines.length - oldLines.length;
  if (maxPos < minPos) return null;

  const maxOffset = Math.max(declaredPos - minPos, maxPos - declaredPos);
  for (let offset = 0; offset <= maxOffset; offset++) {
    const forward = declaredPos + offset;
    if (forward >= minPos && forward <= maxPos && matchesAt(lines, forward, oldLines)) {
      return forward;
    }
    if (offset > 0) {
      const backward = declaredPos - offset;
      if (backward >= minPos && backward <= maxPos && matchesAt(lines, backward, oldLines)) {
        return backward;
      }
    }
  }

  return null;
}

/**
 * Applies a file's hunks (in order) to the contents of that file, returning
 * the patched text. Each hunk is first tried at the line number it declares;
 * if that doesn't match, nearby lines are searched for the same content
 * before giving up, so a hunk shifted by earlier unrelated edits still
 * applies instead of failing outright. Only when no matching position exists
 * anywhere in the file does it report a precise mismatch error.
 */
export function applyPatch(original: string, hunks: Hunk[], targetPath: string): string {
  const hadTrailingNewline = original.endsWith('\n');
  const originalLines = original.split('\n');
  if (hadTrailingNewline) originalLines.pop();

  const resultLines: string[] = [];
  let cursor = 0; // 0-based index into originalLines

  for (const hunk of hunks) {
    const declaredStart = hunk.oldStart - 1;
    const hunkStart =
      findShiftedPosition(originalLines, cursor, declaredStart, oldLinesOf(hunk)) ?? declaredStart;

    if (hunkStart < cursor) {
      throw new PatchError(
        `hunk at diff line ${hunk.headerLine} targets ${targetPath}:${hunk.oldStart}, ` +
          `which overlaps content already consumed by an earlier hunk (up to line ${cursor}).`,
        targetPath,
        hunk.oldStart,
        1,
      );
    }
    if (hunkStart > originalLines.length) {
      throw new PatchError(
        `hunk at diff line ${hunk.headerLine} starts at ${targetPath}:${hunk.oldStart}, ` +
          `but ${targetPath} only has ${originalLines.length} line(s).`,
        targetPath,
        originalLines.length + 1,
        1,
      );
    }

    while (cursor < hunkStart) {
      resultLines.push(originalLines[cursor]);
      cursor++;
    }

    for (const hunkLine of hunk.lines) {
      if (hunkLine.kind === 'add') {
        resultLines.push(hunkLine.text);
        continue;
      }

      const lineNumber = cursor + 1;
      if (cursor >= originalLines.length) {
        throw new PatchError(
          `hunk at diff line ${hunk.headerLine} expects a line at ${targetPath}:${lineNumber}, ` +
            `but the file ends at line ${originalLines.length}.`,
          targetPath,
          lineNumber,
          1,
        );
      }

      const actual = originalLines[cursor];
      if (actual !== hunkLine.text) {
        throw mismatchError(targetPath, lineNumber, hunkLine.text, actual, hunk);
      }

      if (hunkLine.kind === 'context') {
        resultLines.push(actual);
      }
      cursor++;
    }
  }

  while (cursor < originalLines.length) {
    resultLines.push(originalLines[cursor]);
    cursor++;
  }

  return resultLines.join('\n') + (hadTrailingNewline ? '\n' : '');
}

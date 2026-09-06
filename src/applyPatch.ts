import type { Hunk, ParsedDiff } from './parseDiff.js';

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

/**
 * Applies a parsed unified diff to the contents of a file, returning the
 * patched text. Hunks are applied in order and must match the target
 * exactly at the line numbers they declare — there is no fuzzy offset
 * search yet, so a shifted file will fail with a precise mismatch error
 * rather than silently applying in the wrong place.
 */
export function applyPatch(original: string, diff: ParsedDiff, targetPath: string): string {
  const hadTrailingNewline = original.endsWith('\n');
  const originalLines = original.split('\n');
  if (hadTrailingNewline) originalLines.pop();

  const resultLines: string[] = [];
  let cursor = 0; // 0-based index into originalLines

  for (const hunk of diff.hunks) {
    const hunkStart = hunk.oldStart - 1;

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

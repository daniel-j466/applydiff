#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { parseDiff, DiffParseError, type FileDiff } from './parseDiff.js';
import { applyPatch, reverseHunks, PatchError } from './applyPatch.js';

function usage(): string {
  return (
    'usage: applydiff <target-file> <patch-file> [-o <output-file>] [--reverse] [--dry-run]\n' +
    '       applydiff <patch-file> [-o <output-file>] [--reverse] [--dry-run]\n\n' +
    'Applies a unified diff (as produced by `diff -u` or `git diff`) to a file.\n\n' +
    'With <target-file> and <patch-file>, applies a single-file patch to\n' +
    '<target-file> and writes the result to stdout, or to <output-file> if -o\n' +
    'is given.\n\n' +
    'With only <patch-file>, each file the diff touches is patched in place\n' +
    'at the path recorded in its own "+++" header, relative to the current\n' +
    'directory. -o is only valid there if the patch touches a single file.\n\n' +
    '--reverse undoes the patch: lines the diff added are removed and lines\n' +
    'it removed are added back, so it applies cleanly to an already-patched\n' +
    'file and reproduces the original.\n\n' +
    '--dry-run checks that every hunk applies without writing anything or\n' +
    'printing the patched content, so a mismatch can be caught before it\n' +
    'touches the file.'
  );
}

function fail(message: string): never {
  process.stderr.write(message.endsWith('\n') ? message : message + '\n');
  process.exit(1);
}

function formatDiffParseError(err: DiffParseError): string {
  const gutter = `  ${err.line} | `;
  const pointer = ' '.repeat(gutter.length + err.column - 1) + '^';
  return (
    `${err.message} at ${err.diffPath}:${err.line}:${err.column}\n\n` +
    `${gutter}${err.sourceLine}\n` +
    `${pointer}`
  );
}

function readTarget(targetPath: string): string {
  try {
    return readFileSync(targetPath, 'utf8');
  } catch (err) {
    fail(`cannot read target file "${targetPath}": ${(err as Error).message}`);
  }
}

function applyToExplicitTarget(
  targetPath: string,
  file: FileDiff,
  outputPath: string | undefined,
  reverse: boolean,
  dryRun: boolean,
): void {
  const original = readTarget(targetPath);
  const hunks = reverse ? reverseHunks(file.hunks) : file.hunks;
  const patched = applyPatch(original, hunks, targetPath);
  if (dryRun) {
    process.stdout.write(`${targetPath}: applies cleanly\n`);
  } else if (outputPath) {
    writeFileSync(outputPath, patched, 'utf8');
  } else {
    process.stdout.write(patched);
  }
}

function resolveOwnPath(file: FileDiff, patchPath: string): string {
  const path = file.newPath ?? file.oldPath;
  if (path === null) {
    fail(
      `patch file "${patchPath}" deletes a file (no path in its "+++" header), ` +
        `which applydiff does not support.`,
    );
  }
  return path;
}

function applyInPlace(
  file: FileDiff,
  patchPath: string,
  outputPath: string | undefined,
  reverse: boolean,
  dryRun: boolean,
): void {
  const targetPath = resolveOwnPath(file, patchPath);
  const original = readTarget(targetPath);
  const hunks = reverse ? reverseHunks(file.hunks) : file.hunks;
  const patched = applyPatch(original, hunks, targetPath);
  if (dryRun) {
    process.stdout.write(`${targetPath}: applies cleanly\n`);
    return;
  }
  const destination = outputPath ?? targetPath;
  writeFileSync(destination, patched, 'utf8');
  process.stdout.write(`patched ${targetPath}${outputPath ? ` -> ${outputPath}` : ''}\n`);
}

function main(argv: string[]): void {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    process.stdout.write(usage() + '\n');
    process.exit(args.length === 0 ? 1 : 0);
  }

  let outputPath: string | undefined;
  let reverse = false;
  let dryRun = false;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-o') {
      outputPath = args[i + 1];
      i++;
    } else if (args[i] === '--reverse') {
      reverse = true;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else {
      positional.push(args[i]);
    }
  }

  if (positional.length < 1 || positional.length > 2) {
    fail(usage());
  }
  if (dryRun && outputPath) {
    fail('--dry-run does not write output, so -o cannot be given with it.');
  }
  const targetPath: string | undefined = positional.length === 2 ? positional[0] : undefined;
  const patchPath: string = positional.length === 2 ? positional[1] : positional[0];

  let diffText: string;
  try {
    diffText = readFileSync(patchPath, 'utf8');
  } catch (err) {
    fail(`cannot read patch file "${patchPath}": ${(err as Error).message}`);
  }

  try {
    const diff = parseDiff(diffText, patchPath);

    if (targetPath) {
      if (diff.files.length !== 1) {
        fail(
          `patch file "${patchPath}" touches ${diff.files.length} files, but a single ` +
            `target file "${targetPath}" was given.\nOmit <target-file> to patch each ` +
            `file in the diff at its own recorded path.`,
        );
      }
      applyToExplicitTarget(targetPath, diff.files[0], outputPath, reverse, dryRun);
    } else {
      if (outputPath && diff.files.length !== 1) {
        fail(
          `-o requires a patch that touches exactly one file ` +
            `(this one touches ${diff.files.length}).`,
        );
      }
      for (const file of diff.files) {
        applyInPlace(file, patchPath, outputPath, reverse, dryRun);
      }
    }
  } catch (err) {
    if (err instanceof DiffParseError) {
      fail(formatDiffParseError(err));
    } else if (err instanceof PatchError) {
      fail(err.message);
    } else {
      throw err;
    }
  }
}

main(process.argv);

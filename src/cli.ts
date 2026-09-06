#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { parseDiff, DiffParseError } from './parseDiff.js';
import { applyPatch, PatchError } from './applyPatch.js';

function usage(): string {
  return (
    'usage: applydiff <target-file> <patch-file> [-o <output-file>]\n\n' +
    'Applies a unified diff (as produced by `diff -u` or `git diff`) to <target-file>\n' +
    'and writes the result to stdout, or to <output-file> if -o is given.'
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

function main(argv: string[]): void {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    process.stdout.write(usage() + '\n');
    process.exit(args.length === 0 ? 1 : 0);
  }

  let outputPath: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-o') {
      outputPath = args[i + 1];
      i++;
    } else {
      positional.push(args[i]);
    }
  }

  const [targetPath, patchPath] = positional;
  if (!targetPath || !patchPath) {
    fail(usage());
  }

  let original: string;
  let diffText: string;
  try {
    original = readFileSync(targetPath, 'utf8');
  } catch (err) {
    fail(`cannot read target file "${targetPath}": ${(err as Error).message}`);
  }
  try {
    diffText = readFileSync(patchPath, 'utf8');
  } catch (err) {
    fail(`cannot read patch file "${patchPath}": ${(err as Error).message}`);
  }

  try {
    const diff = parseDiff(diffText, patchPath);
    const patched = applyPatch(original, diff, targetPath);
    if (outputPath) {
      writeFileSync(outputPath, patched, 'utf8');
    } else {
      process.stdout.write(patched);
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

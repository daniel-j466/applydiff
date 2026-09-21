# applydiff

A command-line tool that applies a unified diff to a file, with error
messages that actually tell you where things went wrong.

## the problem

`patch` and `git apply` are both notorious for saying almost nothing when a
hunk doesn't match. You get `malformed patch` or `error: patch failed:
file.txt:12` and then you're on your own, opening the file and the diff
side by side trying to figure out which line moved. When the mismatch is a
single trailing space or a tab that got turned into spaces, this can take
longer than writing the fix would have.

`applydiff` does one thing: it applies a unified diff to the file or files
it touches, and when a hunk's context doesn't match, it shows you the exact
line, the exact column of the first differing character, and a caret
pointing at it.

## usage

```
applydiff <target-file> <patch-file> [-o <output-file>] [--reverse]
applydiff <patch-file> [-o <output-file>] [--reverse]
```

Given `greet.js`:

```js
function greet(name) {
  return "Hello, " + name;
}
```

and `greet.diff`:

```diff
--- a/greet.js
+++ b/greet.js
@@ -1,3 +1,3 @@
 function greet(name) {
-  return "Hello, " + name;
+  return `Hello, ${name}!`;
 }
```

Running:

```
applydiff greet.js greet.diff
```

prints the patched file to stdout:

```js
function greet(name) {
  return `Hello, ${name}!`;
}
```

Use `-o` to write the result to a file instead:

```
applydiff greet.js greet.diff -o greet.patched.js
```

## when it fails

If `greet.js` had already been edited so line 2 reads
`return "Hello there, " + name;`, the same command fails like this:

```
context mismatch at greet.js:2:19

  expected | 2 |   return "Hello, " + name;
  actual   | 2 |   return "Hello there, " + name;
                            ^

hunk @@ -1,3 +1,3 @@ (diff line 4) does not match greet.js at this position.
the file may have local edits, or the diff was made against a different revision.
```

Line, column, both versions of the line, and which hunk in the diff file
caused it — everything needed to go fix the actual disagreement instead of
guessing. Malformed diffs get the same treatment, pointing at the exact
line and column of the patch file that doesn't parse.

## building

```
npm install
npm run build
node dist/cli.js <target-file> <patch-file>
```

No third-party runtime dependencies — the tool only uses Node's built-in
`node:fs`. `typescript` and `@types/node` are devDependencies needed to
compile it.

## multi-file patches

A patch produced by `git diff` (or `diff -u` over several files) can contain
one `---`/`+++`/hunk block per file. Give `applydiff` just the patch file,
with no `<target-file>`, and it patches each file in place at the path
recorded in its own `+++` header, relative to the current directory:

```
applydiff multi.diff
```

```
patched src/greet.js
patched src/farewell.js
```

`-o` still works, but only when the patch touches exactly one file, since it
names a single destination. To patch a single-file diff against a file at a
different path than the one recorded in the diff, pass `<target-file>`
explicitly as in the single-file form above.

## fuzzy matching

Each hunk is first tried at the exact line number the diff declares. If
that doesn't match, `applydiff` searches outward from that position, one
line at a time in both directions, for the nearest spot where the hunk's
context and removed lines line up exactly. This means a hunk still applies
correctly when an earlier hunk in the same diff added or removed lines and
shifted everything below it, without needing to renumber anything by hand.
If no matching position exists anywhere in the file, it falls back to the
declared position and reports the same precise mismatch shown above.

## reversing a patch

`--reverse` undoes a patch instead of applying it: lines the diff added are
treated as lines to remove, and lines it removed are added back. This lets
you run the exact same patch file against the already-patched result to get
the original file back, without keeping a separate inverse diff around:

```
applydiff greet.js greet.diff -o greet.patched.js
applydiff greet.patched.js greet.diff -o greet.js --reverse
```

Context mismatches are reported the same way as a forward apply, since a
reversed hunk still has to line up with the file it's given.

## limitations (for now)

The fuzzy search matches lines exactly; it doesn't tolerate whitespace
differences or partial context matches within a hunk. See the roadmap for
where this is headed.

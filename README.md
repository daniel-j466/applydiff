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

`applydiff` does one thing: it applies a unified diff to a single file, and
when a hunk's context doesn't match the file, it shows you the exact line,
the exact column of the first differing character, and a caret pointing at
it.

## usage

```
applydiff <target-file> <patch-file> [-o <output-file>]
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

## limitations (for now)

Hunks are matched at the exact line numbers the diff declares. There is no
fuzzy searching for shifted content yet, so if the file has unrelated edits
above the hunk that change its line count, you'll get a context mismatch
even though the actual lines the hunk cares about are untouched. See the
roadmap for where this is headed.

---
title: 'Metadata & filename normalizer (LLM round-trip)'
type: 'feature'
created: '2026-07-04'
status: 'done'
context: []
baseline_commit: 'f5da0c5aebdd1ea8617fbd932f9fcc8465ab47b6'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A music library has messy, inconsistent filenames (`富士山下 (128kbps).mp3`, `Beyond -情人Official MV.mp3`) and patchy tags — many files are missing artist/album, some have wrong ones. The user wants to clean names and metadata with help from an LLM, without the tool itself calling any LLM API.

**Approach:** A manual two-step round-trip added as CLI subcommands. `export-tags <folder>` reads each audio file's current title/artist/album and writes a JSON manifest — a top-level object `{ instructions, files }` where each file entry carries its **original filename** (`origName`), absolute `path`, current tags, and an empty `newName`. The `instructions` block warns the LLM that the same title may be a *different* artist (cover/live version), so it must not merge distinct artists and should keep the original when unsure. The user pastes that JSON into an LLM, which fills cleaned tags + `newName`, and pastes it back. `apply-tags <manifest.json>` reads the returned JSON (`files` only) and, per file, writes the tags (stream-copy, non-destructive) and renames the file to `newName`. Reuses the existing `scan` and the `-c copy -metadata` ffmpeg pattern.

## Boundaries & Constraints

**Always:**
- Read tags via bundled ffprobe (`-show_entries format_tags`); write via bundled ffmpeg with `-map 0 -c copy` (stream copy — audio bytes never re-encoded).
- Match tag keys case-insensitively (title/artist/album); missing tag → empty string in the manifest.
- Preserve the raw artist signal for the LLM: every export entry keeps the original filename (`origName`) verbatim alongside the tag artist, and the manifest's `instructions` block tells the LLM that same-title files may be genuinely different artists (covers/live) — never merge them, keep the original if unsure. The tool never parses artists from filenames or decides artist identity itself.
- Apply overwrites tags with each entry's **non-empty** fields only; an empty field leaves the existing tag untouched (never blanks a tag).
- `newName` is sanitized before use: strip any directory separators (file always stays in its original directory), replace Windows-reserved chars (`< > : " / \ | ? *`) and control chars, trim trailing dots/spaces, and **force the original file extension** (strip/replace whatever extension the LLM supplied).
- Renames are atomic: write tags to a temp file in the same directory, then rename onto the target.
- Never overwrite a different existing file: if a sanitized target already exists and is not the source itself, fail that entry and keep the original.
- Per-file isolation: one entry's failure is reported and the run continues; exit non-zero if any entry failed.

**Ask First:**
- Adding any runtime dependency (reuse `commander`, `ffmpeg-static`, `ffprobe-static` only).
- Having the tool call an LLM/network API — out of scope; the round-trip is manual by design.

**Never:**
- Re-encoding audio to change tags or names (stream copy only).
- Moving files across directories or changing their extension/container.
- Deleting or clobbering a pre-existing unrelated file.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Export | `export-tags ./music` | `{instructions, files}` JSON (default `music-tags.json`); one `files` entry/file: `{origName, path, artist, title, album, newName:""}`; missing tags → `""` | Unreadable file → reported, skipped, others continue |
| Same title, diff artist | Two files, same title, different `origName`/artist | Both exported unchanged; `instructions` warns LLM not to merge — identity decided downstream by LLM | N/A |
| Apply rename + tags | Entry with filled tags + `newName` | Non-empty tags written, file renamed to sanitized `newName` in its own dir | ffmpeg error → keep original, report, continue |
| Apply, empty newName | `newName:""`, tags filled | Tags applied, no rename | N/A |
| Apply, no changes | All tags empty + empty newName | No-op, reported skipped | N/A |
| Illegal newName | `newName:"a/b:c?.flac"` for an `.mp3` | Sanitized to `a_b-c_.mp3` (sep dropped, ext forced); empty after sanitize → skip+report | N/A |
| Target collision | Sanitized target is a different existing file | Entry failed, original kept, exit non-zero | Reported |
| Dry run apply | `apply-tags m.json --dry-run` | Prints planned writes/renames, writes nothing | N/A |
| Bad manifest | Not JSON / no `files` array / entry missing `path` | Fail fast, clear message, exit non-zero | Validate before any write |

</frozen-after-approval>

## Code Map

- `src/cli.js` -- MODIFY: restructure into subcommands. `normalize <folder>` becomes the default command (`{isDefault:true}`) so `music-normalize <folder>` and its flags keep working unchanged; add `export-tags <folder> [-o,--out <file>]` and `apply-tags <manifest> [--dry-run]`.
- `src/ffmpeg.js` -- ADD `readTags(filePath)` (ffprobe format_tags → `{artist,title,album}`, case-insensitive) and `writeTags(inputPath, outputPath, tags)` (`-map 0 -c copy -metadata …` for each non-empty field). All ffmpeg interaction stays here.
- `src/manifest.js` -- NEW pure logic: an `INSTRUCTIONS` string constant (the cover/different-artist guidance), `resolveNewName(rawNewName, originalPath)` (sanitize + force original ext, return basename or null), `parseManifest(jsonText)` (accept `{instructions, files}` or a bare array; validate each entry has a string `path`; return the `files` list), and `toRecord({path, tags})` (build an export entry with `origName` = basename and empty `newName`).
- `src/tags.js` -- NEW orchestration: `exportTags({rootDir, outFile})` (scan → readTags → write `{instructions: INSTRUCTIONS, files}` JSON, return summary) and `applyTags({manifestPath, dryRun})` (parse `files` → per entry: resolve target, guard collisions, writeTags to temp, atomic rename, per-file try/catch, return counts).
- `src/scan.js`, `src/classify.js` -- REUSE unchanged for discovering audio files in export.
- `test/manifest.test.js` -- NEW unit tests for `resolveNewName` and `parseManifest` edge cases.
- `README.md` -- ADD a section documenting the export → LLM → apply workflow.

## Tasks & Acceptance

**Execution:**
- [x] `src/ffmpeg.js` -- add `readTags` + `writeTags` reusing the existing `run`/binary-resolution helpers -- all tag I/O in one place.
- [x] `src/manifest.js` -- `resolveNewName`, `parseManifest`, `toRecord` (pure, no fs) -- the safety-critical sanitize + validation logic, unit-testable.
- [x] `src/tags.js` -- `exportTags` and `applyTags` orchestration mirroring `normalize.js` (temp+atomic rename, per-file isolation) -- core behavior.
- [x] `src/cli.js` -- restructure to subcommands with `normalize` as default; wire `export-tags` and `apply-tags` -- user interface, existing usage preserved.
- [x] `test/manifest.test.js` -- cover the sanitize/validation edge cases from the I/O matrix (separators, reserved chars, forced ext, empty result, bad manifest) -- guards safety logic without real audio.
- [x] `README.md` -- document the three-step workflow with an example manifest -- discoverability.

**Acceptance Criteria:**
- Given `test_music/` with mixed/missing tags, when `export-tags` runs, then a `{instructions, files}` manifest is produced with one entry per file carrying `origName` + case-insensitively-read tags + empty `newName`, and the `instructions` block warns against merging different artists of the same title.
- Given `music-normalize ./music --target -16 --dry-run` (existing invocation), when run after the restructure, then it behaves exactly as before — `normalize` is the default command and its flags are unchanged.
- Given a returned manifest with cleaned tags and `newName`s, when `apply-tags` runs, then each file is renamed to its sanitized `newName` in its own directory and non-empty tags are written via stream copy, with one entry's failure not aborting the rest.

## Design Notes

- **Manifest shape** (the LLM edits `artist`/`title`/`album`/`newName`; never `path`/`origName`):
  ```json
  {
    "instructions": "Clean these music tags/filenames. The SAME title may be a DIFFERENT artist (cover or live version) — never merge distinct artists; if unsure keep the original. Fill artist/title/album and a newName (with extension) per file.",
    "files": [
      { "origName": "富士山下 (128kbps).mp3", "path": "/abs/music/富士山下 (128kbps).mp3",
        "artist": "", "title": "陳奕迅 - 富士山下", "album": "", "newName": "" }
    ]
  }
  ```
  Absolute `path` keeps apply resolution unambiguous; `origName` preserves the raw filename signal. `apply-tags` reads only `files` and ignores `instructions`. `newName` may omit the extension — apply forces the original one regardless.
- **resolveNewName:** basename-only (drop `/` and `\`), replace `[<>:"/\\|?*\x00-\x1F]`, trim trailing `.`/space, guard Windows reserved stems (CON, PRN, AUX, NUL, COM1-9, LPT1-9), then set extension to the original file's. Return null if nothing usable remains.

## Verification

**Commands:**
- `npm test` -- expected: existing tests plus new `manifest.test.js` pass.
- `node src/cli.js --help` -- expected: lists `normalize` (default), `export-tags`, `apply-tags`.
- `node src/cli.js ./test_music --dry-run` -- expected: unchanged normalize dry-run output (regression check).
- `node src/cli.js export-tags ./test_music -o /tmp/tags.json` -- expected: JSON manifest with current tags, empty `newName`s.

**Manual checks:**
- Hand-edit `/tmp/tags.json` (fill a `newName` and tags for one file copied into a scratch dir), run `apply-tags … --dry-run` then for real, and confirm with `ffprobe -show_entries format_tags` that the file was renamed and tagged with audio bytes unchanged (compare size/duration).

## Suggested Review Order

**Entry point — CLI surface**

- Start here: the two new subcommands and how `normalize` stays the default (existing usage preserved).
  [`cli.js:75`](../../src/cli.js#L75)

**Manifest safety logic (the heart of the change)**

- Sanitize the LLM's `newName`: replace separators/reserved chars, force the original extension.
  [`manifest.js:39`](../../src/manifest.js#L39)
- Character-level rules behind it — separators become `_`, reserved stems escaped.
  [`manifest.js:26`](../../src/manifest.js#L26)
- Validate the returned manifest (object or bare array) before any write.
  [`manifest.js:59`](../../src/manifest.js#L59)
- The cover / different-artist guidance embedded for the LLM.
  [`manifest.js:9`](../../src/manifest.js#L9)

**Apply orchestration (highest risk — mutates files)**

- Per-entry apply: collision + duplicate + case-only-rename handling, atomic temp+rename, per-file isolation.
  [`tags.js:56`](../../src/tags.js#L56)
- Same-file check that lets a case-only rename through instead of failing it.
  [`tags.js:21`](../../src/tags.js#L21)
- Export: read tags, skip writing when zero files, emit `{instructions, files}`.
  [`tags.js:32`](../../src/tags.js#L32)

**ffmpeg/ffprobe tag I/O**

- Read tags case-insensitively; write non-empty fields via stream copy (no re-encode).
  [`ffmpeg.js:135`](../../src/ffmpeg.js#L135)

**Tests (supporting)**

- Apply-path orchestration: collision, duplicate target, dry-run, case-only rename, no-op.
  [`apply.test.js:1`](../../test/apply.test.js#L1)
- Pure sanitize/validation edge cases.
  [`manifest.test.js:1`](../../test/manifest.test.js#L1)

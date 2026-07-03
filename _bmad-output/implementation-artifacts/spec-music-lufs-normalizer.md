---
title: 'music-lufs-normalizer CLI'
type: 'feature'
created: '2026-07-03'
status: 'done'
context: []
baseline_commit: 'NO_VCS'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A music library has inconsistent loudness across tracks. The user wants one cross-platform tool that normalizes every file in a folder to a target loudness, with no external dependencies to install.

**Approach:** A Node.js CLI that bundles ffmpeg via `ffmpeg-static` (one download works on Windows/macOS/Linux). It recursively scans a folder, then applies a **hybrid** strategy per format: lossless files are re-encoded to the exact target LUFS (no quality loss); lossy files get a non-destructive ReplayGain 2.0 loudness tag (audio bytes untouched). Default target is −14 LUFS. Default writes in place; a flag redirects output copies to a folder.

## Boundaries & Constraints

**Always:**
- Bundle ffmpeg via `ffmpeg-static` — never require a system ffmpeg install.
- Lossy formats (mp3, m4a, aac, ogg, opus) are ONLY tagged (stream-copy, `-c copy`), never re-encoded.
- Lossless formats (flac, wav) are re-encoded with two-pass loudnorm to the exact target.
- In-place edits write to a temp file first, then atomically replace the original.
- Loudness measurement uses ffmpeg `loudnorm` (EBU R128); tag gain = `target − measured_I`.
- Process every file independently; one file's failure must not abort the run.

**Ask First:**
- Adding any runtime dependency beyond `ffmpeg-static`, `ffprobe-static`, and a CLI arg parser.
- Changing default target LUFS away from −14 or the default mode away from in-place.

**Never:**
- Re-encoding lossy source files (would compound quality loss).
- Shipping or shelling out to `mp3gain`, `loudgain`, `rsgain`, or any non-bundled binary.
- Deleting or moving user originals in output-folder mode.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Lossless in-place | `song.flac`, default mode | Re-encoded to target LUFS, original path atomically replaced | On ffmpeg error: keep original, report, continue |
| Lossy in-place | `song.mp3`, default mode | `REPLAYGAIN_TRACK_GAIN`/`_PEAK` tags written via `-c copy`; audio bytes unchanged | On ffmpeg error: keep original, report, continue |
| Output-folder mode | `--output ./out`, nested files | Copies written under `./out` mirroring subfolder structure; originals untouched | Create dirs as needed |
| Recursive scan | Folder with subdirs + non-audio files | Only supported extensions picked up, subfolders included | Non-audio silently skipped |
| No audio found | Empty/irrelevant folder | Message "no supported audio files found", exit 0 | N/A |
| Folder missing | Path does not exist | Error message, exit non-zero | Fail fast before processing |
| Any file fails | ffmpeg non-zero on one file | Reported in summary; run continues; exit non-zero if ≥1 failure | Per-file try/catch |

</frozen-after-approval>

## Code Map

- `package.json` -- Node manifest (CommonJS); `bin` → `music-normalize`; deps: `commander`, `ffmpeg-static`, `ffprobe-static`.
- `src/cli.js` -- entry: parse args (positional `folder`, `--target`, `--output`, `--dry-run`), orchestrate scan → process → summary; set exit code.
- `src/scan.js` -- recursive directory walk, filter by supported extensions.
- `src/classify.js` -- map extension → `'reencode'` (flac, wav) or `'tag'` (mp3, m4a, aac, ogg, opus).
- `src/ffmpeg.js` -- spawn wrappers around bundled ffmpeg: `measureLoudness`, `reencode`, `writeTag`; parse loudnorm JSON from stderr.
- `src/normalize.js` -- per-file logic: measure, branch on strategy, handle in-place (temp+atomic replace) vs output-folder (mirror path).
- `test/*.test.js` -- Node built-in `node:test` unit tests (no extra deps).

## Tasks & Acceptance

**Execution:**
- [x] `package.json` -- create manifest with bin, scripts (`test`), and the three deps -- establishes the installable, dependency-bundled artifact.
- [x] `src/classify.js` -- extension → strategy + supported-extension set -- single source of truth for format handling.
- [x] `src/scan.js` -- recursive walk returning supported files -- feeds the processing loop.
- [x] `src/ffmpeg.js` -- `measureLoudness` (loudnorm `print_format=json`, parse `input_i`/`input_tp`), `reencode` (two-pass loudnorm to target, preserve codec+sample rate via ffprobe), `writeTag` (`-map 0 -c copy -metadata REPLAYGAIN_TRACK_GAIN/_PEAK`) -- all ffmpeg interaction.
- [x] `src/normalize.js` -- orchestrate measure→strategy, temp-file atomic replace for in-place, mirror path for output mode, dry-run short-circuit -- core behavior.
- [x] `src/cli.js` -- commander wiring, validate folder, print per-file + summary lines, exit code -- user interface.
- [x] `test/classify.test.js`, `test/scan.test.js`, `test/gain.test.js` -- unit-test the I/O matrix's pure logic: classification, recursive filtering, gain/peak computation, loudnorm-JSON parsing -- guards against regressions without needing real audio.

**Acceptance Criteria:**
- Given a folder with mixed formats in subfolders, when run with no flags, then lossless files are re-encoded and lossy files are tagged, all in place, and a summary reports counts.
- Given `--output ./out`, when run, then originals are unmodified and normalized copies appear under `./out` mirroring the input tree.
- Given `--target -16`, when run, then computed gains and re-encode targets use −16 LUFS.
- Given one unreadable/corrupt file, when run, then it is reported as failed, other files still process, and the process exits non-zero.
- Given a fresh clone, when `npm install` then `node src/cli.js --help` runs, then it works with no system ffmpeg present.

## Design Notes

- **Measurement:** `ffmpeg -i FILE -af loudnorm=I=<T>:TP=-1:LRA=11:print_format=json -f null -`; parse the trailing JSON object from stderr → `input_i`, `input_tp`. Tag gain = `T - input_i` (formatted `"-3.21 dB"`); `REPLAYGAIN_TRACK_PEAK` = `10^(input_tp/20)` clamped ≤ 1.
- **Two-pass re-encode:** pass-1 measure, pass-2 `loudnorm=I=<T>:TP=-1:LRA=11:measured_I=..:measured_TP=..:measured_LRA=..:measured_thresh=..:linear=true`; pass `-ar <sourceRate>` (from ffprobe) and matching codec (`flac` / `pcm`) so format/rate are preserved.
- **Opus caveat:** players prefer `R128_TRACK_GAIN`; we write `REPLAYGAIN_TRACK_GAIN` for consistency. m4a/aac RG tag support is player-dependent. Note as known limitation, don't special-case.
- CommonJS + Node ≥18 built-in `node:test`. ffmpeg paths from `require('ffmpeg-static')` / `require('ffprobe-static').path`.

## Verification

**Commands:**
- `npm install` -- expected: installs, ffmpeg-static fetches platform binary.
- `node src/cli.js --help` -- expected: usage with folder arg and flags.
- `npm test` -- expected: all unit tests pass.

**Manual checks:**
- Generate a quiet test tone (`ffmpeg -f lavfi -i sine=frequency=440:duration=3 -af volume=0.1 test/tone.flac`), run the CLI on `test/`, confirm flac loudness moves toward −14 and an mp3 copy gains RG tags (`ffprobe -show_entries format_tags`).

## Suggested Review Order

**Entry point & orchestration**

- Start here: CLI wiring, flag defaults, and the per-file loop that drives everything.
  [`cli.js:25`](../../src/cli.js#L25)

- Core per-file decision: measure → skip-if-silent → branch tag vs re-encode.
  [`normalize.js:27`](../../src/normalize.js#L27)

**Hybrid strategy (the heart of the design)**

- Single source of truth mapping each extension to `reencode` (lossless) or `tag` (lossy).
  [`classify.js:9`](../../src/classify.js#L9)

- Lossless re-encode preserves metadata + cover art (`-map 0 -map_metadata 0 -c copy`) — review fix.
  [`ffmpeg.js:100`](../../src/ffmpeg.js#L100)

- Non-destructive ReplayGain tagging via stream copy (`-c copy`), never re-encoding lossy audio.
  [`ffmpeg.js:109`](../../src/ffmpeg.js#L109)

**Safety & robustness**

- Atomic in-place replace: temp file in dest dir, removed on failure, renamed on success.
  [`normalize.js:55`](../../src/normalize.js#L55)

- Resilient scan: unreadable dirs are skipped (not fatal); leftover temp files ignored — review fixes.
  [`scan.js:16`](../../src/scan.js#L16)

- Loudness measurement + validation guarding against malformed loudnorm JSON — review fix.
  [`ffmpeg.js:18`](../../src/ffmpeg.js#L18)

**Supporting**

- Pure-logic unit tests: classification, recursive scan, gain/peak, JSON parsing.
  [`gain.test.js:1`](../../test/gain.test.js#L1)

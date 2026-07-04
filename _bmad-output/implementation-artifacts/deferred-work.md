# Deferred Work

Items surfaced but intentionally not done in their originating story. Each needs
a future decision or its own focused change.

## From spec-metadata-filename-normalizer (2026-07-04 review)

- **`apply-tags` path confinement (security hardening).** `applyTags` acts on
  whatever absolute `path` each manifest entry contains, with no confinement to
  the folder that was exported. A hallucinated or hand-edited path could cause a
  file to be tagged-in-place or renamed **within its own directory** (content is
  preserved at the new name; non-media files simply fail ffmpeg and are left
  untouched — so this is not arbitrary deletion/exfiltration, but it is
  unconfined). Proper fix: record the export root in the manifest (a change to
  the frozen `{instructions, files}` shape) and reject entries whose resolved
  `path` escapes that root. Deferred because it needs a product decision on the
  trust model (the manifest is currently treated as the user's own artifact) and
  a frozen-intent change. Raised to the user at hand-off.

- **Leading-`-` argument hardening for ffmpeg/ffprobe.** A source path beginning
  with `-` is passed positionally and could be parsed as a tool option (no shell,
  so not RCE — just confusing errors/behavior). Affects the new `readTags`/
  `writeTags` *and* the pre-existing `reencode`/`writeTag`/`probeAudio`, so fix
  repo-wide (e.g. `./`-prefix relative input paths) rather than piecemeal.

- **Filename byte-length cap.** An LLM `newName` exceeding the 255-byte filesystem
  limit (~85 CJK chars) makes the rename fail `ENAMETOOLONG`. It is caught per
  file and reported as a failure (no crash, no data loss), but the file is left
  unrenamed. Consider truncating the sanitized stem to fit `255 - byteLength(ext)`.

- **Broader apply-path integration coverage.** `test/apply.test.js` now covers
  collision, duplicate-target, no-op, case-only rename, and missing-source using
  rename-only entries (no ffmpeg). The tag-writing path (`writeTags` + atomic
  replace) is still only manually verified; a fixture-based or ffmpeg-mocked test
  would lock it down.

# music-lufs-normalizer

A cross-platform CLI that scans a folder of music and normalizes every track to a
target loudness (LUFS). **ffmpeg is bundled** — one install works on Windows,
macOS, and Linux with nothing else to set up.

It uses a **hybrid strategy** so lossy files never lose quality:

| Format | How it's normalized | Result |
|---|---|---|
| `flac`, `wav` (lossless) | Two-pass ffmpeg `loudnorm` re-encode | Exact target LUFS, no quality loss, tags & cover art preserved |
| `mp3`, `m4a`, `aac`, `ogg`, `opus` (lossy) | Non-destructive ReplayGain 2.0 tag (stream copy) | Audio bytes untouched; RG-aware players adjust playback |

## Requirements

- Node.js ≥ 18 (nothing else — ffmpeg/ffprobe are bundled via `ffmpeg-static`)

## Install

```bash
npm install
```

Optionally expose the `music-normalize` command globally:

```bash
npm link
```

## Windows executable

A standalone Windows build is produced by GitHub Actions so end users need
neither Node.js nor ffmpeg installed.

- **Download:** grab `music-normalize-win-x64.zip` from the latest GitHub Release
  (created on any `v*` tag) or from the run artifacts of the **Build Windows**
  workflow.
- **Run:** unzip and keep all three files together —
  `music-normalize.exe`, `ffmpeg.exe`, `ffprobe.exe`. The exe looks for
  `ffmpeg.exe`/`ffprobe.exe` in its own folder, so they must stay side by side.

  ```powershell
  music-normalize.exe "C:\path\to\music" --dry-run
  music-normalize.exe "C:\path\to\music"
  ```

The exe is built with [`@yao-pkg/pkg`](https://github.com/yao-pkg/pkg). Because
`ffmpeg-static`/`ffprobe-static` only fetch the current OS's binary at install
time, the build runs on a `windows-latest` runner so the bundled ffmpeg/ffprobe
are the correct Windows binaries. To trigger a build, push a tag
(`git tag v0.1.0 && git push --tags`) or run the workflow manually from the
GitHub **Actions** tab. `npm run build:win` builds only the exe locally (it does
not stage the ffmpeg/ffprobe binaries — the workflow does that).

## Usage

```bash
# Preview what would happen (no files written)
node src/cli.js /path/to/music --dry-run

# Normalize in place (default) to -14 LUFS
node src/cli.js /path/to/music

# Write normalized copies to a folder, mirroring the input tree
node src/cli.js /path/to/music --output ./normalized

# Custom target loudness
node src/cli.js /path/to/music --target -16
```

If installed via `npm link`, replace `node src/cli.js` with `music-normalize`.

### Options

| Flag | Default | Description |
|---|---|---|
| `<folder>` | — | Folder to scan recursively for audio files |
| `-t, --target <lufs>` | `-14` | Target integrated loudness in LUFS |
| `-o, --output <dir>` | — | Write copies here instead of editing in place (must be outside the input folder) |
| `--dry-run` | `false` | Analyze and report without writing any files |

## Behavior notes

- **In-place is atomic** — each file is written to a temp file and renamed only on
  success, so an interrupted or failed run never leaves a half-written track.
- **Per-file isolation** — one bad file is reported and skipped; the rest still
  process. The command exits non-zero if any file failed.
- **Silent tracks** are detected and skipped (nothing to normalize).
- **Output-folder mode never modifies your originals.**

## Known limitations

- `opus` is tagged with `REPLAYGAIN_TRACK_GAIN` rather than its native
  `R128_TRACK_GAIN`; `m4a`/`aac` ReplayGain support is player-dependent.
- ReplayGain-tagged lossy files only change loudness in players that honor
  ReplayGain.

## Development

```bash
npm test   # runs the Node built-in test runner (node --test)
```

'use strict';

const fs = require('fs');
const path = require('path');
const { classify } = require('./classify');
const {
  measureLoudness,
  probeAudio,
  reencode,
  writeTag,
  computeGain,
  computePeak,
} = require('./ffmpeg');

// Temp path in the destination's own directory so the final rename is an
// atomic same-filesystem move.
function tempPathFor(dest) {
  const dir = path.dirname(dest);
  const ext = path.extname(dest);
  const base = path.basename(dest, ext);
  return path.join(dir, `.${base}.normtmp${ext}`);
}

// Normalize one file. In-place mode (no outputDir) atomically replaces the
// original; output mode mirrors the input tree under outputDir and never
// touches the source. Returns a per-file result record.
async function normalizeFile({ filePath, rootDir, target, outputDir, dryRun }) {
  const strategy = classify(filePath);
  const dest = outputDir
    ? path.join(outputDir, path.relative(rootDir, filePath))
    : filePath;

  const result = { file: filePath, strategy, status: 'ok', detail: '' };

  try {
    const measured = await measureLoudness(filePath, target);

    if (!Number.isFinite(measured.input_i)) {
      result.status = 'skipped';
      result.detail = 'silent audio, nothing to normalize';
      return result;
    }

    const gain = computeGain(target, measured.input_i);

    if (dryRun) {
      result.status = 'dry-run';
      result.detail = strategy === 'tag'
        ? `would tag ${gain}`
        : `would re-encode (measured ${measured.input_i.toFixed(1)} LUFS → ${target})`;
      return result;
    }

    if (outputDir) fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = tempPathFor(dest);

    try {
      if (strategy === 'tag') {
        await writeTag(filePath, tmp, gain, computePeak(measured.input_tp));
        result.detail = `tagged ${gain}`;
      } else {
        const probe = await probeAudio(filePath);
        await reencode(filePath, tmp, target, measured, probe);
        result.detail = `re-encoded to ${target} LUFS`;
      }
      fs.renameSync(tmp, dest);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err;
    }
  } catch (err) {
    result.status = 'failed';
    result.detail = err.message;
  }

  return result;
}

module.exports = { normalizeFile };

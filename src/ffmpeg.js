'use strict';

const path = require('path');
const { spawn } = require('child_process');

// When packaged with pkg (process.pkg is set), ffmpeg/ffprobe are shipped as
// loose files next to the executable (a binary can't be exec'd from pkg's
// virtual FS). In dev, use the ffmpeg-static / ffprobe-static package paths.
function resolveBinary(name, devPath) {
  if (process.pkg) {
    const exe = process.platform === 'win32' ? `${name}.exe` : name;
    return path.join(path.dirname(process.execPath), exe);
  }
  return devPath;
}
const ffmpegPath = resolveBinary('ffmpeg', require('ffmpeg-static'));
const ffprobePath = resolveBinary('ffprobe', require('ffprobe-static').path);

// --- Pure helpers (unit-tested without spawning ffmpeg) ---------------------

// Parse a value from loudnorm JSON, handling ffmpeg's "-inf"/"inf" strings.
function toNumber(value) {
  if (value === '-inf') return -Infinity;
  if (value === 'inf') return Infinity;
  return parseFloat(value);
}

// loudnorm prints a JSON object at the end of stderr. Extract and parse the
// last brace-delimited block (loudnorm JSON is flat, no nested braces).
function parseLoudnormJson(stderr) {
  const matches = stderr.match(/\{[\s\S]*?\}/g);
  if (!matches || matches.length === 0) {
    throw new Error('no loudnorm JSON found in ffmpeg output');
  }
  const raw = JSON.parse(matches[matches.length - 1]);
  const parsed = {
    input_i: toNumber(raw.input_i),
    input_tp: toNumber(raw.input_tp),
    input_lra: toNumber(raw.input_lra),
    input_thresh: toNumber(raw.input_thresh),
  };
  for (const [key, value] of Object.entries(parsed)) {
    if (Number.isNaN(value)) throw new Error(`loudnorm output missing/invalid field: ${key}`);
  }
  return parsed;
}

// ReplayGain track gain = how much to adjust to reach target. Non-finite
// measured loudness (e.g. digital silence) yields a no-op 0 dB gain.
function computeGain(target, inputI) {
  if (!Number.isFinite(inputI)) return '0.00 dB';
  return `${(target - inputI).toFixed(2)} dB`;
}

// ReplayGain track peak is a linear value in [0, 1] derived from true peak dBTP.
function computePeak(inputTp) {
  const linear = Math.pow(10, inputTp / 20);
  return Math.min(1, linear).toFixed(6);
}

// --- Process wrappers -------------------------------------------------------

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} exited ${code}: ${stderr.trim().split('\n').slice(-3).join(' ')}`));
    });
  });
}

// Pass-1 loudness measurement via loudnorm print_format=json.
async function measureLoudness(inputPath, target) {
  const { stderr } = await run(ffmpegPath, [
    '-hide_banner', '-nostats',
    '-i', inputPath,
    '-af', `loudnorm=I=${target}:TP=-1:LRA=11:print_format=json`,
    '-f', 'null', '-',
  ]);
  return parseLoudnormJson(stderr);
}

// Probe the first audio stream for codec + sample rate so re-encoding can
// preserve them.
async function probeAudio(inputPath) {
  const { stdout } = await run(ffprobePath, [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=sample_rate,codec_name',
    '-of', 'json', inputPath,
  ]);
  const stream = (JSON.parse(stdout).streams || [])[0] || {};
  return { sampleRate: stream.sample_rate, codecName: stream.codec_name };
}

// Pass-2 two-pass loudnorm re-encode to the exact target, preserving codec
// and sample rate.
async function reencode(inputPath, outputPath, target, measured, probe) {
  const filter =
    `loudnorm=I=${target}:TP=-1:LRA=11` +
    `:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}` +
    `:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}` +
    `:linear=true`;
  // -map 0 + -map_metadata 0 keep tags and embedded cover art; -c copy passes
  // non-audio streams through untouched while only the audio is re-encoded.
  const args = ['-hide_banner', '-nostats', '-i', inputPath, '-map', '0', '-map_metadata', '0', '-af', filter, '-c', 'copy'];
  if (probe.codecName) args.push('-c:a', probe.codecName);
  if (probe.sampleRate) args.push('-ar', String(probe.sampleRate));
  args.push('-y', outputPath);
  await run(ffmpegPath, args);
}

// Write ReplayGain tags without re-encoding (stream copy) — audio bytes are
// preserved bit-for-bit.
async function writeTag(inputPath, outputPath, gain, peak) {
  await run(ffmpegPath, [
    '-hide_banner', '-nostats',
    '-i', inputPath,
    '-map', '0', '-c', 'copy',
    '-metadata', `REPLAYGAIN_TRACK_GAIN=${gain}`,
    '-metadata', `REPLAYGAIN_TRACK_PEAK=${peak}`,
    '-y', outputPath,
  ]);
}

module.exports = {
  parseLoudnormJson,
  computeGain,
  computePeak,
  measureLoudness,
  probeAudio,
  reencode,
  writeTag,
};

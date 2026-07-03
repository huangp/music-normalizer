'use strict';

const path = require('path');

// Single source of truth for how each format is handled.
// Lossless formats can be re-encoded with no quality loss, so we normalize
// them to the exact target LUFS. Lossy formats are never re-encoded; they get
// a non-destructive ReplayGain tag instead.
const STRATEGY_BY_EXT = {
  '.flac': 'reencode',
  '.wav': 'reencode',
  '.mp3': 'tag',
  '.m4a': 'tag',
  '.aac': 'tag',
  '.ogg': 'tag',
  '.opus': 'tag',
};

const supportedExtensions = Object.keys(STRATEGY_BY_EXT);

// Returns 'reencode', 'tag', or null (unsupported) for a given file path.
function classify(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return STRATEGY_BY_EXT[ext] || null;
}

module.exports = { classify, supportedExtensions };

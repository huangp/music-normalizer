'use strict';

const path = require('path');
const { supportedExtensions } = require('./classify');

// Guidance embedded in the exported manifest so the LLM handles covers/live
// versions correctly. The same title is often a DIFFERENT artist, and we must
// never let those collapse into one.
const INSTRUCTIONS =
  'Clean these music tags and filenames. For each file, fill in artist, title, ' +
  'album, and a newName (include the file extension). IMPORTANT: the same title ' +
  'may be a DIFFERENT artist (a cover or a live version) — never merge distinct ' +
  'artists into one, and keep the original values if you are unsure. Do not edit ' +
  'the "path" or "origName" fields.';

// Windows reserved device names — illegal as a bare filename stem.
const RESERVED_STEMS = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

// Make a filename stem safe cross-platform. Separators and reserved characters
// are REPLACED (not dropped) so the file stays in its directory while names
// like "AC/DC" survive as "AC_DC". Returns '' if nothing usable remains.
function sanitizeStem(name) {
  const s = name
    .replace(/:/g, '-') // colon reads naturally as a dash
    .replace(/[<>"/\\|?*\x00-\x1F]/g, '_')
    .replace(/^[. ]+/, '')
    .replace(/[. ]+$/, '');
  if (!s) return '';
  return RESERVED_STEMS.has(s.toUpperCase()) ? `_${s}` : s;
}

// Turn the LLM's raw newName into a safe basename in the file's own directory,
// forcing the original extension so the container/codec can never change.
// Returns null when there is no rename to do (empty/unusable name).
function resolveNewName(rawNewName, originalPath) {
  if (typeof rawNewName !== 'string' || rawNewName.trim() === '') return null;
  const originalExt = path.extname(originalPath);

  // Drop a trailing extension only if it's a known audio one, so a title like
  // "Song 1.5" keeps its ".5" instead of losing it to extension-stripping.
  let candidate = rawNewName;
  const ext = path.extname(candidate);
  if (supportedExtensions.includes(ext.toLowerCase())) {
    candidate = candidate.slice(0, -ext.length);
  }

  const stem = sanitizeStem(candidate);
  if (!stem) return null;
  return stem + originalExt;
}

// Validate and normalize a manifest read back from the LLM. Accepts the
// exported `{ instructions, files }` object or a bare array of entries. Returns
// the entry list; throws a clear error on anything malformed.
function parseManifest(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`manifest is not valid JSON: ${err.message}`);
  }
  const files = Array.isArray(data) ? data : data && data.files;
  if (!Array.isArray(files)) {
    throw new Error('manifest must be an array or an object with a "files" array');
  }
  files.forEach((entry, i) => {
    if (!entry || typeof entry.path !== 'string' || entry.path === '') {
      throw new Error(`manifest entry ${i} is missing a string "path"`);
    }
  });
  return files;
}

// Build one export entry: the raw filename (origName) and absolute path are
// signals the LLM reads but must not edit; newName starts empty for it to fill.
function toRecord(filePath, tags) {
  return {
    origName: path.basename(filePath),
    path: filePath,
    artist: tags.artist,
    title: tags.title,
    album: tags.album,
    newName: '',
  };
}

module.exports = { INSTRUCTIONS, resolveNewName, parseManifest, toRecord };

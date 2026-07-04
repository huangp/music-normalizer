'use strict';

const fs = require('fs');
const path = require('path');
const { scan } = require('./scan');
const { readTags, writeTags } = require('./ffmpeg');
const { INSTRUCTIONS, resolveNewName, parseManifest, toRecord } = require('./manifest');

// Hidden temp path in the destination's own directory so the final rename is an
// atomic same-filesystem move (mirrors normalize.js; scan ignores .normtmp.).
function tempPathFor(dest) {
  const dir = path.dirname(dest);
  const ext = path.extname(dest);
  const base = path.basename(dest, ext);
  return path.join(dir, `.${base}.normtmp${ext}`);
}

// Whether two existing paths are the same file on disk. On case-insensitive
// filesystems (macOS/Windows default) a case-only rename resolves dest to the
// same file as src — that must be allowed, not flagged as a collision.
function isSameFile(a, b) {
  try {
    return fs.realpathSync.native(a) === fs.realpathSync.native(b);
  } catch {
    return false;
  }
}

// Scan a folder, read each file's tags, and write a `{ instructions, files }`
// JSON manifest for an LLM to clean up. One unreadable file is reported and
// skipped; the rest still export.
async function exportTags({ rootDir, outFile }) {
  const files = scan(rootDir);
  if (files.length === 0) return { total: 0, exported: 0, failures: 0 };

  const records = [];
  let failures = 0;

  for (const filePath of files) {
    const rel = path.relative(process.cwd(), filePath);
    try {
      const tags = await readTags(filePath);
      records.push(toRecord(filePath, tags));
    } catch (err) {
      failures += 1;
      console.error(`  FAIL  ${rel} — ${err.message}`);
    }
  }

  fs.writeFileSync(outFile, JSON.stringify({ instructions: INSTRUCTIONS, files: records }, null, 2));
  return { total: files.length, exported: records.length, failures };
}

// Apply an LLM-edited manifest: per entry, write the non-empty tags and rename
// to the sanitized newName. Atomic per file, isolated per file.
async function applyTags({ manifestPath, dryRun }) {
  const entries = parseManifest(fs.readFileSync(manifestPath, 'utf8'));
  const claimed = new Set(); // resolved dest paths already targeted this run
  let tagged = 0;
  let renamed = 0;
  let skipped = 0;
  let failures = 0;

  const clean = (value) => (typeof value === 'string' ? value.trim() : '');

  for (const entry of entries) {
    const src = path.resolve(entry.path); // normalize so string compares are stable
    const rel = path.relative(process.cwd(), src);
    try {
      if (!fs.existsSync(src)) throw new Error('source file not found');
      if (!fs.statSync(src).isFile()) throw new Error('source is not a regular file');

      const tags = { artist: clean(entry.artist), title: clean(entry.title), album: clean(entry.album) };
      const hasTags = ['artist', 'title', 'album'].some((k) => tags[k]);
      const targetName = resolveNewName(entry.newName, src);
      const dest = targetName ? path.join(path.dirname(src), targetName) : src;
      const willRename = dest !== src;
      const destKey = path.resolve(dest);

      if (willRename && claimed.has(destKey)) {
        throw new Error(`duplicate target in manifest: ${path.basename(dest)}`);
      }
      // dest can exist yet be the SAME file (a case-only rename); only a
      // different existing file is a real collision.
      const destExists = willRename && fs.existsSync(dest);
      const sameFile = destExists && isSameFile(src, dest);
      if (destExists && !sameFile) {
        throw new Error(`target already exists: ${path.basename(dest)}`);
      }
      if (!hasTags && !willRename) {
        skipped += 1;
        console.log(`  skip   ${rel} — nothing to change`);
        continue;
      }
      if (willRename) claimed.add(destKey);

      if (!dryRun) {
        if (hasTags) {
          // Write tags into a temp copy, atomically move to dest, then drop the
          // original if the name changed — unless dest IS src (case-only rename),
          // where the rename already consumed the original.
          const tmp = tempPathFor(dest);
          try {
            await writeTags(src, tmp, tags);
            fs.renameSync(tmp, dest);
          } catch (err) {
            fs.rmSync(tmp, { force: true });
            throw err;
          }
          if (willRename && !sameFile) fs.rmSync(src, { force: true });
        } else {
          fs.renameSync(src, dest); // rename-only: no ffmpeg needed
        }
      }

      if (hasTags) tagged += 1;
      if (willRename) renamed += 1;
      const verb = dryRun ? 'plan  ' : (hasTags && willRename ? 'tag+mv' : willRename ? 'move  ' : 'tag   ');
      const detail = [hasTags ? 'tags' : null, willRename ? `→ ${path.basename(dest)}` : null]
        .filter(Boolean).join(' ');
      console.log(`  ${verb} ${rel} — ${detail}`);
    } catch (err) {
      failures += 1;
      console.error(`  FAIL   ${rel} — ${err.message}`);
    }
  }

  return { tagged, renamed, skipped, failures };
}

module.exports = { exportTags, applyTags };

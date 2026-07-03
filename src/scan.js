'use strict';

const fs = require('fs');
const path = require('path');
const { classify } = require('./classify');

// Recursively walk `rootDir` and return absolute paths of every supported
// audio file, sorted for stable output. Non-audio files and unsupported
// extensions are silently skipped.
function scan(rootDir) {
  const results = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      console.warn(`  skip  ${dir} — ${err.code || err.message}`);
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && !entry.name.includes('.normtmp.') && classify(full)) {
        results.push(full);
      }
    }
  }

  walk(rootDir);
  results.sort();
  return results;
}

module.exports = { scan };

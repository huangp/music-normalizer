'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { applyTags } = require('../src/tags');

// These exercise applyTags' orchestration (collision, duplicate, no-op, rename)
// using rename-only entries — empty tags means no ffmpeg is spawned, so the
// tests are fast and deterministic.

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mn-apply-'));
}
function touch(p, content = 'x') {
  fs.writeFileSync(p, content);
}
function manifest(dir, files) {
  const p = path.join(dir, 'manifest.json');
  fs.writeFileSync(p, JSON.stringify({ files }));
  return p;
}
function entry(src, newName) {
  return { path: src, artist: '', title: '', album: '', newName };
}

test('rename-only moves the file to the sanitized newName', async () => {
  const d = scratch();
  const src = path.join(d, 'a.mp3');
  touch(src);
  const res = await applyTags({ manifestPath: manifest(d, [entry(src, 'b.mp3')]), dryRun: false });
  assert.strictEqual(res.renamed, 1);
  assert.strictEqual(res.failures, 0);
  assert.ok(fs.existsSync(path.join(d, 'b.mp3')));
  assert.ok(!fs.existsSync(src));
});

test('no-op entry (no tags, no newName) is skipped', async () => {
  const d = scratch();
  const src = path.join(d, 'a.mp3');
  touch(src);
  const res = await applyTags({ manifestPath: manifest(d, [entry(src, '')]), dryRun: false });
  assert.strictEqual(res.skipped, 1);
  assert.ok(fs.existsSync(src));
});

test('rename onto a different existing file fails and leaves both untouched', async () => {
  const d = scratch();
  const a = path.join(d, 'a.mp3');
  const b = path.join(d, 'b.mp3');
  touch(a);
  touch(b, 'keep');
  const res = await applyTags({ manifestPath: manifest(d, [entry(a, 'b.mp3')]), dryRun: false });
  assert.strictEqual(res.failures, 1);
  assert.strictEqual(res.renamed, 0);
  assert.ok(fs.existsSync(a));
  assert.strictEqual(fs.readFileSync(b, 'utf8'), 'keep');
});

test('two entries targeting the same newName fail the second', async () => {
  const d = scratch();
  const a = path.join(d, 'a.mp3');
  const b = path.join(d, 'b.mp3');
  touch(a);
  touch(b);
  const res = await applyTags({
    manifestPath: manifest(d, [entry(a, 'same.mp3'), entry(b, 'same.mp3')]),
    dryRun: false,
  });
  assert.strictEqual(res.renamed, 1);
  assert.strictEqual(res.failures, 1);
  assert.ok(fs.existsSync(path.join(d, 'same.mp3')));
});

test('dry-run catches duplicate targets and writes nothing', async () => {
  const d = scratch();
  const a = path.join(d, 'a.mp3');
  const b = path.join(d, 'b.mp3');
  touch(a);
  touch(b);
  const res = await applyTags({
    manifestPath: manifest(d, [entry(a, 'same.mp3'), entry(b, 'same.mp3')]),
    dryRun: true,
  });
  assert.strictEqual(res.failures, 1);
  assert.ok(fs.existsSync(a) && fs.existsSync(b));
  assert.ok(!fs.existsSync(path.join(d, 'same.mp3')));
});

test('missing source file fails that entry', async () => {
  const d = scratch();
  const res = await applyTags({
    manifestPath: manifest(d, [entry(path.join(d, 'nope.mp3'), 'x.mp3')]),
    dryRun: false,
  });
  assert.strictEqual(res.failures, 1);
});

test('case-only rename succeeds on both case-sensitive and case-insensitive filesystems', async () => {
  const d = scratch();
  const src = path.join(d, 'song.mp3');
  touch(src, 'audio');
  const res = await applyTags({ manifestPath: manifest(d, [entry(src, 'Song.mp3')]), dryRun: false });
  assert.strictEqual(res.failures, 0);
  assert.strictEqual(res.renamed, 1);
  const out = path.join(d, 'Song.mp3');
  assert.ok(fs.existsSync(out));
  assert.strictEqual(fs.readFileSync(out, 'utf8'), 'audio');
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scan } = require('../src/scan');

test('scan returns supported files recursively, skipping others', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
  try {
    fs.writeFileSync(path.join(root, 'a.mp3'), '');
    fs.writeFileSync(path.join(root, 'cover.jpg'), '');
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'sub', 'b.flac'), '');
    fs.writeFileSync(path.join(root, 'sub', 'notes.txt'), '');
    fs.mkdirSync(path.join(root, 'sub', 'deep'));
    fs.writeFileSync(path.join(root, 'sub', 'deep', 'c.opus'), '');

    const found = scan(root).map((p) => path.relative(root, p));
    assert.deepStrictEqual(found, [
      'a.mp3',
      path.join('sub', 'b.flac'),
      path.join('sub', 'deep', 'c.opus'),
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scan returns empty array for a folder with no audio', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-empty-'));
  try {
    fs.writeFileSync(path.join(root, 'readme.md'), '');
    assert.deepStrictEqual(scan(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

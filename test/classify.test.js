'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { classify, supportedExtensions } = require('../src/classify');

test('lossless formats are re-encoded', () => {
  assert.strictEqual(classify('/music/song.flac'), 'reencode');
  assert.strictEqual(classify('/music/song.wav'), 'reencode');
});

test('lossy formats are tagged', () => {
  for (const ext of ['mp3', 'm4a', 'aac', 'ogg', 'opus']) {
    assert.strictEqual(classify(`/music/song.${ext}`), 'tag');
  }
});

test('classification is case-insensitive', () => {
  assert.strictEqual(classify('/music/SONG.MP3'), 'tag');
  assert.strictEqual(classify('/music/SONG.FLAC'), 'reencode');
});

test('unsupported files return null', () => {
  assert.strictEqual(classify('/music/cover.jpg'), null);
  assert.strictEqual(classify('/music/notes.txt'), null);
  assert.strictEqual(classify('/music/noext'), null);
});

test('supportedExtensions lists all seven formats', () => {
  assert.deepStrictEqual(
    [...supportedExtensions].sort(),
    ['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav'],
  );
});

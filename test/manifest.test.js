'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { resolveNewName, parseManifest } = require('../src/manifest');

test('keeps a clean name and its matching extension', () => {
  assert.strictEqual(resolveNewName('陳奕迅 - 富士山下.mp3', '/m/x.mp3'), '陳奕迅 - 富士山下.mp3');
});

test('appends the original extension when newName omits one', () => {
  assert.strictEqual(resolveNewName('Song', '/m/x.flac'), 'Song.flac');
});

test('forces the original extension, never the LLM-supplied one', () => {
  assert.strictEqual(resolveNewName('Song.wav', '/m/x.mp3'), 'Song.mp3');
});

test('does not mistake a dotted title for an extension', () => {
  assert.strictEqual(resolveNewName('Song 1.5', '/m/x.mp3'), 'Song 1.5.mp3');
});

test('replaces separators and reserved characters instead of moving the file', () => {
  assert.strictEqual(resolveNewName('a/b:c?.flac', '/m/x.mp3'), 'a_b-c_.mp3');
});

test('preserves slashed artist names like AC/DC as AC_DC', () => {
  assert.strictEqual(resolveNewName('AC/DC - TNT', '/m/x.mp3'), 'AC_DC - TNT.mp3');
});

test('trims trailing dots and spaces', () => {
  assert.strictEqual(resolveNewName('name...', '/m/x.mp3'), 'name.mp3');
});

test('escapes Windows reserved device names', () => {
  assert.strictEqual(resolveNewName('CON', '/m/x.mp3'), '_CON.mp3');
});

test('returns null for empty, whitespace, or traversal-only names', () => {
  assert.strictEqual(resolveNewName('', '/m/x.mp3'), null);
  assert.strictEqual(resolveNewName('   ', '/m/x.mp3'), null);
  assert.strictEqual(resolveNewName('..', '/m/x.mp3'), null);
  assert.strictEqual(resolveNewName(undefined, '/m/x.mp3'), null);
});

test('parseManifest accepts the {instructions, files} object form', () => {
  const files = parseManifest('{"instructions":"x","files":[{"path":"/a.mp3"}]}');
  assert.deepStrictEqual(files, [{ path: '/a.mp3' }]);
});

test('parseManifest accepts a bare array', () => {
  const files = parseManifest('[{"path":"/a.mp3"}]');
  assert.deepStrictEqual(files, [{ path: '/a.mp3' }]);
});

test('parseManifest throws on invalid JSON', () => {
  assert.throws(() => parseManifest('not json'), /not valid JSON/);
});

test('parseManifest throws when there is no files array', () => {
  assert.throws(() => parseManifest('{"instructions":"x"}'), /files/);
});

test('parseManifest throws when an entry is missing a path', () => {
  assert.throws(() => parseManifest('{"files":[{"title":"x"}]}'), /path/);
});

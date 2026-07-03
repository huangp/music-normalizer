'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { computeGain, computePeak, parseLoudnormJson } = require('../src/ffmpeg');

test('computeGain is target minus measured, formatted in dB', () => {
  assert.strictEqual(computeGain(-14, -20), '6.00 dB');
  assert.strictEqual(computeGain(-14, -8), '-6.00 dB');
  assert.strictEqual(computeGain(-16, -16), '0.00 dB');
});

test('computeGain treats non-finite (silence) as a 0 dB no-op', () => {
  assert.strictEqual(computeGain(-14, -Infinity), '0.00 dB');
});

test('computePeak converts dBTP to a linear value clamped at 1', () => {
  assert.strictEqual(computePeak(0), '1.000000');
  assert.strictEqual(computePeak(-6), '0.501187');
  assert.strictEqual(computePeak(3), '1.000000'); // clamped
  assert.strictEqual(computePeak(-Infinity), '0.000000');
});

test('parseLoudnormJson extracts the last JSON block and parses numbers', () => {
  const stderr = [
    '[Parsed_loudnorm_0 @ 0x0] some log line',
    '{',
    '\t"input_i" : "-23.45",',
    '\t"input_tp" : "-3.20",',
    '\t"input_lra" : "7.10",',
    '\t"input_thresh" : "-33.60",',
    '\t"target_offset" : "0.05"',
    '}',
  ].join('\n');

  const parsed = parseLoudnormJson(stderr);
  assert.strictEqual(parsed.input_i, -23.45);
  assert.strictEqual(parsed.input_tp, -3.2);
  assert.strictEqual(parsed.input_lra, 7.1);
  assert.strictEqual(parsed.input_thresh, -33.6);
});

test('parseLoudnormJson throws on missing/invalid fields', () => {
  const stderr = '{ "input_i" : "-23.45", "input_tp" : "-3.20" }'; // missing lra/thresh
  assert.throws(() => parseLoudnormJson(stderr), /missing\/invalid field/);
});

test('parseLoudnormJson handles -inf sentinels', () => {
  const stderr = '{ "input_i" : "-inf", "input_tp" : "-inf", "input_lra" : "0.00", "input_thresh" : "-inf" }';
  const parsed = parseLoudnormJson(stderr);
  assert.strictEqual(parsed.input_i, -Infinity);
  assert.strictEqual(parsed.input_tp, -Infinity);
});

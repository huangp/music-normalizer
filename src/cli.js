#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const { scan } = require('./scan');
const { normalizeFile } = require('./normalize');
const { exportTags, applyTags } = require('./tags');

function parseTarget(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    program.error(`--target must be a finite number, got "${value}"`);
  }
  return n;
}

program
  .name('music-normalize')
  .description('Normalize music loudness, and clean up tags/filenames via an LLM round-trip.');

program
  .command('normalize', { isDefault: true })
  .description('Normalize a folder of music to a target LUFS. Lossless files are re-encoded; lossy files get non-destructive ReplayGain tags.')
  .argument('<folder>', 'folder to scan recursively for audio files')
  .option('-t, --target <lufs>', 'target integrated loudness in LUFS', parseTarget, -14)
  .option('-o, --output <dir>', 'write normalized copies here instead of editing in place')
  .option('--dry-run', 'analyze and report without writing any files', false)
  .action(async (folder, opts) => {
    const rootDir = path.resolve(folder);
    if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
      program.error(`not a directory: ${folder}`);
    }

    const outputDir = opts.output ? path.resolve(opts.output) : null;
    if (outputDir) {
      const rel = path.relative(rootDir, outputDir);
      if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
        program.error('--output folder must be outside the input folder');
      }
    }
    const files = scan(rootDir);

    if (files.length === 0) {
      console.log('No supported audio files found.');
      return;
    }

    console.log(`Found ${files.length} file(s). Target: ${opts.target} LUFS.` +
      (outputDir ? ` Output: ${path.relative(process.cwd(), outputDir) || '.'}` : ' Editing in place.') +
      (opts.dryRun ? ' (dry run)' : ''));

    let failures = 0;
    let skipped = 0;
    for (const filePath of files) {
      const rel = path.relative(process.cwd(), filePath);
      const res = await normalizeFile({ filePath, rootDir, target: opts.target, outputDir, dryRun: opts.dryRun });
      if (res.status === 'failed') {
        failures += 1;
        console.error(`  FAIL  ${rel} — ${res.detail}`);
      } else if (res.status === 'skipped') {
        skipped += 1;
        console.log(`  skip  ${rel} — ${res.detail}`);
      } else {
        console.log(`  ${res.strategy === 'tag' ? 'tag  ' : 'enc  '} ${rel} — ${res.detail}`);
      }
    }

    console.log(`Done. ${files.length - failures - skipped} processed, ${skipped} skipped, ${failures} failed.`);
    if (failures > 0) process.exitCode = 1;
  });

program
  .command('export-tags')
  .description('Read tags from every audio file and write a JSON manifest to clean up with an LLM.')
  .argument('<folder>', 'folder to scan recursively for audio files')
  .option('-o, --out <file>', 'manifest output path', 'music-tags.json')
  .action(async (folder, opts) => {
    const rootDir = path.resolve(folder);
    if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
      program.error(`not a directory: ${folder}`);
    }
    const outFile = path.resolve(opts.out);
    const res = await exportTags({ rootDir, outFile });
    if (res.total === 0) {
      console.log('No supported audio files found.');
      return;
    }
    console.log(`Exported ${res.exported}/${res.total} file(s) to ${path.relative(process.cwd(), outFile) || outFile}.`);
    if (res.failures > 0) {
      console.error(`${res.failures} file(s) could not be read.`);
      process.exitCode = 1;
    }
  });

program
  .command('apply-tags')
  .description('Apply an LLM-edited manifest: write tags and rename files.')
  .argument('<manifest>', 'path to the edited JSON manifest')
  .option('--dry-run', 'show planned changes without writing any files', false)
  .action(async (manifest, opts) => {
    const manifestPath = path.resolve(manifest);
    if (!fs.existsSync(manifestPath)) {
      program.error(`manifest not found: ${manifest}`);
    }
    const res = await applyTags({ manifestPath, dryRun: opts.dryRun });
    console.log(`Done. ${res.tagged} tagged, ${res.renamed} renamed, ${res.skipped} skipped, ${res.failures} failed.` +
      (opts.dryRun ? ' (dry run)' : ''));
    if (res.failures > 0) process.exitCode = 1;
  });

program.parseAsync().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});

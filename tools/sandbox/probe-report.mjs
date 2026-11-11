#!/usr/bin/env node
// Test tooling, never shipped. Prints what the two file system probes of tests/support/machine-skips.ts answer in this run,
// so that the log says why the tests that need fine file times or a new folder identity skipped. Run after the build.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

try {
  const { fileTimesAreCoarse, folderIdentityIsReused } = await import('../../dist/tests/support/machine-skips.js');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-probe-report-'));
  const birth = fs.statSync(folder, { bigint: true }).birthtimeNs;
  fs.rmSync(folder, { recursive: true, force: true });
  console.log(`file-time probe: ${fileTimesAreCoarse() ? 'coarse (two quick changes can share one timestamp), so the tests that need fine file times skip' : 'fine, so those tests run'}`);
  console.log(`folder-identity probe: ${folderIdentityIsReused() ? 'reused (a replaced folder can come back with the same device, inode and birth time), so the tests that replace a folder skip' : 'not reused, so those tests run'}`);
  console.log(`birth time of a new folder: ${birth === 0n ? 'missing (0), so the identity probe also answers reused when the inode is reused' : 'present'}`);
} catch (error) {
  console.log(`probe report not available: ${error.message}`);
  process.exitCode = 1;
}

#!/usr/bin/env node
// Reads a built binary and fails if any test-only part is compiled into it: the WebdriverIO plugin crate, the embedded WebDriver server crate, or the test-only
// dialog answer. Same idea as apps/desktop/tools/check-fuses.mjs for the Electron build. Usage: node scripts/check-release-clean.mjs [binary]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Strings that only a test build holds: crate names as they appear in symbols and panic paths, the plugin command prefix, and the test-only command. */
export const MARKERS = Object.freeze(['tauri_plugin_wdio', 'tauri-plugin-wdio', 'tauri_plugin_wdio_webdriver', 'tauri-plugin-wdio-webdriver', 'plugin:wdio', 'pick_folder']);

/** The markers found in the file, in the order of MARKERS. */
export function findMarkers(path) {
  const bytes = readFileSync(path);
  return MARKERS.filter(marker => bytes.includes(marker));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const spike = join(dirname(fileURLToPath(import.meta.url)), '..');
  const exe = process.argv[2] ?? join(spike, 'tauri', 'src-tauri', 'target', 'release', 'bundle', 'macos', 'Bowerloom Tauri Spike.app', 'Contents', 'MacOS', 'bowerloom-tauri-spike');
  if (!existsSync(exe)) { console.error(`No built binary at ${exe}.`); process.exit(2); }
  const found = findMarkers(exe);
  if (found.length > 0) { console.error(`Test-only parts are compiled in:\n  ${found.join('\n  ')}`); process.exit(1); }
  console.log(`Release binary is clean: none of ${MARKERS.length} test-only markers found.`);
}

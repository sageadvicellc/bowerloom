// Builds the smoke-check harness app: `harness/build/Bowerloom Smoke Harness.app`.
// Its own name and bundle id. An agent app (no dock icon). Ad-hoc signed with `--identifier` and a designated requirement that names only that identifier. macOS ties the
// Accessibility grant to the code requirement, so the grant should survive a rebuild. That is expected and is not proven until a rebuild after the grant.
// The harness has no dependency and no network code. It is built by cargo from the standard library alone.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NAME = 'Bowerloom Smoke Harness';
export const ID = 'com.sageadvice.bowerloom.smokeharness';
const BINARY = 'bowerloom-smoke-harness';
const here = join(dirname(fileURLToPath(import.meta.url)), '..', 'harness');
const env = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}`, CARGO_TARGET_DIR: join(here, 'target') };

const build = spawnSync('cargo', ['build', '--release', '--manifest-path', join(here, 'Cargo.toml')], { env, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const app = join(here, 'build', `${NAME}.app`);
rmSync(app, { recursive: true, force: true });
mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
copyFileSync(join(here, 'target', 'release', BINARY), join(app, 'Contents', 'MacOS', BINARY));
chmodSync(join(app, 'Contents', 'MacOS', BINARY), 0o755);
writeFileSync(join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${ID}</string>
  <key>CFBundleName</key>
  <string>${NAME}</string>
  <key>CFBundleDisplayName</key>
  <string>${NAME}</string>
  <key>CFBundleExecutable</key>
  <string>${BINARY}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>0.0.0</string>
  <key>CFBundleShortVersionString</key>
  <string>0.0.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
</dict>
</plist>
`);
const sign = spawnSync('codesign', ['--force', '--sign', '-', '--identifier', ID, '--requirements', `=designated => identifier "${ID}"`, app], { stdio: 'inherit' });
if (sign.status !== 0) process.exit(sign.status ?? 1);
console.log(`harness: ${app}`);

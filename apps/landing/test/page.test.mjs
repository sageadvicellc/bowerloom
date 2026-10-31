import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { release, installAvailable, readerRelease, releasesUrl, docsPath } from '../src/release.ts';
import { hero, whatItDoes, howItWorks, app, commandLine, engines, install, questions, installView, destinations } from '../src/content.ts';
import { screenshotSlots } from '../src/screenshots.ts';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const sources = async () => {
  const names = (await readdir(new URL('../src/', import.meta.url))).filter(name => /\.(tsx?|css)$/.test(name));
  return Promise.all(names.map(async name => [name, await read('src/' + name)]));
};

test('the hero carries the approved 0.8 message', () => {
  assert.equal(hero.Eyebrow, 'Open beta');
  assert.equal(hero.H1, 'One setup, two engines');
  assert.ok(hero.Body.startsWith('Define your skills, agents, tools, rules, and context once. Bowerloom installs them into Claude Code and Codex.'));
  assert.ok(hero.Body.endsWith('what each engine can carry and what it cannot.'));
  assert.equal(hero['Primary CTA'], 'Get the app (beta)');
  assert.equal(hero['Secondary link'], 'Install the command line');
  assert.equal(hero.Note, 'Free and open source under the MIT license. For macOS.');
});

test('the open beta label carries no version number', () => {
  assert.equal(readerRelease.label, 'Open beta');
  assert.doesNotMatch(JSON.stringify(readerRelease), /\d+\.\d+\.\d+/);
});

test('the download button goes to the releases page and names no asset', () => {
  assert.equal(releasesUrl, 'https://github.com/sageadvicellc/bowerloom/releases');
  assert.equal(releasesUrl, `${release.urls.repository}/releases`);
});

test('the page structure follows the approved outline', () => {
  assert.equal(whatItDoes.heading, 'Keep one definition. Install it everywhere.');
  assert.equal(whatItDoes.features.length, 4);
  assert.deepEqual(whatItDoes.features.map(feature => feature.title), [
    'See what each engine can carry', 'Read the plan before anything is written', 'Go back', 'Start from what you have',
  ]);
  assert.deepEqual(howItWorks.steps.map(step => step.title), ['Adopt', 'Preview', 'Install and watch']);
  assert.equal(howItWorks.boundary, 'Setup does not start workers, grant runtime access, or authorize connected actions.');
  assert.equal(app.heading, 'The app (beta)');
  assert.deepEqual(app.features.map(feature => feature.title), ['Builder', 'Save points', 'Notes keeper']);
  assert.equal(commandLine.commands.length, 4);
  assert.ok(commandLine.commands.includes('bowerloom harness install --engine claude-code --engine codex'));
  assert.equal(commandLine.note, 'No harness command runs an engine or a model.');
  assert.equal(engines.heading, 'Two engines now. Three in preview.');
  assert.equal(install.appSteps.length, 5);
  assert.equal(questions.length, 6);
});

test('the engines section says engines and the preview switch is exact', () => {
  assert.match(engines.body, /OpenCode, Pi, and DeepSeek Harness are preview engines\./);
  assert.match(engines.body, /`BOWERLOOM_PREVIEW_ENGINES=1`/);
  assert.deepEqual(engines.supported, ['Claude Code', 'Codex']);
  assert.deepEqual(engines.preview, ['OpenCode', 'Pi', 'DeepSeek Harness']);
});

test('the npm command shows only after the release record says it is published', () => {
  const before = installView(false);
  assert.equal(before.command, null);
  assert.match(before.text, /arrives when the beta publishes/);
  const after = installView(true);
  assert.equal(after.command, release.npm.installCommand);
  assert.doesNotMatch(after.text, /arrives when the beta publishes/);
  assert.match(after.text, /Do not use `npm update -g`\./);
  assert.equal(installView().command === null, !installAvailable);
});

test('the stated requirements match the release record', () => {
  assert.equal(release.requirements.node, '>=24.11.0 <25');
  assert.equal(release.requirements.npm, '11');
  assert.match(installView(true).text, /Node 24\.11 or a later 24\.x, and npm 11/);
  assert.match(installView(false).text, /Node 24\.11 or a later 24\.x, and npm 11/);
});

test('the app install steps match the approved order', () => {
  assert.match(install.appIntro, /Apple did not sign or notarize the app/);
  assert.match(install.appSteps[0], /Applications/);
  assert.match(install.appSteps[3], /Open Anyway/);
  assert.equal(install.appUpdate, 'The app does not update itself yet. When a new build is out, download it.');
});

test('the old 0.7 pages, anchors, and words are gone', async () => {
  for (const name of ['LabsWorkflow.tsx', 'TutorialBuilder.tsx', 'labs-roles.ts', 'tutorial.ts', 'labs.css', 'tutorial.css', 'Workshop.tsx', 'StaticWorkshop.tsx', 'CinematicWorld.tsx']) {
    await assert.rejects(read('src/' + name), name);
  }
  for (const [name, text] of await sources()) {
    assert.doesNotMatch(text, /href="#(?:build|recipe)"|selector: "#(?:build|recipe)"|CoreOffers|LabsWorkflow|TutorialBuilder|labs-roles|Knowledge officer|Brand review|Tech lead\b/, name);
  }
  const text = JSON.stringify({ hero, whatItDoes, howItWorks, app, commandLine, engines, install, questions });
  assert.doesNotMatch(text, /\b(?:Relay|Roots|Vines|Workbench|Sagespec|Labs workflow|tutorial)\b/i);
});

test('no image text names a person', async () => {
  for (const [name, text] of await sources()) assert.doesNotMatch(text, /Hanna/, name);
  for (const path of ['public/fullpage-coverage/manifest.json', 'public/panel-units/manifest.json']) assert.doesNotMatch(await read(path), /Hanna/, path);
});

test('every navigation link and hero link points at a section that exists', async () => {
  const sections = await read('src/Sections.tsx');
  const app = await read('src/App.tsx');
  const nav = await read('src/SiteNavigation.tsx');
  const ids = new Set([...(sections + app).matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const targets = [...(nav + app + sections).matchAll(/href="#([^"]+)"/g)].map(match => match[1]);
  assert.ok(targets.length >= 5);
  for (const target of targets) assert.ok(ids.has(target), `#${target} has a section`);
  const regions = await read('src/cinematic-config.ts');
  for (const match of regions.matchAll(/"selector": "#([^"]+)"/g)) assert.ok(ids.has(match[1]), `region #${match[1]}`);
});

test('every screenshot slot is used once, uses one placeholder, and names the screen it needs', async () => {
  const sections = await read('src/Sections.tsx');
  assert.equal(new Set(screenshotSlots.map(slot => slot.id)).size, screenshotSlots.length);
  assert.ok(screenshotSlots.length >= 4);
  for (const slot of screenshotSlots) {
    assert.ok(slot.caption.length > 20 && slot.capture.length > 20, slot.id);
    assert.equal(sections.split(`<ScreenshotSlot slot="${slot.id}"`).length - 1, 1, slot.id);
  }
  assert.equal((sections.match(/<ScreenshotSlot /g) ?? []).length, screenshotSlots.length);
  assert.doesNotMatch(sections, /<img /, 'Sections use the placeholder, not images');
  const placeholder = await read('src/ScreenshotSlot.tsx');
  assert.match(placeholder, /data-screenshot-slot/);
  assert.doesNotMatch(placeholder, /<img /);
});

test('the footer and links name no removed page', () => {
  assert.equal(destinations.license, `${release.urls.repository}/blob/main/LICENSE`);
  assert.equal(docsPath, '/docs/');
});

test('new motion follows the principles: no looping, only transform and opacity, a reduced-motion path', async () => {
  const css = await read('src/page.css');
  assert.doesNotMatch(css, /animation-iteration-count:\s*infinite|infinite/);
  assert.doesNotMatch(css, /transition(?:-property)?:[^;]*\b(?:width|height|top|left|margin|padding|all)\b/);
  assert.doesNotMatch(css, /transition:[^;]*\b(?:ease|ease-in-out)\s*[;,]/);
  if (/transition|animation/.test(css)) assert.match(css, /prefers-reduced-motion: reduce/);
});

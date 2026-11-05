import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { installAvailable, installCommand, readerRelease, releasesUrl, repositoryUrl, docsPath } from '../src/release.ts';
import { loadPage } from './render-helpers.mjs';
import { hero, whatItDoes, howItWorks, app, commandLine, engines, install, questions, installView, destinations } from '../src/content.ts';
import { screenshotSlots } from '../src/screenshots.ts';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const release = JSON.parse(await read('../../release/beta.json'));
const sources = async () => {
  const names = (await readdir(new URL('../src/', import.meta.url))).filter(name => /\.(tsx?|css)$/.test(name));
  return Promise.all(names.map(async name => [name, await read('src/' + name)]));
};

test('the hero carries the revised 0.8 message: a tag, the nest headline, and two short lines', () => {
  assert.equal(hero.Eyebrow, 'Open beta');
  assert.equal(hero.H1, 'A cozy nest for your agents');
  assert.ok(hero.Body.includes('Claude Code and Codex'));
  assert.equal(hero.Detail, 'Before it writes a file, it shows what each engine can carry and what it cannot.');
  for (const line of [hero.Body, hero.Detail]) assert.ok(line.split(/[.!?]\s/).every(sentence => sentence.split(/\s+/).length <= 20), line);
  assert.ok(hero.Body.length + hero.Detail.length < 220, 'the description is one or two short lines');
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
  assert.equal(repositoryUrl, release.urls.repository);
});

test('the page structure follows the approved outline', () => {
  assert.equal(whatItDoes.heading, 'Keep one definition. Install it everywhere.');
  assert.deepEqual(whatItDoes.features.map(feature => feature.title), ['See what each engine can carry']);
  assert.deepEqual(whatItDoes.journey.steps.map(step => step.title), ['Start from what you have', 'Read the plan before anything is written', 'Go back']);
  assert.deepEqual(howItWorks.steps.map(step => step.title), ['Adopt the files you already have', 'Preview what each engine can carry', 'Approve the plan, then watch for drift']);
  for (const step of howItWorks.steps) assert.ok(step.title.split(/\s+/).length >= 3 && step.title.split(/\s+/).length <= 8, `${step.title}: a short, clear phrase`);
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

test('the install command always shows, and the note about npm shows only until the release record says the package is published', () => {
  const before = installView(false);
  assert.equal(before.command, release.npm.installCommand);
  assert.equal(before.pending, true);
  assert.match(before.pendingNote, /not on npm yet/);
  assert.doesNotMatch(JSON.stringify(before), /arrives when the beta publishes/);
  const after = installView(true);
  assert.equal(after.command, release.npm.installCommand);
  assert.equal(after.pending, false);
  assert.equal(after.pendingNote, null);
  assert.equal(installCommand, release.npm.installCommand);
  assert.match(after.text, /Do not use `npm update -g`\./);
  assert.equal(installView().pending, !installAvailable);
  assert.equal(installAvailable, release.npm.published && release.state === 'published');
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
  for (const name of ['LabsWorkflow.tsx', 'TutorialBuilder.tsx', 'labs-roles.ts', 'tutorial.ts', 'labs.css', 'tutorial.css', 'Workshop.tsx', 'StaticWorkshop.tsx', 'CinematicWorld.tsx',
    'AnimationSplash.tsx', 'CinematicIntro.tsx', 'cinematic-config.ts', 'cinematic-scrub.ts', 'fullpage-media.ts', 'fullpage-scroll.ts', 'intro-controller.ts', 'intro-media.ts', 'splash-playback.ts', 'intro.css']) {
    await assert.rejects(read('src/' + name), name);
  }
  for (const [name, text] of await sources()) {
    assert.doesNotMatch(text, /href="#(?:build|recipe)"|selector: "#(?:build|recipe)"|CoreOffers|LabsWorkflow|TutorialBuilder|labs-roles|Knowledge officer|Brand review|Tech lead\b/, name);
  }
  const text = JSON.stringify({ hero, whatItDoes, howItWorks, app, commandLine, engines, install, questions });
  assert.doesNotMatch(text, /\b(?:Relay|Roots|Vines|Workbench|Sagespec|Labs workflow|tutorial)\b/i);
});

// The owner's name stays out of this public file: the set holds the sha256 of each lowercased name, one word or two words joined by one space.
// It is kept apart from the client-name set in the desktop and docs tests, which guards a different list.
const OWNER_NAME_HASHES = new Set([
  'b5679ea7383b47df1553f6c89e6d73d26aab70e5ea2b4344fed5c66553ef4a67',
  '0bf4c90a3e7e57c697947017f622b24a5563af0ae973914ba9ebdcb903fa3ebd',
]);
const sha256 = text => createHash('sha256').update(text).digest('hex');
/** The word positions where a listed name starts: a word, or a pair of words in a row. */
const ownerNames = (text, hashes = OWNER_NAME_HASHES) => {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const found = [];
  for (let i = 0; i < words.length; i++) {
    if (hashes.has(sha256(words[i]))) found.push(i);
    if (i + 1 < words.length && hashes.has(sha256(`${words[i]} ${words[i + 1]}`))) found.push(i);
  }
  return found;
};

test('the owner-name check finds a listed word and a listed pair, and passes other text', () => {
  const stand = new Set([sha256('example'), sha256('example co')]);
  assert.deepEqual(ownerNames('Made by EXAMPLE Co, not by anyone else.', stand), [2, 2]);
  assert.deepEqual(ownerNames('Made by Example, with a sample.', stand), [2]);
  assert.deepEqual(ownerNames('Bowerloom installs into Claude Code and Codex.', stand), []);
  assert.deepEqual(ownerNames('', stand), []);
});

test('no page source, copy, or image text names a person', async () => {
  for (const [name, text] of await sources()) assert.deepEqual(ownerNames(text), [], name);
  assert.deepEqual(ownerNames(JSON.stringify({ hero, whatItDoes, howItWorks, app, commandLine, engines, install, questions, screenshotSlots })), []);
  assert.deepEqual(ownerNames(await read('public/panel-units/manifest.json')), [], 'public/panel-units/manifest.json');
});

test('every navigation link and hero link points at a section that exists', async () => {
  const sections = await read('src/Sections.tsx');
  const app = await read('src/App.tsx');
  const nav = await read('src/SiteNavigation.tsx');
  const heroSource = await read('src/Hero.tsx');
  const ids = new Set([...(sections + app + heroSource).matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const targets = [...(nav + app + sections).matchAll(/href="#([^"]+)"/g), ...heroSource.matchAll(/'#([a-z-]+)'/g)].map(match => match[1]);
  assert.ok(targets.includes('install-cli'), 'the hero command line link goes to the install command');
  assert.ok(targets.length >= 5);
  for (const target of targets) assert.ok(ids.has(target), `#${target} has a section`);
});

test('every screenshot slot is used once, has one image per theme, and says what its screen shows', async () => {
  const sections = (await read('src/Sections.tsx')) + (await read('src/Hero.tsx'));
  assert.equal(new Set(screenshotSlots.map(slot => slot.id)).size, screenshotSlots.length);
  assert.ok(screenshotSlots.length >= 4);
  for (const slot of screenshotSlots) {
    assert.ok(slot.caption.length > 20 && slot.capture.length > 20, slot.id);
    assert.ok(slot.alt.length > 60 && slot.alt !== slot.caption, `${slot.id}: the alt text says what the picture shows`);
    assert.ok(Number.isInteger(slot.width) && Number.isInteger(slot.height) && slot.width / slot.height > 1.4 && slot.width / slot.height < 1.7, `${slot.id}: a size that suits a 16:10 slot`);
    assert.equal(sections.split(`<ScreenshotSlot slot="${slot.id}"`).length - 1, 1, slot.id);
  }
  assert.equal((sections.match(/<ScreenshotSlot /g) ?? []).length, screenshotSlots.length);
  assert.doesNotMatch(sections, /<img /, 'Sections use the slot component, not images');
  const slotSource = await read('src/ScreenshotSlot.tsx');
  assert.match(slotSource, /data-screenshot-slot/);
  assert.match(slotSource, /loading="lazy"/);
  assert.match(slotSource, /width=\{item\.width\} height=\{item\.height\}/);
  assert.match(slotSource, /alt=\{item\.alt\}/);
  assert.doesNotMatch(slotSource + await read('src/page.css'), /Screenshot to come|screenshot-frame/, 'the placeholder is gone');
});

/** Width and height of a WebP file, read from its header (lossy, lossless, and extended files). */
function webpSize(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  const kind = bytes.toString('ascii', 12, 16);
  if (kind === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') { const bits = bytes.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
  if (kind === 'VP8X') return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  throw new Error(`Unknown WebP chunk ${kind}`);
}

test('every screenshot has a light and a dark WebP file under 300 KB, at the size the slot says', async () => {
  for (const slot of screenshotSlots) {
    for (const theme of ['light', 'dark']) {
      const bytes = await readFile(new URL(`../public/shots/${slot.id}-${theme}.webp`, import.meta.url));
      assert.ok(bytes.byteLength < 300 * 1024, `${slot.id}-${theme} is ${bytes.byteLength} bytes`);
      assert.deepEqual(webpSize(bytes), { width: slot.width, height: slot.height }, `${slot.id}-${theme}`);
    }
  }
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

const links = html => [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(match => ({ href: match[1], text: match[2].replace(/<[^>]+>/g, '').trim() }));

test('the page renders: both buttons go to the right place, and the command line link goes to the install command', async () => {
  const page = await loadPage();
  try {
    const heroLinks = links(renderToStaticMarkup(createElement(page.hero.default)));
    assert.equal(heroLinks.find(link => link.text.startsWith(hero['Primary CTA']))?.href, releasesUrl);
    assert.equal(heroLinks.find(link => link.text === hero['Secondary link'])?.href, '#install-cli');
    const install = available => renderToStaticMarkup(createElement(page.sections.InstallSection, { available }));
    for (const available of [false, true]) {
      const app = links(install(available)).find(link => link.text.startsWith('Get the app (beta)'));
      assert.equal(app?.href, releasesUrl);
    }
  } finally { await page.close(); }
});

test('the hero shows the open beta tag, the nest headline, two short lines, and the app screenshot', async () => {
  const page = await loadPage();
  try {
    const html = renderToStaticMarkup(createElement(page.hero.default));
    assert.match(html, /<p class="release-tag">[\s\S]*?Open beta<\/p>/, 'the label is a tag, not plain eyebrow text');
    assert.ok(!html.includes('class="eyebrow"'));
    assert.match(html, /<h1 id="hero-title">A cozy nest for your agents<\/h1>/);
    assert.ok(html.includes(hero.Body) && html.includes(hero.Detail));
    assert.equal((html.match(/class="release-tag-sparkle"/g) ?? []).length, 1, 'at most one sparkle');
    assert.ok(html.includes('data-screenshot-slot="fidelity-preview"'), 'a visual of what the app does sits in the hero');
    assert.ok(html.indexOf('class="homepage-banner"') < html.indexOf('id="hero-title"'), 'the image leads the header');
  } finally { await page.close(); }
});

test('the install section shows the command with a copy button, with the app first, whether or not npm has the package', async () => {
  const page = await loadPage();
  try {
    const render = (name, props = {}) => renderToStaticMarkup(createElement(page.sections[name], props));
    const text = html => html.replace(/<[^>]+>/g, '');
    const codeText = html => html.match(/<code>([\s\S]*?)<\/code>/)[1].replace(/<[^>]+>/g, '');
    for (const available of [false, true]) {
      const html = render('InstallSection', { available });
      assert.ok(text(html).includes(release.npm.installCommand), `command shown, available=${available}`);
      assert.equal(codeText(html.slice(html.indexOf('<pre'))), release.npm.installCommand, 'wrapping markup adds no characters to the copied command');
      assert.match(html, /<button type="button" class="copy-button"[^>]*>[\s\S]*?Copy[\s\S]*?<\/button>/);
      assert.ok(html.includes('aria-label="Install command"'));
      assert.ok(html.indexOf('id="install-app"') < html.indexOf('id="install-cli"'), 'the app download stays the primary path');
      assert.ok(!html.includes('arrives when the beta publishes'));
      assert.equal(html.includes('not on npm yet'), !available, 'the npm note shows only until the package is published');
    }
    const commandLineHtml = render('CommandLineSection');
    assert.equal(codeText(commandLineHtml.slice(commandLineHtml.indexOf('<pre'))), commandLine.commands.join('\n'));
  } finally { await page.close(); }
});

test('the features section is one engine item plus one three-step strip, and the engines sit beside the app section', async () => {
  const page = await loadPage();
  try {
    const html = renderToStaticMarkup(createElement(page.sections.WhatItDoes));
    assert.equal((html.match(/<li class="journey-step"/g) ?? []).length, 3);
    for (const step of whatItDoes.journey.steps) assert.ok(html.includes(`<h4>${step.title}</h4>`) || html.includes(`>${step.title}<`), step.title);
    assert.ok(html.includes('See what each engine can carry'));
    assert.ok(!html.includes('<img'), 'the screenshot moved to the hero, so the imagery comes sooner');
    const app = await read('src/App.tsx');
    assert.ok(app.indexOf('<AppSection />') < app.indexOf('<EnginesSection />') && app.indexOf('<EnginesSection />') < app.indexOf('<CommandLineSection />'), 'engines follow the app features');
  } finally { await page.close(); }
});

test('a screenshot slot shows both themes\' images with a size, late loading, and alt text, and keeps its caption', async () => {
  const page = await loadPage();
  try {
    const html = renderToStaticMarkup(createElement(page.hero.default));
    const [slot] = screenshotSlots;
    const images = [...html.matchAll(/<img [^>]*>/g)].map(match => match[0]).filter(tag => tag.includes('data-shot-theme'));
    assert.equal(images.length, 2, 'one image for each theme');
    for (const theme of ['light', 'dark']) {
      const image = images.find(tag => tag.includes(`data-shot-theme="${theme}"`));
      assert.ok(image, theme);
      assert.ok(image.includes(`src="/shots/${slot.id}-${theme}.webp"`), theme);
      assert.ok(image.includes(`width="${slot.width}"`) && image.includes(`height="${slot.height}"`), theme);
      assert.ok(image.includes('loading="lazy"'), theme);
      assert.ok(image.includes('alt="'), theme);
    }
    assert.match(html, new RegExp(`<figcaption id="[^"]+">${slot.caption.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<\/figcaption>`));
    assert.doesNotMatch(html, /Screenshot to come|aria-hidden="true">Screenshot/);
  } finally { await page.close(); }
});

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
  assert.equal(repositoryUrl, release.urls.repository);
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
  assert.equal(installCommand, release.npm.installCommand);
  assert.doesNotMatch(after.text, /arrives when the beta publishes/);
  assert.match(after.text, /Do not use `npm update -g`\./);
  assert.equal(installView().command === null, !installAvailable);
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
  assert.ok(targets.includes('install-cli') && targets.includes('command-line'), 'the hero names both command line targets');
  assert.ok(targets.length >= 5);
  for (const target of targets) assert.ok(ids.has(target), `#${target} has a section`);
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
  assert.match(placeholder, /screenshot-frame" aria-hidden="true"/);
  assert.doesNotMatch(placeholder, /role="img"|aria-label/, 'the caption alone carries the meaning');
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

const links = html => [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(match => ({ href: match[1], text: match[2].replace(/<[^>]+>/g, '').trim() }));

test('the page renders: both buttons go to the releases page, and the command line link follows the npm gate', async () => {
  const page = await loadPage();
  try {
    const heroLinks = available => links(renderToStaticMarkup(createElement(page.hero.default, { available })));
    const unpublished = heroLinks(false), published = heroLinks(true);
    for (const list of [unpublished, published]) {
      assert.equal(list.find(link => link.text.startsWith(hero['Primary CTA']))?.href, releasesUrl);
    }
    assert.equal(unpublished.find(link => link.text === hero['Secondary link'])?.href, '#command-line');
    assert.equal(published.find(link => link.text === hero['Secondary link'])?.href, '#install-cli');
    const install = available => renderToStaticMarkup(createElement(page.sections.InstallSection, { available }));
    for (const available of [false, true]) {
      const app = links(install(available)).find(link => link.text.startsWith('Get the app (beta)'));
      assert.equal(app?.href, releasesUrl);
    }
  } finally { await page.close(); }
});

test('the install command is absent while npm lacks the package, and present when it has it', async () => {
  const page = await loadPage();
  try {
    const render = (name, props = {}) => renderToStaticMarkup(createElement(page.sections[name], props));
    const text = html => html.replace(/<[^>]+>/g, '');
    const unpublished = render('InstallSection', { available: false });
    assert.ok(!text(unpublished).includes(release.npm.installCommand), 'no npm command before publication');
    assert.ok(!unpublished.includes('aria-label="Install command"'));
    assert.match(unpublished, /The install command arrives when the beta publishes\./);
    assert.equal((unpublished.match(/arrives when the beta publishes/g) ?? []).length, 1, 'the unpublished state is said once on the page');
    assert.ok(unpublished.indexOf('id="install-app"') < unpublished.indexOf('id="install-cli"'), 'the app card leads while the command is unpublished');
    const published = render('InstallSection', { available: true });
    assert.ok(text(published).includes(release.npm.installCommand), 'the npm command shows after publication');
    assert.ok(!published.includes('arrives when the beta publishes'));
    assert.ok(published.indexOf('id="install-cli"') < published.indexOf('id="install-app"'));
    const commandLineHtml = render('CommandLineSection');
    assert.ok(!commandLineHtml.includes('arrives when the beta publishes'), 'the command line section does not repeat the note');
    const codeText = html => html.match(/<code>([\s\S]*?)<\/code>/)[1].replace(/<[^>]+>/g, '');
    assert.equal(codeText(commandLineHtml.slice(commandLineHtml.indexOf('<pre'))), commandLine.commands.join('\n'), 'wrapping markup adds no characters to the copied command');
    assert.equal(codeText(published.slice(published.indexOf('<pre'))), release.npm.installCommand);
  } finally { await page.close(); }
});

test('a screenshot slot hides its frame from screen readers and keeps its caption', async () => {
  const page = await loadPage();
  try {
    const html = renderToStaticMarkup(createElement(page.sections.WhatItDoes));
    assert.match(html, /<div class="screenshot-frame" aria-hidden="true">Screenshot to come<\/div>/);
    assert.ok(html.includes(`<figcaption>${screenshotSlots[0].caption}</figcaption>`));
    assert.doesNotMatch(html, /role="img"/);
  } finally { await page.close(); }
});

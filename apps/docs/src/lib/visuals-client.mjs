// Browser side of the visuals: the Enlarge buttons, the framed viewer, and the terminal Copy button.
// The markup comes from visuals.mjs and works without this file; this file only adds what needs script.
import {commandsFromPanel} from './terminal-text.mjs';

const PLANTS = [{name: 'ivy', file: 'ivy.webp', width: 240, height: 653}, {name: 'bloom', file: 'bloom.webp', width: 301, height: 281}];

/** Where Tab should go inside the viewer: the control to focus when Tab would run off an end, or null to let the browser move the focus. */
export function tabTarget(focusables, active, backwards) {
  if (focusables.length === 0) return null;
  const first = focusables[0], last = focusables[focusables.length - 1];
  const index = active === null ? -1 : focusables.indexOf(active);
  if (index === -1) return backwards ? last : first;
  if (backwards && active === first) return last;
  if (!backwards && active === last) return first;
  return null;
}
/** A click closes the viewer only when the press began on the backdrop and the click ended on it. */
export const closesOnBackdrop = (pressBeganOnBackdrop, target, dialog) => pressBeganOnBackdrop && target === dialog;

function make(doc, tag, className, attributes = {}) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}
const svg = (doc, markup) => { const holder = make(doc, 'span'); holder.innerHTML = markup; return holder.firstElementChild; };

async function copyCommands(button, panel, host) {
  const label = button.dataset.label ??= button.textContent;
  const status = panel.querySelector('.vt-status');
  const say = (text, announce) => { button.textContent = text; if (status) status.textContent = announce; };
  try { await host.navigator.clipboard.writeText(commandsFromPanel(panel)); say('Copied', 'Commands copied'); }
  catch { say('Select to copy', 'Select the commands to copy'); }
  host.setTimeout(() => { button.textContent = label; if (status) status.textContent = ''; }, 2000);
}

function buildViewer(figure, doc, base, onCopy) {
  const terminal = figure.classList.contains('visual-terminal');
  const title = terminal ? figure.querySelector('.vt-title').textContent : figure.querySelector('.visual-img').alt;
  const dialog = make(doc, 'dialog', 'visual-dialog', {'aria-label': terminal ? `Terminal sample: ${title}` : title});
  const column = make(doc, 'div', 'visual-column');
  const bar = make(doc, 'div', 'visual-dialog-bar');
  const text = make(doc, 'div', 'visual-dialog-text');
  const note = make(doc, 'p', 'visual-dialog-caption'); note.textContent = figure.querySelector('.visual-caption').textContent;
  const pinch = make(doc, 'p', 'visual-pinch'); pinch.textContent = 'Pinch to zoom';
  text.append(note, ...(terminal ? [] : [pinch]));
  const form = make(doc, 'form', '', {method: 'dialog'});
  const close = make(doc, 'button', 'visual-close', {type: 'submit', 'aria-label': 'Close'});
  close.append(svg(doc, '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'));
  form.append(close); bar.append(text, form);
  const device = make(doc, 'div', 'visual-device');
  const scroll = make(doc, 'div', 'visual-scroll');
  let sync = null;
  if (terminal) {
    const panel = figure.querySelector('.vt-panel').cloneNode(true);
    scroll.append(panel);
  } else {
    // Only the current theme's file is fetched. `sync` swaps it when the page theme changes while the viewer is open.
    const full = make(doc, 'img', 'visual-full', {alt: '', loading: 'lazy', decoding: 'async'});
    sync = () => {
      const theme = doc.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
      const source = figure.querySelector(`.visual-img[data-shot-theme="${theme}"]`);
      full.dataset.shotTheme = theme;
      full.setAttribute('width', source.getAttribute('width')); full.setAttribute('height', source.getAttribute('height'));
      if (full.getAttribute('src') !== source.getAttribute('src')) full.setAttribute('src', source.getAttribute('src'));
    };
    sync();
    scroll.append(full);
  }
  device.append(scroll);
  for (const plant of PLANTS) device.append(make(doc, 'img', `deco ${plant.name}`, {src: `${base}/frame/${plant.file}`, width: plant.width, height: plant.height, alt: '', 'aria-hidden': 'true', loading: 'lazy', decoding: 'async'}));
  column.append(bar, device); dialog.append(column);

  let pressedOnBackdrop = false;
  dialog.addEventListener('pointerdown', event => { pressedOnBackdrop = event.target === dialog; });
  dialog.addEventListener('click', event => {
    const copy = event.target.closest?.('.vt-copy');
    if (copy) { onCopy(copy); return; }
    const close = closesOnBackdrop(pressedOnBackdrop, event.target, dialog);
    pressedOnBackdrop = false;
    if (close) dialog.close();
  });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); dialog.close(); return; }
    if (event.key !== 'Tab') return;
    const focusables = [...dialog.querySelectorAll('button:not([disabled]):not([hidden]), [tabindex="0"]')];
    const target = tabTarget(focusables, doc.activeElement, event.shiftKey);
    if (target) { event.preventDefault(); target.focus(); }
  });
  return {dialog, sync};
}

/** Wires every visual under `root`. Returns a function that removes what it added. */
export function mountVisuals(root, doc = document, {base = '/docs', host = doc.defaultView} = {}) {
  const viewers = new Map();
  const onCopy = button => copyCommands(button, button.closest('.vt-panel'), host);
  for (const node of root.querySelectorAll('.visual-enlarge, .vt-copy')) node.hidden = false;
  for (const figure of root.querySelectorAll('.visual')) figure.dataset.ready = '';
  const open = (figure, opener) => {
    let viewer = viewers.get(figure);
    if (!viewer) { viewer = buildViewer(figure, doc, base, onCopy); doc.body.append(viewer.dialog); viewers.set(figure, viewer); }
    const {dialog, sync} = viewer;
    let watcher = null;
    if (sync) { sync(); watcher = new host.MutationObserver(sync); watcher.observe(doc.documentElement, {attributes: true, attributeFilter: ['data-theme']}); }
    dialog.addEventListener('close', () => { watcher?.disconnect(); opener.focus(); }, {once: true});
    dialog.showModal();
  };
  const click = event => {
    const copy = event.target.closest?.('.vt-copy');
    if (copy) { onCopy(copy); return; }
    const figure = event.target.closest?.('.visual');
    if (!figure || !root.contains(figure)) return;
    const enlarge = figure.querySelector('.visual-enlarge');
    if (event.target.closest('.visual-enlarge') || event.target.closest('.visual-frame')) open(figure, enlarge);
  };
  root.addEventListener('click', click);
  return () => {
    root.removeEventListener('click', click);
    for (const {dialog} of viewers.values()) { dialog.close?.(); dialog.remove(); }
    viewers.clear();
  };
}

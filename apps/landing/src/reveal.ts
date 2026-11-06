// Reveal on scroll. One shared IntersectionObserver marks each target once and then lets it go.
// The page is fully visible until `js-reveal` goes on <html>. Only after that do the targets below start hidden.
import { installSprings } from './spring.ts';

/** Text rises on the text spring; cards, images, chips and the install card rise on the soft spring. */
export const TARGETS: Record<'text' | 'card', string[]> = {
  text: [
    '.product-section h2', '.recipe-section h2', '.band h2', '.faq-section h2',
    '.band-lede', '.engine-lead', '.product-section .section-body > p:first-child', '.boundary-note',
  ],
  card: [
    '.feature-engine', '.steps li', '.app-grid article', '.engine-list li', '.install-card',
    '.section-body .screenshot-slot', '.split > .screenshot-slot', '#command-line .command-block',
  ],
};

export const STAGGER_MS = 60;
export const STAGGER_CAP = 6;

/** The delay for the n-th item (from 0) of a group that appears together: 60 ms apart, and no more than six items deep. */
export function staggerDelay(index: number): number {
  return Math.min(Math.max(index, 0), STAGGER_CAP - 1) * STAGGER_MS;
}

const REVEALED = 'data-revealed';
const NOW = 'data-reveal-now';

function show(el: Element, delay: number, instant: boolean): void {
  if (el.hasAttribute(REVEALED)) return;
  if (instant) el.setAttribute(NOW, '');
  (el as HTMLElement).style.setProperty('--reveal-delay', `${delay}ms`);
  el.setAttribute(REVEALED, '');
}

/** An element, and every revealable element around it, shows with no delay. `instant` also drops the motion. */
function showNowWithAncestors(start: Element | null, instant = true): void {
  for (let node = start; node; node = node.parentElement) if (node.hasAttribute('data-reveal')) show(node, 0, instant);
}

function keyboardFocus(el: Element): boolean {
  try { return el.matches(':focus-visible'); } catch { return true; }
}

export function initReveal(doc: Document = document, win: Window & typeof globalThis = window): () => void {
  if (typeof win.IntersectionObserver === 'undefined') return () => {};
  const root = doc.documentElement;
  // Targets are found once, here. A node mounted later is left as it is: it stays visible and is not revealed with motion.
  const targets: HTMLElement[] = [];
  for (const kind of ['text', 'card'] as const) {
    doc.querySelectorAll<HTMLElement>(TARGETS[kind].join(',')).forEach(el => {
      if (!el.hasAttribute('data-reveal')) el.setAttribute('data-reveal', kind);
      targets.push(el);
    });
  }

  installSprings(root);

  const observer = new win.IntersectionObserver(entries => {
    const fresh = entries.filter(entry => entry.isIntersecting).map(entry => entry.target);
    fresh.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    fresh.forEach((el, index) => {
      show(el, staggerDelay(index), false);
      observer.unobserve(el);
    });
  }, { rootMargin: '0px 0px -48px 0px' });

  // Whatever is on screen now shows at once, before the hiding class goes on, so nothing is hidden and then shown.
  for (const el of targets) {
    if (el.hasAttribute(REVEALED)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.top < win.innerHeight && rect.bottom > 0) show(el, 0, true);
    else observer.observe(el);
  }

  const revealHash = () => {
    const raw = win.location.hash.slice(1);
    let id = raw;
    try { id = decodeURIComponent(raw); } catch { /* a malformed escape such as "%": use the raw text */ }
    const target = id && id !== 'main' ? doc.getElementById(id) ?? (id === raw ? null : doc.getElementById(raw)) : null;
    if (!target) return;
    showNowWithAncestors(target);
    target.querySelectorAll('[data-reveal]').forEach(el => show(el, 0, true));
  };
  // Keyboard focus snaps the content into place. Focus from a press keeps the short rise, so a button never jumps between the press and the release.
  const onFocus = (event: FocusEvent) => {
    const el = event.target instanceof Element ? event.target : null;
    if (el) showNowWithAncestors(el, keyboardFocus(el));
  };

  doc.addEventListener('focusin', onFocus);
  win.addEventListener('hashchange', revealHash);
  revealHash();
  root.classList.add('js-reveal');

  return () => {
    observer.disconnect();
    doc.removeEventListener('focusin', onFocus);
    win.removeEventListener('hashchange', revealHash);
    root.classList.remove('js-reveal');
  };
}

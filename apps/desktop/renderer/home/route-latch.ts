/**
 * Which pages of real mode the address asks for, and the rule that keeps a window in real mode. A window that has entered a real page stays in real mode: an address that is not a real
 * page (the skip link's #main, a sample page typed by hand) never takes it back to the sample world, which is made up and editable, in a window that holds the real bridge.
 */
import { REAL_HARNESS_HASH, REAL_HASH } from '../../shared/real/types.js';

/** The pages of real mode, which build no sample world at all. */
export type RealPage = 'real' | 'bare';

/** The real page an address asks for, or null for any other address. */
export const realPageOf = (hash: string): RealPage | null => (hash === REAL_HASH ? 'real' : hash === REAL_HARNESS_HASH ? 'bare' : null);

/** The real page after an address change: a real address picks its page, any other address leaves the page as it is (real stays real, the sample stays the sample). */
export const latchRealPage = (current: RealPage | null, hash: string): RealPage | null => realPageOf(hash) ?? current;

/**
 * Makes the page's first link, "Skip to the content" (index.html, outside React), move the focus to the main region without changing the address. The default of that link is to set
 * the address to #main, which is not a page of the app; the app keeps the page whatever the address says, but the address stays true to the page too.
 */
export function wireSkipLink(doc: Document): () => void {
  const link = doc.querySelector<HTMLAnchorElement>('a.skip');
  if (link === null) return () => undefined;
  const skip = (ev: MouseEvent): void => {
    ev.preventDefault();
    const main = doc.getElementById('main');
    if (main === null) return;
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
    main.focus();
  };
  link.addEventListener('click', skip);
  return () => link.removeEventListener('click', skip);
}

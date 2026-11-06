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

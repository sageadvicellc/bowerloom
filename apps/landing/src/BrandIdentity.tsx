/** Exact approved exports. The wordmark is a transparent PNG drawn from the approved SVG: the SVG cuts its letters with a mask from an embedded picture,
 * and Safari can paint it before that picture decodes, which shows a solid block. The PNG has no mask, so it never does. */
export default function BrandIdentity() {
  return <>
    <span className="brand-mascot" aria-hidden="true">
      <img className="brand-light" src="/brand/rose-conservatory/s4-g3-icon.svg" alt="" width="512" height="512" />
      <img className="brand-dark" src="/brand/rose-conservatory/s4-g3-icon-dark.svg" alt="" width="512" height="512" />
    </span>
    <span className="brand-wordmark" aria-hidden="true">
      <img className="brand-light" src="/brand/rose-conservatory/bowerloom-wordmark-plain-ink.png" alt="" width="1022" height="187" />
      <img className="brand-dark" src="/brand/rose-conservatory/bowerloom-wordmark-plain-cream.png" alt="" width="1022" height="187" />
    </span>
  </>;
}

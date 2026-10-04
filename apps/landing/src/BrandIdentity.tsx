/** Exact approved exports: raster-backed wordmark SVGs, not vector redraws. */
export default function BrandIdentity() {
  return <>
    <span className="brand-mascot" aria-hidden="true">
      <img className="brand-light" src="/brand/rose-conservatory/s4-g3-icon.svg" alt="" width="512" height="512" />
      <img className="brand-dark" src="/brand/rose-conservatory/s4-g3-icon-dark.svg" alt="" width="512" height="512" />
    </span>
    <span className="brand-wordmark" aria-hidden="true">
      <img className="brand-light" src="/brand/rose-conservatory/bowerloom-wordmark-plain-ink.svg" alt="" width="2044" height="374" />
      <img className="brand-dark" src="/brand/rose-conservatory/bowerloom-wordmark-plain-cream.svg" alt="" width="2044" height="374" />
    </span>
  </>;
}

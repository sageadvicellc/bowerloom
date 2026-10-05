import { useEffect, useRef, useState } from 'react';
import { watchBannerImage } from './banner-loading';
import './homepage-banner.css';

/** Canonical public artwork only; diagnostic routes must never supply the homepage. */
function BannerImage({ source, fallback, alt }: { source: string; fallback: string; alt: string }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const image = useRef<HTMLImageElement>(null);
  const selected = attempt === 0 ? source : fallback;
  useEffect(() => {
    const current = image.current;
    if (!current || state === 'unavailable') return;
    return watchBannerImage(current, () => setState('ready'), () => {
      if (attempt === 0 && fallback !== source) { setState('loading'); setAttempt(1); }
      else setState('unavailable');
    });
  }, [selected, attempt, fallback, source, state === 'unavailable']);
  return <div className="homepage-banner" data-artwork={state} data-artwork-source={attempt === 0 ? 'primary' : 'fallback'}>
    {state !== 'unavailable' && <img key={selected} ref={image} src={selected} alt={alt} loading="eager" decoding="async" fetchPriority="high" width="1440" height="810" />}
    <span className="homepage-banner-brand" aria-hidden="true">
      <img className="brand-light" src="/brand/rose-conservatory/bowerloom-wordmark-plain-ink.svg" alt="" width="2044" height="374" />
      <img className="brand-dark" src="/brand/rose-conservatory/bowerloom-wordmark-plain-cream.svg" alt="" width="2044" height="374" />
    </span>
    {state === 'unavailable' && <span className="sr-only">Workshop artwork is unavailable. All page content remains available below.</span>}
  </div>;
}

export default function HomepageBanner() {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 640px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 640px)');
    const update = () => setNarrow(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return <BannerImage key={narrow ? 'mobile' : 'wide'} source={narrow ? '/banner/hero.jpg' : '/banner/labs.jpg'}
    fallback={narrow ? '/banner/labs.jpg' : '/banner/hero.jpg'} alt="Hanna and robot helpers in a sunlit forest workshop, surrounded by connected labs." />;
}

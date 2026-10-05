import { useEffect, useRef, useState } from 'react';
import { watchBannerImage } from './banner-loading';
import './homepage-banner.css';

type Artwork = { src: string; width: number; height: number };
const circuit: Artwork = { src: "/banner/lab-circuit-hero.png", width: 1672, height: 941 };
const nativeFrame: Artwork = { src: "/banner/lab-hero-source-1920.png", width: 1920, height: 1080 };

/** Public preview artwork only; diagnostic routes must never supply the homepage. */
function BannerImage({ source, fallback, alt }: { source: Artwork; fallback: Artwork; alt: string }) {
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
    {state !== 'unavailable' && <img key={selected.src} ref={image} src={selected.src} alt={alt} loading="eager" decoding="async" fetchPriority="high" width={selected.width} height={selected.height} />}
    {state === 'unavailable' && <span className="sr-only">Workshop artwork is unavailable. All page content remains available below.</span>}
  </div>;
}

export default function HomepageBanner() {
  return <BannerImage source={circuit} fallback={nativeFrame}
    alt="Hanna and robot helpers in a sunlit forest workshop, surrounded by connected labs." />;
}

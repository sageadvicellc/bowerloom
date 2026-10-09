import { useState, type ReactNode } from 'react';

/** Same registered pose on either side of the footer edge; no anatomical transforms. */
export default function FooterCompanion({ children }: { children: ReactNode }) {
  const [available, setAvailable] = useState(true);
  const illustration = (layer: 'back' | 'front') => available && <img
    className={`footer-companion-art footer-companion-${layer}`}
    src="/panel-units/s4-g3-footer-wave.png" width="1024" height="1536"
    alt="" aria-hidden="true" draggable={false} loading="lazy" decoding="async"
    onError={() => setAvailable(false)} />;
  return <div className="footer-companion">
    {illustration('back')}
    {children}
    {illustration('front')}
  </div>;
}

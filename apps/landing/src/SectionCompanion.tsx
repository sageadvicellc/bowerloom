import { useId, useState, type CSSProperties, type ReactNode } from 'react';

/** Identical aligned layers let the panel occlude approved artwork without redrawing it. */
export default function SectionCompanion({ unit, side, children }: { unit: 's4' | 'h4n' | 's4-slate'; side: 'left' | 'right'; children: ReactNode }) {
  const gripId = `companion-grip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [available, setAvailable] = useState(true);
  const artwork = unit === 's4-slate'
    ? { source: '/panel-units/s4-slate-present.png', width: 1148, height: 1370 }
    : { source: unit === 's4' ? '/panel-units/s4-rose-peek.webp' : '/panel-units/h4n-ochre-wave.webp', width: 640, height: unit === 's4' ? 960 : 530 };
  const { source } = artwork;
  const illustration = (layer: 'back' | 'front') => available && <img className={`companion-robot companion-robot-${layer}`} src={source}
    alt="" aria-hidden="true" draggable={false} loading="lazy" decoding="async" width={artwork.width} height={artwork.height}
    onError={() => setAvailable(false)} />;
  const vine = (layer: 'back' | 'front') => <svg className={`companion-vine companion-vine-${layer}`} viewBox="0 0 240 160" focusable="false" aria-hidden="true">
    <path className="vine-stem" d="M14 153C8 121 38 112 26 84S15 42 51 44S105 14 127 36S171 63 190 29S223 6 232 16" />
    <path className="vine-leaf" d="M26 109C7 102 2 88 9 83C24 84 31 94 26 109ZM28 65C45 58 51 43 45 39C32 39 25 52 28 65ZM96 31C87 12 69 8 66 14C66 27 79 34 96 31ZM166 47C177 60 193 55 192 47C185 38 172 38 166 47ZM212 13C208 0 218 0 225 2L225 11Z" />
  </svg>;
  return <div className={`companion-panel-wrap companion-${unit} companion-${side}`} data-panel-depth="layered" style={{ '--companion-grip': `url(#${gripId})` } as CSSProperties}>
    {unit !== 'h4n' && <svg className="companion-mask-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs><clipPath id={gripId} clipPathUnits="objectBoundingBox">
        {unit === 's4' ? <><polygon points=".30,.37 .36,.355 .435,.37 .46,.414 .42,.495 .33,.495 .305,.45" />
        <polygon points=".61,.325 .69,.32 .76,.35 .79,.405 .80,.49 .73,.49 .64,.42" /></> : <>
          {/* Only the bent forearm and presenting arm cross the rim; the solid chest stays behind it. */}
          <path d="M .02 .36 L .17 .345 L .29 .405 L .33 .50 L .29 .56 L .22 .545 L .20 .485 L .06 .465 Z" />
          <path d="M .635 .455 L .72 .42 L .83 .375 L .885 .35 L 1 .375 L 1 .55 L .68 .565 Z" />
        </>}
      </clipPath></defs>
    </svg>}
    <div className="companion-decoration companion-behind" aria-hidden="true">{illustration('back')}{vine('back')}</div>
    <div className="companion-surface">{children}</div>
    <div className="companion-decoration companion-ahead" aria-hidden="true">{illustration('front')}{vine('front')}</div>
  </div>;
}

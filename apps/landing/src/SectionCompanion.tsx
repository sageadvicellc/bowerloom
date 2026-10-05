/** Existing approved pose derivatives, shown intact in their own document-flow space. */
export default function SectionCompanion({ unit, side }: { unit: 's4' | 'h4n'; side: 'left' | 'right' }) {
  return <div className={`section-companion companion-${unit} companion-${side}`} aria-hidden="true">
    <svg className="companion-vine" viewBox="0 0 280 110" focusable="false" aria-hidden="true">
      <path className="vine-stem" d="M6 99C50 100 35 59 78 66S134 109 163 69S221 23 274 29" />
      <path className="vine-leaf" d="M61 67C47 48 29 47 28 53C30 68 46 75 61 67ZM124 87C130 68 115 56 109 61C106 73 113 82 124 87ZM187 46C188 22 205 15 209 21C211 34 198 45 187 46ZM238 27C246 42 262 42 266 35C259 25 249 23 238 27Z" />
    </svg>
    <img src={unit === 's4' ? '/panel-units/s4-rose-peek.webp' : '/panel-units/h4n-ochre-wave.webp'}
      alt="" aria-hidden="true" draggable={false} loading="lazy" decoding="async" width="640" height={unit === 's4' ? 960 : 530}
      onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />
  </div>;
}

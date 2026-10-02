import { stages } from "./content";

export default function StaticWorkshop({ selected }: { selected: number }) {
  return (
    <svg
      className="static-workshop"
      viewBox="0 0 800 620"
      role="img"
      aria-label="Workflow steps: completed experiment, committed evidence, blog draft, and approval for a GitHub draft pull request."
    >
      <defs>
        <radialGradient id="sun">
          <stop stopColor="#C9F53A" stopOpacity=".22" />
          <stop offset="1" stopColor="#C9F53A" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="island" x2="0" y2="1">
          <stop stopColor="#354038" />
          <stop offset="1" stopColor="#101c20" />
        </linearGradient>
      </defs>
      <circle cx="445" cy="230" r="225" fill="url(#sun)" />
      <g fill="none" stroke="#C9F53A">
        <ellipse cx="440" cy="130" rx="70" ry="24" strokeWidth="2" />
        <path d="M439 107v48M418 109l42 42m-42 0 42-42" opacity=".6" />
      </g>
      <path
        d="M164 350Q240 230 310 263T470 289T640 380"
        fill="none"
        stroke="#C9F53A"
        strokeWidth="3"
        strokeDasharray="5 6"
        opacity=".7"
      />
      {[
        [164, 350],
        [310, 263],
        [470, 289],
        [640, 380],
      ].map(([x, y], i) => (
        <g key={i} transform={`translate(${x},${y})`}>
          <path
            d="M-79 0 0-35 79 0 55 53 0 73-55 53Z"
            fill="url(#island)"
            stroke="#3a493f"
          />
          <ellipse
            rx="78"
            ry="34"
            fill="#1e3028"
            stroke={selected === i ? stages[i].color : "#5c6955"}
            strokeWidth={selected === i ? 3 : 1}
          />
          <path
            d="M-36-3v-28l35-18 38 19v29L0 17Z"
            fill="#182829"
            stroke={stages[i].color}
          />
          <path
            d="M-36-31 0-14 37-30M0-14v31"
            stroke={stages[i].color}
            fill="none"
          />
          <circle cy="-67" r="10" fill={stages[i].color} />
          <text
            y="104"
            textAnchor="middle"
            fill="#DDE3EE"
            fontSize="14"
            fontFamily="monospace"
          >
            {stages[i].name}
          </text>
        </g>
      ))}
      <g stroke="#314b3a" fill="#182c20">
        <path d="M100 244v103m-20-68 20-33 25 35Z" />
        <path d="M577 162v132m-32-66 32-63 32 63Z" />
        <path d="M704 265v94m-24-51 24-47 24 47Z" />
      </g>
    </svg>
  );
}

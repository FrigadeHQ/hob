/** The hob: the flame-spirit from the app icon, on its own. alive: floats, breathes, flickers and blinks. */
export function Mascot({ size = 96, alive = false }: { size?: number; alive?: boolean }) {
  return (
    <svg data-testid="mascot" width={size} height={size * 1.2} viewBox="290 200 444 560" role="img" aria-label="Hob" className={alive ? 'hob-alive' : undefined}>
      <defs>
        <linearGradient id="hob-flame" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#FF9445" />
          <stop offset="0.55" stopColor="#EE5A1E" />
          <stop offset="1" stopColor="#C2410C" />
        </linearGradient>
        <radialGradient id="hob-glow" cx="0.5" cy="0.62" r="0.5">
          <stop offset="0" stopColor="#FFB070" stopOpacity="0.45" />
          <stop offset="1" stopColor="#FFB070" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse className="hob-glow" cx="512" cy="560" rx="230" ry="210" fill="url(#hob-glow)" />
      <g className="hob-body">
        <path
          className="hob-flame"
          d="M512 232 C 554 312 654 356 694 458 C 736 566 670 736 512 740 C 354 736 288 566 330 458 C 358 386 422 356 458 310 C 466 350 484 372 506 380 C 496 328 490 280 512 232 Z"
          fill="url(#hob-flame)"
        />
        <g className="hob-eyes">
          <ellipse cx="458" cy="574" rx="24" ry="32" fill="#2B1608" />
          <ellipse cx="566" cy="574" rx="24" ry="32" fill="#2B1608" />
          <circle cx="465" cy="563" r="8" fill="#FFFFFF" />
          <circle cx="573" cy="563" r="8" fill="#FFFFFF" />
        </g>
        <ellipse cx="424" cy="628" rx="20" ry="11" fill="#FFD2B8" opacity="0.8" />
        <ellipse cx="600" cy="628" rx="20" ry="11" fill="#FFD2B8" opacity="0.8" />
      </g>
    </svg>
  )
}

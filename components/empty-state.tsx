/**
 * The picture shown where a list has nothing in it yet (journal, notes,
 * library, groups). `label` is what screen readers announce instead.
 */
export function EmptyState({ label, className = "py-20" }: { label: string; className?: string }) {
  return (
    <div className={`flex justify-center ${className}`}>
      <svg role="img" aria-label={label} viewBox="0 0 160 128" className="h-28 w-36" fill="none">
        <title>{label}</title>
        {/* a sheet behind */}
        <rect x="40" y="18" width="70" height="92" rx="8" transform="rotate(-8 75 64)" className="fill-accent-soft stroke-rule" strokeWidth="2" />
        {/* the page */}
        <rect x="48" y="14" width="70" height="92" rx="8" className="fill-surface stroke-rule" strokeWidth="2" />
        <g className="stroke-rule" strokeWidth="4" strokeLinecap="round">
          <path d="M62 38h42M62 52h42M62 66h28" />
        </g>
        {/* the pencil */}
        <g transform="rotate(38 118 86)">
          <rect x="112" y="52" width="12" height="44" rx="2" className="fill-accent" />
          <path d="M112 96h12l-6 12z" className="fill-paper stroke-accent" strokeWidth="2" strokeLinejoin="round" />
          <rect x="112" y="48" width="12" height="6" rx="2" className="fill-ink" opacity="0.25" />
        </g>
      </svg>
    </div>
  );
}

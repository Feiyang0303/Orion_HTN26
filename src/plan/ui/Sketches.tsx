/* Hand-drawn landmarks, in code.
 *
 * Every illustration is line work on a 120-unit square, drawn with one nib,
 * and every stroke carries pathLength=1 so the page can draw it in with a
 * single dash animation. The hand comes from two SVG filters: `ink` runs the
 * strokes through a little turbulence so no line is quite straight, and
 * `wash` does the same, harder, to the flat fills so they sit like watercolour
 * that bled a fraction past the pencil. Nothing is a photograph; nothing is
 * a glyph. Which sketch a place gets is read off its name, the same rule as
 * every other mark in the book.
 */

export type SketchName =
  | 'cathedral' | 'temple' | 'tower' | 'palace' | 'bridge' | 'park' | 'market' | 'arch'
  | 'fountain' | 'castle' | 'hill' | 'square' | 'theatre' | 'statue' | 'hotel' | 'cafe' | 'gallery' | 'lattice'

const RULES: [RegExp, SketchName][] = [
  [/eiffel|tokyo tower|sky ?tree|space needle|cn tower|lattice/i, 'lattice'],
  [/pagoda|temple|shrine|-ji\b|-dera\b|jinja|taisha|wat\b|stupa/i, 'temple'],
  [/cathedral|basilica|duomo|minster|abbey|church|chapel|sainte-chapelle|notre-dame|mosque|synagogue/i, 'cathedral'],
  [/tower|spire|obelisk|campanile|belfry|clock/i, 'tower'],
  [/museum|louvre|gallery|galerie|pinacoteca|kunsthalle|collection/i, 'gallery'],
  [/palace|palais|palazzo|parliament|opera|assembly|hôtel de ville|city hall|town hall|invalides|panthéon|pantheon/i, 'palace'],
  [/bridge|pont|ponte|brücke|viaduct/i, 'bridge'],
  [/park|garden|jardin|giardino|botanic|arboretum|meadow|woods?/i, 'park'],
  [/market|marché|mercado|bazaar|halles|souk|arcade/i, 'market'],
  [/arc\b|arch\b|gate\b|porta\b|porte\b|torii|brandenburg/i, 'arch'],
  [/fountain|fontana|fontaine|trevi|harbour|harbor|river|seine|canal|lake|bay|beach|quay/i, 'fountain'],
  [/castle|château|castello|fort|citadel|kremlin|alcázar|schloss/i, 'castle'],
  [/hill|mont\b|mount|montmartre|viewpoint|lookout|belvedere|summit|peak/i, 'hill'],
  [/square|plaza|piazza|place\b|platz|circus|champs|avenue|boulevard|street|rue\b/i, 'square'],
  [/theatre|theater|philharmon|concert|colosseum|colosseo|arena|stadium/i, 'theatre'],
  [/statue|memorial|monument|column|cenotaph|sculpture/i, 'statue'],
]
export function sketchFor(name: string, fallback: number = 0): SketchName {
  for (const [r, s] of RULES) if (r.test(name)) return s
  const spares: SketchName[] = ['palace', 'square', 'statue', 'gallery']
  return spares[fallback % spares.length]
}

/* The filters live once, in a hidden svg the page mounts. */
export function SketchDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <filter id="ink" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="3" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.8" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="wash" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" seed="3" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feGaussianBlur in="d" stdDeviation=".7" />
        </filter>
        <filter id="paper" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="11" result="g" />
          <feColorMatrix in="g" type="matrix" values="0 0 0 0 .42  0 0 0 0 .35  0 0 0 0 .25  0 0 0 .08 0" />
        </filter>
      </defs>
    </svg>
  )
}

const PEN = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

/* Each sketch: `wash` = soft colour underneath (no stroke), `ink` = the lines. */
const ART: Record<SketchName, { wash: React.ReactNode; ink: React.ReactNode }> = {
  cathedral: {
    wash: <><rect x="24" y="52" width="72" height="52" /><rect x="22" y="30" width="18" height="30" /><rect x="80" y="30" width="18" height="30" /></>,
    ink: <>
      <path d="M22 104 V44 L31 22 L40 44 V104" /><path d="M80 104 V44 L89 22 L98 44 V104" />
      <path d="M40 60 H80 V104 H40 Z" /><path d="M40 60 L60 44 L80 60" />
      <circle cx="60" cy="72" r="7" /><path d="M60 65 v14 M53 72 h14 M55 67 l10 10 M65 67 l-10 10" />
      <path d="M54 104 V90 a6 6 0 0 1 12 0 V104" /><path d="M28 50 v8 M34 50 v8 M86 50 v8 M92 50 v8" />
      <path d="M31 22 V14 M28 17 h6" /><path d="M89 22 V14 M86 17 h6" /><path d="M14 104 H106" />
    </>,
  },
  temple: {
    wash: <><path d="M20 60 L60 40 L100 60 Z" /><path d="M28 82 L60 66 L92 82 Z" /><rect x="40" y="82" width="40" height="22" /></>,
    ink: <>
      <path d="M60 14 V22" /><path d="M14 46 C30 40 40 30 60 24 C80 30 90 40 106 46 C90 44 76 46 60 46 C44 46 30 44 14 46 Z" />
      <path d="M22 70 C36 64 46 56 60 52 C74 56 84 64 98 70 C84 68 72 70 60 70 C48 70 36 68 22 70 Z" />
      <path d="M30 92 C40 86 50 80 60 76 C70 80 80 86 90 92 C80 90 70 92 60 92 C50 92 40 90 30 92 Z" />
      <path d="M46 46 V52 M74 46 V52 M46 70 V76 M74 70 V76" /><path d="M42 92 V104 H78 V92" /><path d="M56 104 V96 H64 V104" /><path d="M18 104 H102" />
    </>,
  },
  tower: {
    wash: <path d="M48 104 L52 20 H68 L72 104 Z" />,
    ink: <>
      <path d="M46 104 L52 22 H68 L74 104" /><path d="M52 22 L60 10 L68 22" /><path d="M60 10 V4" />
      <path d="M50 44 H70 M48 66 H72 M47 86 H73" /><path d="M56 34 h8 M56 56 h8 M55 78 h10" />
      <path d="M57 104 V94 a3 3 0 0 1 6 0 V104" /><path d="M30 104 H90" />
    </>,
  },
  lattice: {
    wash: <path d="M40 104 L54 18 H66 L80 104 Z" />,
    ink: <>
      <path d="M36 104 C46 70 52 46 56 18 H64 C68 46 74 70 84 104" /><path d="M58 18 L60 6 L62 18" />
      <path d="M42 84 H78 M46 62 H74 M50 42 H70" /><path d="M44 84 L60 62 L76 84 M48 62 L60 42 L72 62 M52 42 L60 26 L68 42" />
      <path d="M46 104 C52 92 68 92 74 104" /><path d="M22 104 H98" />
    </>,
  },
  palace: {
    wash: <><rect x="18" y="56" width="84" height="46" /><path d="M14 56 L60 30 L106 56 Z" /></>,
    ink: <>
      <path d="M12 56 L60 28 L108 56 Z" /><path d="M18 56 V98 M30 60 V98 M42 60 V98 M54 60 V98 M66 60 V98 M78 60 V98 M90 60 V98 M102 56 V98" />
      <path d="M14 98 H106 M10 104 H110" /><path d="M52 44 a8 8 0 0 1 16 0" /><path d="M60 18 V28" />
    </>,
  },
  gallery: {
    wash: <><rect x="16" y="50" width="88" height="50" /><path d="M32 50 L60 28 L88 50 Z" /></>,
    ink: <>
      <path d="M16 100 V50 H104 V100" /><path d="M30 50 L60 26 L90 50" /><path d="M24 58 V96 M40 58 V96 M56 58 V96 M72 58 V96 M88 58 V96 M96 58 V96" />
      <path d="M12 100 H108 M8 106 H112" /><path d="M48 76 h24 v20 h-24 z" /><path d="M54 40 h12" />
    </>,
  },
  bridge: {
    wash: <><rect x="10" y="60" width="100" height="10" /><path d="M6 92 C30 84 60 100 114 90 V110 H6 Z" /></>,
    ink: <>
      <path d="M6 62 H114 M6 70 H114" /><path d="M10 70 C14 84 30 84 34 70 M36 70 C40 88 60 88 64 70 M66 70 C70 84 86 84 90 70 M92 70 C96 84 108 84 112 70" />
      <path d="M16 62 V54 M32 62 V54 M48 62 V54 M64 62 V54 M80 62 V54 M96 62 V54 M8 54 H112" />
      <path d="M8 96 c6-4 12-4 18 0 s12 4 18 0 12-4 18 0 12 4 18 0 12-4 18 0" /><path d="M10 104 c6-4 12-4 18 0 s12 4 18 0 12-4 18 0" />
    </>,
  },
  park: {
    wash: <><circle cx="36" cy="54" r="18" /><circle cx="76" cy="46" r="22" /><path d="M6 100 Q60 88 114 100 V110 H6 Z" /></>,
    ink: <>
      <path d="M36 74 V96 M76 70 V96" /><path d="M20 58 C16 42 30 34 38 38 C46 30 60 40 54 54 C60 66 44 76 36 70 C28 76 14 68 20 58 Z" />
      <path d="M56 48 C52 28 72 20 80 26 C90 18 104 32 96 44 C104 58 86 68 78 62 C66 70 50 60 56 48 Z" />
      <path d="M8 100 Q60 90 112 100" /><path d="M40 92 h30 M42 92 v8 M68 92 v8 M40 86 h30" />
    </>,
  },
  market: {
    wash: <><path d="M14 44 L60 30 L106 44 V58 H14 Z" /><rect x="22" y="58" width="76" height="40" /></>,
    ink: <>
      <path d="M12 46 L60 28 L108 46" /><path d="M14 46 C18 56 26 56 30 46 C34 56 42 56 46 46 C50 56 58 56 62 46 C66 56 74 56 78 46 C82 56 90 56 94 46 C98 56 104 56 108 46" />
      <path d="M22 56 V100 M98 56 V100" /><path d="M24 78 H96 M24 100 H96" /><path d="M30 78 V70 h14 v8 M50 78 V66 h18 v12 M74 78 V72 h14 v6" />
      <path d="M34 90 h6 M46 90 h6 M60 90 h6 M74 90 h6" />
    </>,
  },
  arch: {
    wash: <><rect x="22" y="30" width="76" height="72" /><path d="M42 102 V70 a18 18 0 0 1 36 0 V102 Z" fill="#fff" /></>,
    ink: <>
      <path d="M20 102 V32 H100 V102" /><path d="M42 102 V70 a18 18 0 0 1 36 0 V102" /><path d="M20 44 H100" />
      <path d="M28 52 h8 v14 h-8 z M84 52 h8 v14 h-8 z" /><path d="M26 32 V24 H94 V32" /><path d="M14 102 H106" />
    </>,
  },
  fountain: {
    wash: <><ellipse cx="60" cy="90" rx="46" ry="12" /><ellipse cx="60" cy="60" rx="22" ry="6" /></>,
    ink: <>
      <path d="M14 90 a46 12 0 0 0 92 0 a46 12 0 0 0 -92 0" /><path d="M38 60 a22 6 0 0 0 44 0 a22 6 0 0 0 -44 0" />
      <path d="M56 60 V40 H64 V60" /><path d="M60 40 V30" />
      <path d="M60 30 C50 26 44 34 46 42 M60 30 C70 26 76 34 74 42 M60 28 V18" />
      <path d="M52 34 c-6 8 -10 12 -14 22 M68 34 c6 8 10 12 14 22" /><path d="M40 78 c4-4 8-4 12 0 M68 78 c4-4 8-4 12 0" />
    </>,
  },
  castle: {
    wash: <><rect x="22" y="50" width="76" height="52" /><rect x="14" y="36" width="20" height="66" /><rect x="86" y="36" width="20" height="66" /></>,
    ink: <>
      <path d="M14 102 V38 H34 V102" /><path d="M86 102 V38 H106 V102" /><path d="M34 54 H86 V102 H34" />
      <path d="M14 38 V30 H20 V36 H28 V30 H34 M86 38 V30 H92 V36 H100 V30 H106" /><path d="M34 54 V48 H42 V54 M46 54 V48 H54 V54 M66 54 V48 H74 V54 M78 54 V48 H86 V54" />
      <path d="M52 102 V80 a8 8 0 0 1 16 0 V102" /><path d="M20 50 h6 v8 h-6 z M94 50 h6 v8 h-6 z" /><path d="M24 30 L24 20 L32 24 L24 28" /><path d="M8 102 H112" />
    </>,
  },
  hill: {
    wash: <><path d="M4 100 C30 60 50 50 72 66 C88 52 104 70 116 100 Z" /><circle cx="92" cy="34" r="12" /></>,
    ink: <>
      <path d="M4 100 C30 60 50 50 72 66 C88 52 104 70 116 100" /><circle cx="92" cy="34" r="10" />
      <path d="M92 18 V12 M92 56 V50 M76 34 H70 M114 34 H108 M80 22 l-4-4 M104 46 l4 4 M104 22 l4-4 M80 46 l-4 4" />
      <path d="M40 84 v-10 M36 76 c4-6 8-6 12 0 M62 88 v-8 M58 82 c4-6 8-6 12 0" /><path d="M4 100 H116" />
    </>,
  },
  square: {
    wash: <><rect x="52" y="30" width="16" height="60" /><path d="M8 100 L112 100 L100 80 L20 80 Z" /></>,
    ink: <>
      <path d="M52 92 V32 L60 16 L68 32 V92" /><path d="M44 92 H76 V100 H44 Z" /><path d="M8 100 H112" />
      <path d="M22 100 V72 M20 72 h4 M20 68 a2 2 0 0 1 4 0 v4 h-4 z" /><path d="M98 100 V72 M96 72 h4 M96 68 a2 2 0 0 1 4 0 v4 h-4 z" />
      <path d="M30 88 h14 M76 88 h14" />
    </>,
  },
  theatre: {
    wash: <><path d="M14 100 V60 C14 34 106 34 106 60 V100 Z" /><path d="M30 60 a30 30 0 0 1 60 0 Z" /></>,
    ink: <>
      <path d="M12 100 V62 C12 36 108 36 108 62 V100" /><path d="M30 62 a30 24 0 0 1 60 0" />
      <path d="M22 100 V72 M36 100 V70 M50 100 V68 M64 100 V68 M78 100 V70 M92 100 V72" /><path d="M8 100 H112" />
      <path d="M52 48 c2 4 6 4 8 0 c2 4 6 4 8 0" /><path d="M60 36 V28" />
    </>,
  },
  statue: {
    wash: <><rect x="40" y="72" width="40" height="30" /><circle cx="60" cy="34" r="8" /></>,
    ink: <>
      <circle cx="60" cy="32" r="8" /><path d="M60 40 V62" /><path d="M50 48 L60 44 L72 40" /><path d="M54 62 L50 72 M66 62 L70 72" />
      <path d="M38 72 H82 V80 H38 Z" /><path d="M42 80 V100 H78 V80" /><path d="M30 100 H90" /><path d="M72 40 L78 30" />
    </>,
  },
  hotel: {
    wash: <><rect x="20" y="40" width="80" height="62" /><path d="M14 40 L60 24 L106 40 Z" /></>,
    ink: <>
      <path d="M20 102 V42 H100 V102" /><path d="M14 42 L60 22 L106 42" />
      <path d="M30 52 h12 v12 h-12 z M54 52 h12 v12 h-12 z M78 52 h12 v12 h-12 z M30 72 h12 v12 h-12 z M78 72 h12 v12 h-12 z" />
      <path d="M52 102 V78 H68 V102" /><path d="M46 76 C52 70 68 70 74 76" /><path d="M12 102 H108" />
    </>,
  },
  cafe: {
    wash: <><path d="M28 60 H84 V80 a24 20 0 0 1 -56 0 Z" /><path d="M14 100 a46 6 0 0 0 92 0 Z" /></>,
    ink: <>
      <path d="M28 60 H84 V80 a28 22 0 0 1 -56 0 Z" /><path d="M84 66 a10 8 0 0 1 0 18" /><path d="M12 100 H108" />
      <path d="M44 50 c-4-6 4-8 0-14 M56 50 c-4-6 4-8 0-14 M68 50 c-4-6 4-8 0-14" /><path d="M40 100 a20 5 0 0 0 40 0" />
    </>,
  },
}

/** One illustration. `wash` is the watercolour colour; `ink` the line colour. */
export function Sketch({ name, size = 96, wash = '#c9a27a', ink = '#3f3020', className = '', delay = 0 }: {
  name: SketchName; size?: number; wash?: string; ink?: string; className?: string; delay?: number
}) {
  const art = ART[name]
  return (
    <svg className={`sk ${className}`} viewBox="0 0 120 120" width={size} height={size} aria-hidden
      style={{ ['--d' as string]: `${delay}ms` }}>
      <g className="sk-wash" fill={wash} filter="url(#wash)" opacity=".42">{art.wash}</g>
      <g className="sk-ink" {...PEN} color={ink} filter="url(#ink)">
        {art.ink}
      </g>
    </svg>
  )
}

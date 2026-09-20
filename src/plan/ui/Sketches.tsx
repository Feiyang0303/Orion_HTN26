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
  | 'fountain' | 'castle' | 'hill' | 'square' | 'theatre' | 'statue' | 'hotel' | 'cafe' | 'gallery' | 'lattice' | 'needle'

const RULES: [RegExp, SketchName][] = [
  [/cn tower|space needle|sky ?tree|skytree|fernsehturm|tv tower|oriental pearl|sky tower|kl tower|macau tower|calgary tower|stratosphere/i, 'needle'],
  [/eiffel|tokyo tower|lattice/i, 'lattice'],
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

/* The one thing a city is drawn as, for a cover. Not the same question as
 * `sketchFor`, which is about a place's own name: nothing in the word "Tokyo"
 * says tower, and nothing in "Rome" says colosseum. This is the shape a person
 * pictures when the city is named, so it has to be looked up rather than
 * matched. An unlisted city falls through to whatever its name suggests, and
 * then to the spares, so every cover gets something. */
/* Cities with more than one thing they are known by. The first is the cover's
   large drawing; the rest are drawn smaller, and which one a cover gets is
   chosen by the trip so two Toronto covers differ. Anything not listed here
   falls through to the single mark below. */
const CITY_SET: [RegExp, SketchName[]][] = [
  [/^tokyo/i, ['lattice', 'temple', 'arch']],
  [/^toronto/i, ['needle', 'castle', 'gallery']],
  [/^kyoto/i, ['temple', 'arch', 'castle']],
  [/^paris\b/i, ['lattice', 'cathedral', 'arch']],
  [/^london/i, ['tower', 'bridge', 'palace']],
  [/^new york/i, ['statue', 'bridge', 'tower']],
  [/^rome|^roma\b/i, ['theatre', 'fountain', 'cathedral']],
  [/^barcelona/i, ['cathedral', 'park', 'fountain']],
  [/^amsterdam/i, ['bridge', 'gallery', 'market']],
  [/^venice|^venezia/i, ['bridge', 'cathedral', 'square']],
  [/^istanbul/i, ['cathedral', 'market', 'bridge']],
  [/^sydney/i, ['theatre', 'bridge', 'fountain']],
  [/^san francisco/i, ['bridge', 'hill', 'square']],
  [/^berlin/i, ['arch', 'needle', 'gallery']],
  [/^seattle/i, ['needle', 'market', 'fountain']],
  [/^shanghai/i, ['needle', 'temple', 'bridge']],
  [/^athens/i, ['temple', 'hill', 'theatre']],
  [/^seoul/i, ['palace', 'needle', 'market']],
  [/^prague|^praha/i, ['bridge', 'castle', 'square']],
  [/^edinburgh/i, ['castle', 'hill', 'square']],
  [/^vienna|^wien\b/i, ['palace', 'theatre', 'cathedral']],
  [/^lisbon|^lisboa/i, ['hill', 'castle', 'square']],
  [/^bangkok/i, ['temple', 'palace', 'market']],
  [/^osaka/i, ['castle', 'market', 'needle']],
  [/^dubai/i, ['lattice', 'needle', 'market']],
  [/^singapore/i, ['park', 'needle', 'fountain']],
  [/^chicago/i, ['fountain', 'tower', 'bridge']],
  [/^florence|^firenze/i, ['cathedral', 'bridge', 'gallery']],
  [/^budapest/i, ['bridge', 'palace', 'cathedral']],
  [/^bruges|^brugge/i, ['bridge', 'tower', 'market']],
  [/^copenhagen/i, ['statue', 'castle', 'park']],
  [/^marrakech|^marrakesh/i, ['market', 'arch', 'palace']],
  [/^vancouver/i, ['park', 'bridge', 'hill']],
  [/^montreal|^montréal/i, ['cathedral', 'hill', 'market']],
  [/^washington/i, ['tower', 'palace', 'statue']],
  [/^hong kong/i, ['tower', 'hill', 'market']],
]
export function citySet(city: string, fallback = 0): SketchName[] {
  const name = city.split(',')[0].trim()
  for (const [r, set] of CITY_SET) if (r.test(name)) return set
  return [cityMark(city, fallback)]
}

const CITY_MARK: [RegExp, SketchName][] = [
  [/^tokyo|^paris\b|^toronto|^seattle|^shanghai|^dubai|^kuala/i, 'lattice'],
  [/^kyoto|^nara\b|^athens|^bangkok|^beijing|^chiang|^luang/i, 'temple'],
  [/^rome|^roma\b|^verona|^sydney/i, 'theatre'],
  [/^london|^washington|^pisa\b|^bologna|^hong kong|^taipei/i, 'tower'],
  [/^new york|^rio\b|^copenhagen|^buenos/i, 'statue'],
  [/^barcelona|^florence|^firenze|^milan|^cologne|^köln|^istanbul|^seville|^helsinki|^reykjav/i, 'cathedral'],
  [/^venice|^venezia|^amsterdam|^budapest|^prague|^praha|^dublin|^san francisco|^bruges|^brugge|^porto/i, 'bridge'],
  [/^edinburgh|^moscow|^osaka|^himeji|^salzburg|^heidelberg|^windsor/i, 'castle'],
  [/^vienna|^wien\b|^madrid|^seoul|^st\.? petersburg|^versailles|^stockholm|^bangkok/i, 'palace'],
  [/^berlin|^munich|^münchen|^delhi|^agra\b|^mumbai/i, 'arch'],
  [/^lisbon|^lisboa|^cape town|^naples|^napoli|^bergen|^wellington/i, 'hill'],
  [/^marrakech|^marrakesh|^fez|^fès|^jerusalem|^hanoi|^tunis/i, 'market'],
  [/^brussels|^bruxelles|^krak|^warsaw|^boston|^philadelphia|^siena/i, 'square'],
  [/^vancouver|^singapore|^portland|^christchurch|^ottawa/i, 'park'],
  [/^geneva|^zurich|^zürich|^chicago|^dubrovnik|^nice\b|^split\b/i, 'fountain'],
]
export function cityMark(city: string, fallback = 0): SketchName {
  const name = city.split(',')[0].trim()
  for (const [r, s] of CITY_MARK) if (r.test(name)) return s
  return sketchFor(name, fallback)
}

/* The filters live once, in a hidden svg the page mounts. */
export function SketchDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        {/* the nib: every line runs through a little turbulence */}
        <filter id="ink" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="3" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.8" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        {/* the pencil: rougher, fainter, slightly off the ink */}
        <filter id="pencil" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency=".08" numOctaves="2" seed="21" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        {/* watercolour: the shape bleeds past its edge, the pigment gathers at
            the rim (a darker band where the shape ends), and the whole thing
            is a shade uneven, the way a wash dries */}
        <filter id="wash" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="fractalNoise" baseFrequency=".045" numOctaves="3" seed="3" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="11" xChannelSelector="R" yChannelSelector="G" result="bled" />
          <feGaussianBlur in="bled" stdDeviation=".8" result="soft" />
          <feMorphology in="soft" operator="erode" radius="2.2" result="inner" />
          <feComposite in="soft" in2="inner" operator="out" result="rim" />
          <feColorMatrix in="rim" type="matrix" values="0.65 0 0 0 0  0 0.65 0 0 0  0 0 0.65 0 0  0 0 0 .9 0" result="darkrim" />
          <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="1" seed="5" result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .35 0" result="grainA" />
          <feComposite in="soft" in2="grainA" operator="in" result="grainy" />
          <feMerge><feMergeNode in="soft" /><feMergeNode in="grainy" /><feMergeNode in="darkrim" /></feMerge>
        </filter>
        {/* the paper: fibre and a little foxing */}
        <filter id="paper" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="11" result="g" />
          <feColorMatrix in="g" type="matrix" values="0 0 0 0 .42  0 0 0 0 .35  0 0 0 0 .25  0 0 0 .1 0" />
        </filter>
        {/* the deckle: the sheet's own edge, torn by turbulence */}
        <filter id="deckle" x="-3%" y="-3%" width="106%" height="106%">
          <feTurbulence type="fractalNoise" baseFrequency=".02" numOctaves="4" seed="9" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="14" xChannelSelector="R" yChannelSelector="G" />
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
  needle: {
    wash: <><path d="M52 104 L57 40 H63 L68 104 Z" /><ellipse cx="60" cy="40" rx="18" ry="7" /></>,
    ink: <>
      <path d="M50 104 C54 84 56 62 57 44 M70 104 C66 84 64 62 63 44" />
      <path d="M42 40 a18 7 0 1 0 36 0 a18 7 0 1 0 -36 0" /><path d="M44 36 a16 5 0 0 1 32 0" /><path d="M46 44 C50 50 70 50 74 44" />
      <path d="M60 33 V8 M58 12 H62 M57 18 H63" /><path d="M30 104 H90" /><path d="M56 60 H64 M55 76 H65 M54 92 H66" />
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

/** One illustration. `wash` is the watercolour colour, `wash2` a second tone
    laid under it off-register, `ink` the line colour. The pencil layer is the
    same drawing, fainter and a little off, the way a sketch is inked over its
    own construction lines. */
export function Sketch({ name, size = 96, wash = '#c9a27a', wash2, ink = '#3f3020', className = '', delay = 0 }: {
  name: SketchName; size?: number; wash?: string; wash2?: string; ink?: string; className?: string; delay?: number
}) {
  const art = ART[name]
  return (
    <svg className={`sk ${className}`} viewBox="-6 -6 132 132" width={size} height={size} aria-hidden
      style={{ ['--d' as string]: `${delay}ms` }}>
      <g className="sk-wash sk-wash2" fill={wash2 ?? wash} filter="url(#wash)" opacity=".3" transform="translate(3 4) scale(1.04)">{art.wash}</g>
      <g className="sk-wash" fill={wash} filter="url(#wash)" opacity=".5">{art.wash}</g>
      <g className="sk-pencil" {...PEN} strokeWidth={1.1} color="#8a8078" opacity=".55" filter="url(#pencil)" transform="translate(-1.5 1)">
        {art.ink}
      </g>
      <g className="sk-ink" {...PEN} color={ink} filter="url(#ink)">
        {art.ink}
      </g>
    </svg>
  )
}

/* ---------------------------------------------------------------- the table */

export type FoodName = 'pizza' | 'pasta' | 'noodles' | 'dumplings' | 'sushi' | 'croissant' | 'coffee' | 'tapas' | 'sandwich' | 'curry' | 'plate' | 'wine'

/** What to draw for a table, from OpenStreetMap's cuisine tag. Nothing here
    claims the dish is famous; it is the kind of food the tag says they serve. */
export function foodFor(cuisine: string, kind: string): FoodName {
  const c = (cuisine || '').toLowerCase()
  if (/pizza/.test(c)) return 'pizza'
  if (/italian|pasta/.test(c)) return 'pasta'
  if (/ramen|noodle|udon|soba|pho|vietnam|thai|lamian/.test(c)) return 'noodles'
  if (/dumpling|dim.?sum|gyoza|chinese|cantonese|sichuan|taiwan/.test(c)) return 'dumplings'
  if (/sushi|japanese|sashimi/.test(c)) return 'sushi'
  if (/french|bakery|boulangerie|pastry|crêpe|crepe|brasserie/.test(c)) return 'croissant'
  if (/coffee|cafe|café|tea/.test(c) || kind === 'cafe') return 'coffee'
  if (/tapas|spanish|mezze|greek|meze/.test(c)) return 'tapas'
  if (/burger|sandwich|deli|kebab|fast/.test(c) || kind === 'fast_food') return 'sandwich'
  if (/indian|curry|nepal/.test(c)) return 'curry'
  if (/wine|bar|pub/.test(c) || kind === 'bar') return 'wine'
  return 'plate'
}

const FOOD: Record<FoodName, { wash: React.ReactNode; wash2?: React.ReactNode; ink: React.ReactNode }> = {
  pizza: {
    wash: <path d="M14 96 L60 14 L106 96 Z" />, wash2: <><circle cx="52" cy="60" r="7" /><circle cx="70" cy="76" r="7" /><circle cx="44" cy="82" r="6" /></>,
    ink: <><path d="M14 96 L60 14 L106 96 Z" /><path d="M20 90 C40 82 80 82 100 90" /><circle cx="52" cy="60" r="6" /><circle cx="70" cy="76" r="6" /><circle cx="44" cy="82" r="5" /><path d="M60 40 c4 4 4 10 0 14 M62 30 c2 6 8 6 10 2" /></>,
  },
  pasta: {
    wash: <ellipse cx="60" cy="78" rx="46" ry="16" />, wash2: <ellipse cx="60" cy="66" rx="28" ry="12" />,
    ink: <><path d="M14 78 a46 16 0 0 0 92 0 a46 16 0 0 0 -92 0" /><path d="M34 70 c6-10 14-10 20 0 s14 10 20 0 M30 66 c8-14 18-6 26-2 s16 6 26-4 M40 60 c6-8 12-4 18 0 s12 6 18-2" /><path d="M78 40 L92 22 M84 44 L98 28" /></>,
  },
  noodles: {
    wash: <path d="M18 60 H102 C102 92 84 104 60 104 C36 104 18 92 18 60 Z" />, wash2: <ellipse cx="60" cy="60" rx="40" ry="10" />,
    ink: <><path d="M18 60 H102 C102 92 84 104 60 104 C36 104 18 92 18 60 Z" /><path d="M20 60 a40 10 0 0 0 80 0" /><path d="M36 58 c6-8 12-8 18 0 s12 8 18 0 M44 52 c4-6 10-6 14 0" /><path d="M70 46 L96 14 M78 48 L104 20" /><path d="M46 36 c-3-6 3-8 0-14 M58 34 c-3-6 3-8 0-14" /></>,
  },
  dumplings: {
    wash: <><path d="M24 78 C24 60 40 50 60 50 C80 50 96 60 96 78 Z" /><path d="M18 90 a42 8 0 0 0 84 0 Z" /></>,
    ink: <><path d="M18 90 a42 8 0 0 0 84 0 a42 8 0 0 0 -84 0" /><path d="M24 78 C24 60 40 50 60 50 C80 50 96 60 96 78" /><path d="M30 72 c4-6 10-6 14 0 c4-6 10-6 14 0 c4-6 10-6 14 0 c4-6 10-6 14 0" /><path d="M52 40 c-3-6 3-8 0-14 M66 40 c-3-6 3-8 0-14" /></>,
  },
  sushi: {
    wash: <><rect x="20" y="62" width="34" height="22" rx="4" /><rect x="64" y="62" width="34" height="22" rx="4" /></>, wash2: <><path d="M20 62 C26 50 48 50 54 62" /><path d="M64 62 C70 50 92 50 98 62" /></>,
    ink: <><path d="M20 84 V66 C20 54 54 54 54 66 V84 Z" /><path d="M64 84 V66 C64 54 98 54 98 66 V84 Z" /><path d="M24 74 h26 M68 74 h26" /><path d="M14 96 H106" /><path d="M30 60 c6-6 12-6 18 0 M74 60 c6-6 12-6 18 0" /></>,
  },
  croissant: {
    wash: <path d="M16 70 C16 44 44 34 60 40 C76 34 104 44 104 70 C100 80 84 78 60 68 C36 78 20 80 16 70 Z" />,
    ink: <><path d="M16 70 C16 44 44 34 60 40 C76 34 104 44 104 70 C100 80 84 78 60 68 C36 78 20 80 16 70 Z" /><path d="M34 46 L40 68 M48 40 L52 66 M72 40 L68 66 M86 46 L80 68" /><path d="M14 92 H106" /></>,
  },
  coffee: {
    wash: <path d="M28 56 H84 V78 a28 22 0 0 1 -56 0 Z" />, wash2: <ellipse cx="60" cy="98" rx="40" ry="6" />,
    ink: <><path d="M28 56 H84 V78 a28 22 0 0 1 -56 0 Z" /><path d="M84 62 a10 8 0 0 1 0 18" /><path d="M20 98 a40 6 0 0 0 80 0" /><path d="M44 46 c-4-6 4-8 0-14 M56 46 c-4-6 4-8 0-14 M68 46 c-4-6 4-8 0-14" /></>,
  },
  tapas: {
    wash: <><ellipse cx="40" cy="74" rx="22" ry="9" /><ellipse cx="82" cy="70" rx="18" ry="8" /><circle cx="40" cy="66" r="8" /></>,
    ink: <><path d="M18 74 a22 9 0 0 0 44 0 a22 9 0 0 0 -44 0" /><path d="M64 70 a18 8 0 0 0 36 0 a18 8 0 0 0 -36 0" /><circle cx="40" cy="66" r="8" /><path d="M76 62 h12 v6 h-12 z M82 56 v6" /><path d="M14 92 H106" /></>,
  },
  sandwich: {
    wash: <><path d="M18 60 H102 L96 46 H24 Z" /><path d="M18 60 H102 V78 H18 Z" /></>,
    ink: <><path d="M24 46 H96 L102 60 H18 Z" /><path d="M18 60 H102 V80 H18 Z" /><path d="M20 66 c6 4 10 4 16 0 s10-4 16 0 10 4 16 0 10-4 16 0" /><path d="M60 40 V28" /><path d="M14 92 H106" /></>,
  },
  curry: {
    wash: <><path d="M14 66 H106 C106 90 86 100 60 100 C34 100 14 90 14 66 Z" /><ellipse cx="60" cy="66" rx="34" ry="8" /></>,
    ink: <><path d="M14 66 H106 C106 90 86 100 60 100 C34 100 14 90 14 66 Z" /><path d="M26 66 a34 8 0 0 0 68 0" /><path d="M40 62 c4-4 8-4 12 0 M64 62 c4-4 8-4 12 0" /><path d="M46 44 c-3-6 3-8 0-14 M60 42 c-3-6 3-8 0-14 M74 44 c-3-6 3-8 0-14" /></>,
  },
  plate: {
    wash: <><ellipse cx="60" cy="72" rx="44" ry="14" /><ellipse cx="60" cy="68" rx="24" ry="8" /></>,
    ink: <><path d="M16 72 a44 14 0 0 0 88 0 a44 14 0 0 0 -88 0" /><path d="M36 68 a24 8 0 0 0 48 0" /><path d="M14 40 v22 M18 40 v22 M22 40 v22 M18 62 V96 M100 40 c-6 6-6 16 0 22 V96" /></>,
  },
  wine: {
    wash: <><path d="M40 30 H80 C80 56 70 66 60 66 C50 66 40 56 40 30 Z" /><path d="M40 44 H80" /></>,
    ink: <><path d="M40 30 H80 C80 56 70 66 60 66 C50 66 40 56 40 30 Z" /><path d="M60 66 V90 M46 90 H74" /><path d="M44 44 H76" /></>,
  },
}

export function Food({ name, size = 110, wash = '#c9a27a', wash2, ink = '#3f3020' }: {
  name: FoodName; size?: number; wash?: string; wash2?: string; ink?: string
}) {
  const art = FOOD[name]
  return (
    <svg className="sk sk-food" viewBox="-6 -6 132 132" width={size} height={size} aria-hidden>
      {art.wash2 && <g className="sk-wash" fill={wash2 ?? wash} filter="url(#wash)" opacity=".5">{art.wash2}</g>}
      <g className="sk-wash" fill={wash} filter="url(#wash)" opacity=".5" transform="translate(2 3)">{art.wash}</g>
      <g className="sk-pencil" {...PEN} strokeWidth={1.1} color="#8a8078" opacity=".5" filter="url(#pencil)" transform="translate(-1.5 1)">{art.ink}</g>
      <g className="sk-ink" {...PEN} color={ink} filter="url(#ink)">{art.ink}</g>
    </svg>
  )
}

/* ------------------------------------------------------------ the transport */

/** Footprints, a bus, a bicycle, a car: the way between two places, drawn
    small on the path itself. */
export function TransportGlyph({ mode, size = 22, ink = '#5c4a33' }: { mode: 'walk' | 'cycle' | 'transit' | 'drive'; size?: number; ink?: string }) {
  const g = {
    walk: <><path d="M7 4 c-3 0 -4 3 -3 6 c1 2 3 2 4 0 c1-3 1-6-1-6 Z M6 12 c-2 0-2 2-1 3 c1 1 2 0 2-1 s0-2-1-2 Z" /><path d="M16 9 c3 0 4 3 3 6 c-1 2-3 2-4 0 c-1-3-1-6 1-6 Z M17 17 c2 0 2 2 1 3 c-1 1-2 0-2-1 s0-2 1-2 Z" /></>,
    transit: <><path d="M5 4 h14 v13 H5 Z" /><path d="M5 12 h14 M8 14.5 h.1 M16 14.5 h.1" /><path d="M7 17 l-1.5 3 M17 17 l1.5 3" /><path d="M9 7 h6" /></>,
    cycle: <><circle cx="6" cy="16" r="3.5" /><circle cx="18" cy="16" r="3.5" /><path d="M6 16 L10 8 h5 M10 8 L14 16 L18 16 M13 6 h3" /></>,
    drive: <><path d="M4 14 L6 9 h12 l2 5 M3 14 h18 v4 H3 Z M6 18 v1.5 M18 18 v1.5" /></>,
  }[mode]
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={ink} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" filter="url(#ink)" aria-hidden>{g}</svg>
  )
}

/* ------------------------------------------------------------- the stickers */

/* The small things that end up stuck on a postcard: a star, a flower, a heart,
 * a strip of tape. Drawn in the same hand as the landmarks — pencil under ink,
 * a wash behind — but simpler, because a sticker is a glance and not a study.
 * Each is on the same 120-unit square so it can be scaled like a sketch. */

export type StickerName =
  | 'star' | 'sparkle' | 'flower' | 'daisy' | 'heart' | 'sun' | 'cloud' | 'plane' | 'leaf'
  | 'tape' | 'ticket' | 'wave' | 'moon' | 'camera' | 'pin'

const STICKER: Record<StickerName, { wash: React.ReactNode; ink: React.ReactNode }> = {
  star: {
    wash: <path d="M60 14 L72 46 L106 48 L79 69 L88 103 L60 84 L32 103 L41 69 L14 48 L48 46 Z" />,
    ink: <path d="M60 16 L71 46 L104 48 L78 68 L87 101 L60 83 L33 101 L42 68 L16 48 L49 46 Z" />,
  },
  sparkle: {
    wash: <path d="M60 10 C64 44 76 56 110 60 C76 64 64 76 60 110 C56 76 44 64 10 60 C44 56 56 44 60 10 Z" />,
    ink: <><path d="M60 12 C64 44 76 56 108 60 C76 64 64 76 60 108 C56 76 44 64 12 60 C44 56 56 44 60 12 Z" /><path d="M92 20 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 Z" /></>,
  },
  flower: {
    wash: <><circle cx="60" cy="38" r="15" /><circle cx="82" cy="54" r="15" /><circle cx="74" cy="80" r="15" /><circle cx="46" cy="80" r="15" /><circle cx="38" cy="54" r="15" /></>,
    ink: <><circle cx="60" cy="38" r="14" /><circle cx="82" cy="54" r="14" /><circle cx="74" cy="80" r="14" /><circle cx="46" cy="80" r="14" /><circle cx="38" cy="54" r="14" /><circle cx="60" cy="60" r="9" /></>,
  },
  daisy: {
    wash: <circle cx="60" cy="60" r="34" />,
    ink: <>
      <circle cx="60" cy="60" r="10" />
      <path d="M60 50 C50 30 70 30 60 50 M70 54 C90 40 92 60 70 54 M70 66 C92 62 86 84 70 66 M60 70 C70 92 50 92 60 70 M50 66 C28 82 30 60 50 66 M50 54 C30 58 34 36 50 54" />
    </>,
  },
  heart: {
    wash: <path d="M60 100 C20 72 10 50 24 32 C36 18 54 24 60 38 C66 24 84 18 96 32 C110 50 100 72 60 100 Z" />,
    ink: <path d="M60 98 C22 72 12 50 25 33 C36 20 54 26 60 40 C66 26 84 20 95 33 C108 50 98 72 60 98 Z" />,
  },
  sun: {
    wash: <circle cx="60" cy="60" r="24" />,
    ink: <><circle cx="60" cy="60" r="22" /><path d="M60 14 V26 M60 94 V106 M14 60 H26 M94 60 H106 M27 27 L36 36 M84 84 L93 93 M93 27 L84 36 M36 84 L27 93" /></>,
  },
  cloud: {
    wash: <path d="M30 84 a16 16 0 0 1 4 -31 a22 22 0 0 1 42 -8 a18 18 0 0 1 14 39 Z" />,
    ink: <path d="M30 82 a16 16 0 0 1 4 -31 a22 22 0 0 1 42 -8 a18 18 0 0 1 14 39 H30" />,
  },
  plane: {
    wash: <path d="M14 66 L104 24 L74 96 L62 70 Z" />,
    ink: <><path d="M14 66 L104 24 L74 96 L62 70 Z" /><path d="M62 70 L104 24" /><path d="M20 90 C34 80 40 78 52 74" strokeDasharray="4 5" /></>,
  },
  leaf: {
    wash: <path d="M22 98 C22 46 58 22 100 22 C100 66 66 98 22 98 Z" />,
    ink: <><path d="M22 98 C22 46 58 22 100 22 C100 66 66 98 22 98 Z" /><path d="M24 96 C46 72 66 54 96 26" /><path d="M40 78 C52 76 58 70 60 62 M56 58 C66 58 72 54 76 46" /></>,
  },
  tape: {
    wash: <path d="M8 44 L112 36 L114 74 L10 82 Z" />,
    ink: <path d="M8 44 L112 36 M10 82 L114 74 M8 44 L10 82 M112 36 L114 74" strokeDasharray="3 4" />,
  },
  ticket: {
    wash: <path d="M14 34 H106 V54 a8 8 0 0 0 0 16 V86 H14 V70 a8 8 0 0 0 0 -16 Z" />,
    ink: <><path d="M14 34 H106 V54 a8 8 0 0 0 0 16 V86 H14 V70 a8 8 0 0 0 0 -16 Z" /><path d="M72 40 V80" strokeDasharray="4 4" /><path d="M26 52 H58 M26 62 H50 M26 72 H54" /></>,
  },
  wave: {
    wash: <path d="M10 70 C24 52 36 52 50 70 C64 88 76 88 90 70 C100 58 106 58 112 62 V96 H10 Z" />,
    ink: <><path d="M10 70 C24 52 36 52 50 70 C64 88 76 88 90 70 C100 58 106 58 112 62" /><path d="M10 88 C24 70 36 70 50 88 C64 106 76 106 90 88" /></>,
  },
  moon: {
    wash: <path d="M74 14 A46 46 0 1 0 106 76 A34 34 0 0 1 74 14 Z" />,
    ink: <><path d="M74 16 A46 46 0 1 0 104 76 A34 34 0 0 1 74 16 Z" /><path d="M28 30 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2 Z" /></>,
  },
  camera: {
    wash: <><rect x="14" y="38" width="92" height="60" rx="8" /><rect x="42" y="26" width="30" height="14" rx="4" /></>,
    ink: <><rect x="14" y="38" width="92" height="60" rx="8" /><path d="M42 38 V30 a4 4 0 0 1 4 -4 H66 a4 4 0 0 1 4 4 V38" /><circle cx="60" cy="68" r="17" /><circle cx="60" cy="68" r="9" /><path d="M86 50 H96" /></>,
  },
  pin: {
    wash: <path d="M60 110 C36 78 24 62 24 46 A36 36 0 0 1 96 46 C96 62 84 78 60 110 Z" />,
    ink: <><path d="M60 108 C36 78 24 62 24 46 A36 36 0 0 1 96 46 C96 62 84 78 60 108 Z" /><circle cx="60" cy="46" r="13" /></>,
  },
}

export function Sticker({ name, size = 30, wash = '#c9a27a', ink = '#3f3020', className = '', style }: {
  name: StickerName; size?: number; wash?: string; ink?: string; className?: string; style?: React.CSSProperties
}) {
  const art = STICKER[name]
  return (
    <svg className={`st ${className}`} viewBox="-6 -6 132 132" width={size} height={size} aria-hidden style={style}>
      <g className="st-wash" fill={wash} filter="url(#wash)" opacity=".55">{art.wash}</g>
      <g className="st-pencil" {...PEN} strokeWidth={1.3} color="#8a8078" opacity=".5" filter="url(#pencil)" transform="translate(-1 1)">{art.ink}</g>
      <g className="st-ink" {...PEN} strokeWidth={1.9} color={ink} filter="url(#ink)">{art.ink}</g>
    </svg>
  )
}

/* ------------------------------------------------- what goes on one cover */

/* A cover is dressed by a small generator seeded by the trip, so every cover
 * is different and the same cover is the same every time it is opened. It
 * chooses the city's large landmark, one of its smaller ones, and three or
 * four stickers, each placed in one of a few spots the writing does not use,
 * with its own tilt, size and tint. Nothing here is random at render time:
 * the seed is the trip's id, and the id does not change. */

export type CoverPiece =
  | { kind: 'mark'; name: SketchName; x: number; y: number; size: number; tilt: number }
  | { kind: 'sticker'; name: StickerName; x: number; y: number; size: number; tilt: number; tint: string }

/** mulberry32: a small, good-enough PRNG, seeded from a string. */
function seeded(seed: string) {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19) }
  let a = h >>> 0
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/* Where a sticker may go, in percent of the card, chosen to sit clear of the
   tab, the stamp, the name, the two lines under it, the call to action and the
   large landmark in the lower right. */
const SPOTS: { x: number; y: number }[] = [
  { x: 48, y: 5 }, { x: 58, y: 9 }, { x: 68, y: 4 },      // the top band, between tab and stamp
  { x: 88, y: 40 }, { x: 78, y: 32 },                     // right of the name, above the landmark
  { x: 58, y: 62 }, { x: 68, y: 72 },                     // to the right of the date line
  { x: 48, y: 90 }, { x: 60, y: 94 },                     // between the call to action and the landmark
  { x: 6, y: 62 }, { x: 8, y: 80 },                       // the left margin, low
]
const TINTS = ['#b75a4a', '#c9973f', '#7c9a6a', '#6c8fa6', '#9a6d9c', '#c47a63']
const STICKERS: StickerName[] = ['star', 'sparkle', 'flower', 'daisy', 'heart', 'sun', 'cloud', 'plane', 'leaf', 'tape', 'ticket', 'wave', 'moon', 'camera', 'pin']

export function dressCover(city: string, seed: string, fallback = 0): CoverPiece[] {
  const rnd = seeded(`${city}|${seed}`)
  const pick = <T,>(list: T[]) => list[Math.floor(rnd() * list.length)]
  const set = citySet(city, fallback)
  const out: CoverPiece[] = []

  // The large landmark, low in the right corner, leaning a little.
  out.push({ kind: 'mark', name: set[0], x: 100, y: 100, size: 142, tilt: -4 + rnd() * 3 })

  // A smaller second landmark, when the city has one, in one of two places.
  if (set.length > 1) {
    const second = pick(set.slice(1))
    // Below the stamp on the right, or to the right of the date line: the two
    // places on a card where a small drawing meets neither the name nor the
    // large landmark.
    const where = rnd() < .5 ? { x: 79, y: 50 } : { x: 60, y: 66 }
    out.push({ kind: 'mark', name: second, x: where.x, y: where.y, size: 56 + rnd() * 14, tilt: -8 + rnd() * 16 })
  }

  // Three or four stickers, each in its own spot.
  const spots = SPOTS.slice()
  const n = 3 + (rnd() < .5 ? 1 : 0)
  const used = new Set<StickerName>()
  for (let i = 0; i < n && spots.length; i++) {
    const at = spots.splice(Math.floor(rnd() * spots.length), 1)[0]
    let name = pick(STICKERS)
    for (let tries = 0; used.has(name) && tries < 6; tries++) name = pick(STICKERS)
    used.add(name)
    out.push({
      kind: 'sticker', name,
      x: at.x + (rnd() - .5) * 6, y: at.y + (rnd() - .5) * 6,
      size: 22 + rnd() * 14, tilt: -28 + rnd() * 56, tint: pick(TINTS),
    })
  }
  return out
}

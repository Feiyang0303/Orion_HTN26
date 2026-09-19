import { useEffect, useMemo, useRef, useState } from 'react'
import { Mark, Stamp, Tape, Ticket } from './Marks'
import { firstSentences, illustrationFor, markFor, notesFor, pressedFor, scatter, skyFor } from './decor'
import { RouteMap, RouteSheet } from './RouteSheet'
import type { Agent, CrewEvent } from '../events'
import { HHMM, MINS, TRANSPORT_LABEL, type Beat, type Plan, type Stop, type Target } from '../../types'

/* The book.
 *
 * It is the interface, not a view of one: the pages are where the day is read
 * and begun. Three things keep it from becoming a slideshow with a paper
 * background.
 *
 * One — the pages exist because the data does. A stop's spread is in the book
 * the moment the crew reports it, and fills as the narrator and the voice get
 * to it. Nothing is animated into existence on a timer and nothing pretends to
 * be working.
 *
 * Two — you can turn to any page at any time, including while the crew is
 * still working. A book you have to wait for is a loading screen with serifs.
 *
 * Three — every mark on the paper is derived from the plan. See decor.ts.
 */

/* Every stop has a colour and keeps it everywhere it appears — the disc on its
   page, its number on the timeline, the ticket that arrives at it. Six warm
   inks, cycling. Not decoration: it is how the eye finds stop 4 on the map
   after reading about it on the page. */
export const STOP_COLOURS = ['#3f7fd6', '#8e5fc9', '#3f9d63', '#e37d2d', '#d94a5e', '#2d9cb3']
export const colourOf = (index: number) => STOP_COLOURS[index % STOP_COLOURS.length]

type Props = {
  plan: Plan
  events: CrewEvent[]
  planning: boolean
  onBegin: () => void
  onClose: () => void
  /** The only edit the book allows: how long you mean to stay. It moves every
      arrival after it and nothing else — the flight's own pacing comes from
      the narration, so this cannot make the map lie. */
  onStay?: (stopId: string, minutes: number) => void
}

export default function Storybook({ plan, events, planning, onBegin, onClose, onStay }: Props) {
  const [at, setAt] = useState(0)
  const [turning, setTurning] = useState<'none' | 'fwd' | 'back'>('none')
  const touched = useRef(false)

  const spreads = useMemo(() => buildSpreads(), [plan, planning, at])   // eslint-disable-line react-hooks/exhaustive-deps
  const notes = useMemo(() => notesFor(plan), [plan])
  const crew = useMemo(() => events.filter(e => e.type === 'crew') as Extract<CrewEvent, { type: 'crew' }>[], [events])
  const newest = crew.at(-1)

  /* While the crew is still working and you have not turned a page yourself,
     the book turns to the page the work is happening on. Following the *last*
     spread instead was worse than useless: the last spread is the day's
     summary, so a half-built plan was presented as a finished one. The moment
     you turn a page yourself it stops, because being dragged away from what
     you are reading is worse than missing a page appearing. */
  useEffect(() => {
    if (touched.current || !planning || !newest) return
    const named = plan.stops.find(s => newest.detail.includes(s.name))
    const key = named ? named.id : newest.agent === 'Router' ? 'route' : 'cover'
    const i = spreads.findIndex(sp => sp.key === key)
    setAt(i >= 0 ? i : 0)
  }, [crew.length, planning])   // eslint-disable-line react-hooks/exhaustive-deps

  const go = (d: number) => {
    const next = Math.max(0, Math.min(spreads.length - 1, at + d))
    if (next === at) return
    touched.current = true
    setTurning(d > 0 ? 'fwd' : 'back')
    setAt(next)
    setTimeout(() => setTurning('none'), 460)
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'Escape') onClose()
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  })

  const spread = spreads[Math.min(at, spreads.length - 1)]

  return (
    <div className="jr-book-wrap">
      <div className={`jr-book turn-${turning}`}>
        <div className="jr-leaf jr-leaf-l">
          {spread?.left}
          {/* Marginalia sits in the foot of the page, where a person writing in
              a journal would put it — not floating outside the book, where a
              narrow window simply cuts it off. */}
          {notes[0] && <p className="jr-note" style={{ '--rot': `${notes[0].rotate}deg` } as React.CSSProperties}>{notes[0].text}</p>}
        </div>
        <div className="jr-spine" aria-hidden />
        <div className="jr-leaf jr-leaf-r">
          {spread?.right}
          {notes[1] && <p className="jr-note" style={{ '--rot': `${notes[1].rotate}deg` } as React.CSSProperties}>{notes[1].text}</p>}
        </div>
      </div>

      <nav className="jr-turn" aria-label="Pages">
        <button className="jr-btn" onClick={() => go(-1)} disabled={at === 0} aria-label="Previous page">←</button>
        <ol className="jr-tabs">
          {spreads.map((s, i) => (
            <li key={s.key}>
              <button className={`jr-tab ${i === at ? 'on' : ''}`} title={s.title}
                onClick={() => { touched.current = true; setAt(i) }}>{s.tab}</button>
            </li>
          ))}
        </ol>
        <button className="jr-btn" onClick={() => go(1)} disabled={at >= spreads.length - 1} aria-label="Next page">→</button>
      </nav>

      <CrewStrip crew={crew} planning={planning} />

      <div className="jr-book-actions">
        <button className="jr-btn ghost" onClick={onClose}>Back to the desk</button>
        <button className="jr-btn primary" onClick={onBegin} disabled={planning || !plan.stops.length}>
          Begin the flight
        </button>
      </div>
    </div>
  )

  /* --------------------------------------------------------------- spreads */

  function buildSpreads() {
    const out: { key: string; tab: string; title: string; left: React.ReactNode; right: React.ReactNode }[] = []

    out.push({ key: 'cover', tab: '✦', title: 'Cover', left: <Cover plan={plan} />, right: <Opening plan={plan} /> })

    if (plan.stops.length) out.push({
      key: 'route', tab: '◇', title: 'The day',
      left: <Timeline plan={plan} onPick={i => { touched.current = true; setAt(2 + i) }} />,
      right: (
        <Page title="On the ground" sub={kmOf(plan) ? `${kmOf(plan).toFixed(1)} km` : ''} className="jr-map-page">
          <RouteMap plan={plan} height={240} />
        </Page>
      ),
    })

    plan.stops.forEach((stop, i) => out.push({
      key: stop.id, tab: String(i + 1), title: stop.name,
      left: <StopPlate plan={plan} stop={stop} index={i} />,
      right: <StopEntry plan={plan} stop={stop} index={i} onStay={onStay} />,
    }))

    const targets = plan.stops.flatMap((s, i) => s.targets.map(t => ({ t, s, i })))
    if (targets.length) out.push({
      key: 'near', tab: '✧', title: 'What the guide will point at',
      left: <Near list={targets.slice(0, 3)} total={targets.length} />,
      right: targets.length > 3 ? <Near list={targets.slice(3, 6)} total={targets.length} offset={3} /> : <HowFound plan={plan} />,
    })

    /* The closing spread is a summary, and a summary of a day that is still
       being made is a wrong number in a confident typeface. It appears when
       the day is actually finished. */
    if (plan.stops.length && !planning) out.push({
      key: 'end', tab: '❦', title: 'The end of the day',
      left: <Ending plan={plan} />, right: <BeforeYouGo plan={plan} />,
    })

    return out
  }
}

/* ------------------------------------------------------------------- pages */

const kmOf = (plan: Plan) => (plan.legs.reduce((s, l) => s + l.distanceM, 0) + (plan.approach?.distanceM ?? 0)) / 1000
const endsAt = (plan: Plan) => {
  const last = plan.stops.at(-1)
  return last?.arrival ? HHMM(MINS(last.arrival) + last.visitMin) : '—'
}

function Page({ title, sub, children, className = '', before }: {
  title?: string; sub?: string; children: React.ReactNode; className?: string; before?: React.ReactNode
}) {
  return (
    <div className={`jr-page ${className}`}>
      {title && <header className="jr-page-head">{before}<h2>{title}</h2>{sub && <span className="jr-page-sub">{sub}</span>}</header>}
      {children}
    </div>
  )
}

/** The little pills under a title. Each one is a fact the page already knows,
    said in three words — the way of letting the eye pick a day apart before
    reading any of it. */
function Tags({ plan, stop, index }: { plan: Plan; stop: Stop; index: number }) {
  const leg = plan.legs[index], next = plan.stops[index + 1]
  const tags: { t: string; k: string }[] = [
    { t: `stay ${Math.round(stop.visitMin)} min`, k: 'time' },
    ...(stop.asked ? [{ t: 'yours by name', k: 'edit' }] : stop.fits ? [{ t: stop.fits.toLowerCase(), k: 'fit' }] : []),
    ...(leg && next ? [{ t: `${Math.round(leg.durationSec / 60)}′ ${TRANSPORT_LABEL[leg.transport].toLowerCase()} → ${next.name}`, k: 'leg' }] : []),
    ...(stop.photo ? [{ t: 'photographed', k: 'photo' }] : [{ t: 'drawn', k: 'photo' }]),
    ...(stop.sources.length ? [] : [{ t: 'no article', k: 'warn' }]),
    ...(leg?.estimated ? [{ t: 'time estimated', k: 'warn' }] : []),
    ...(stop.beats.length ? [{ t: `${stop.beats.length} beat${stop.beats.length === 1 ? '' : 's'} in the air`, k: 'fit' }] : []),
  ]
  return <ul className="jr-tags">{tags.map((x, i) => <li key={i} className={`is-${x.k}`}>{x.t}</li>)}</ul>
}

function Timeline({ plan, onPick }: { plan: Plan; onPick: (i: number) => void }) {
  return (
    <Page title="The day" sub={plan.stops.length ? `${plan.wish.startAt} — ${endsAt(plan)}` : ''} className="jr-timeline-page">
      {plan.from && plan.approach && (
        <p className="jr-timeline-from">
          <Mark name="station" size={15} /> From <b>{plan.from.name}</b>, {Math.round(plan.approach.durationSec / 60)} min
          {' '}{TRANSPORT_LABEL[plan.approach.transport].toLowerCase()} to the first stop.
        </p>
      )}
      <ol className="jr-timeline">
        {plan.stops.map((s, i) => (
          <li key={s.id} style={{ '--c': colourOf(i) } as React.CSSProperties}>
            <button className="jr-timeline-row" onClick={() => onPick(i)}>
              <span className="jr-disc">{i + 1}</span>
              <span className="jr-timeline-body">
                <span className="jr-timeline-head">
                  <em>{s.arrival || '—'}</em><b>{s.name}</b><Mark name={markFor(s.name, i)} size={16} />
                </span>
                <span className="jr-timeline-sub">
                  {s.blurb ? firstSentences(s.blurb, 1) : s.beats[0]?.text ?? 'Still being written.'}
                </span>
                <Tags plan={plan} stop={s} index={i} />
              </span>
            </button>
          </li>
        ))}
      </ol>
    </Page>
  )
}

function Cover({ plan }: { plan: Plan }) {
  const spots = scatter(plan.city, 3)
  return (
    <div className="jr-page jr-cover">
      <div className="jr-cover-rule" aria-hidden />
      <p className="jr-cover-kicker">A day in</p>
      <h1 className="jr-cover-title">{plan.city}</h1>
      {plan.epigraph && <p className="jr-cover-epigraph">{plan.epigraph}</p>}
      <div className="jr-cover-marks">
        <Mark name={skyFor(plan.wish.startAt)} size={26} className="fade" />
        <Mark name={pressedFor(plan.origin.lat)} size={58} className="pressed" />
        <Mark name="compass" size={26} className="fade" />
      </div>
      <p className="jr-cover-by">{plan.wish.interests.join(' · ') || 'no particular plan'}</p>
      {plan.stops.length > 0 && (
        <ol className="jr-cover-strip" aria-label="Stops">
          {plan.stops.map((s, i) => (
            <li key={s.id} style={{ '--c': colourOf(i) } as React.CSSProperties}>
              <span className="jr-disc">{i + 1}</span><Mark name={markFor(s.name, i)} size={18} />
            </li>
          ))}
        </ol>
      )}
      <Stamp mark={markFor(plan.stops[0]?.name ?? plan.city, 0)} place={plan.city}
        value={kmOf(plan) ? `${kmOf(plan).toFixed(1)} km` : '—'} />
      {spots.map(s => (
        <span key={s.i} className="jr-foxing" aria-hidden
          style={{ left: `${8 + s.a * 78}%`, top: `${12 + s.b * 74}%`, ['--s' as string]: 0.6 + s.a }} />
      ))}
    </div>
  )
}

function Opening({ plan }: { plan: Plan }) {
  const asked = plan.wish.wants.filter(Boolean)
  return (
    <Page title="What you asked for">
      <dl className="jr-brief">
        <div><dt>Hours</dt><dd>{plan.wish.startAt} — {plan.wish.endAt}</dd></div>
        <div><dt>Pace</dt><dd>{plan.wish.pace}</dd></div>
        <div><dt>Getting about</dt><dd>{TRANSPORT_LABEL[plan.wish.transport]}</dd></div>
        {plan.from && <div><dt>Starting from</dt><dd>{plan.from.name}</dd></div>}
      </dl>
      <p className="jr-hand">
        {asked.length
          ? `You wanted ${asked.slice(0, -1).join(', ')}${asked.length > 1 ? ' and ' : ''}${asked.at(-1)}.`
          : 'You left the whole day to the scout.'}
      </p>
      <ul className="jr-checklist">
        {plan.stops.map((s, i) => (
          <li key={s.id} className={s.sources.length ? 'has-source' : ''}>
            <Mark name={markFor(s.name, i)} size={17} /><span>{s.name}</span>{s.arrival && <em>{s.arrival}</em>}
          </li>
        ))}
      </ul>
      <ul className="jr-colophon jr-colophon-small">
        <li>
          Stops chosen by <b>{plan.provenance.scout}</b> · reviewed by <b>{plan.provenance.critic}</b> ·
          order and times by <b>code</b> · entries by <b>{plan.provenance.narrator}</b> · voice <b>{plan.provenance.tts}</b>.
        </li>
      </ul>
    </Page>
  )
}

function StopPlate({ plan, stop, index }: { plan: Plan; stop: Stop; index: number }) {
  const arriving = index === 0 ? plan.approach : plan.legs[index - 1] ?? null
  const previous = plan.stops[index - 1]
  const cite = stop.sources[0] ?? null
  return (
    <div className="jr-page jr-plate">
      <span className="jr-plate-no" aria-hidden style={{ color: colourOf(index) }}>{index + 1}</span>
      <figure className="jr-photo">
        <Tape className="tl" /><Tape className="tr" />
        {stop.photo
          ? <img src={stop.photo.url} alt="" loading="lazy" />
          : <div className="jr-sketch"><Mark name={illustrationFor(stop, index)} size={120} /></div>}
        <figcaption>
          {stop.photo
            ? <>{stop.photo.credit} · <a href={stop.photo.pageUrl} target="_blank" rel="noreferrer">Wikimedia Commons</a></>
            : cite
              ? <>Drawn here — no photograph on file. Described by <a href={cite.url} target="_blank" rel="noreferrer">{cite.label}</a>.</>
              : <>Drawn here. Wikipedia had no article or photograph for this one.</>}
        </figcaption>
      </figure>
      {arriving && (
        <Ticket from={index === 0 ? (plan.from?.name ?? 'the start') : previous.name} to={stop.name}
          minutes={arriving.durationSec / 60} mode={TRANSPORT_LABEL[arriving.transport]} colour={colourOf(index)} />
      )}
    </div>
  )
}

function StopEntry({ plan, stop, index, onStay }: {
  plan: Plan; stop: Stop; index: number; onStay?: (id: string, m: number) => void
}) {
  const next = plan.stops[index + 1]
  const leg = plan.legs[index]
  return (
    <Page title={stop.name} sub={stop.arrival ? `arrive ${stop.arrival}` : ''} className="jr-stop-page"
      before={<span className="jr-disc" style={{ background: colourOf(index) }}>{index + 1}</span>}>
      <Tags plan={plan} stop={stop} index={index} />
      {stop.blurb && <p className="jr-blurb">{stop.blurb}</p>}

      {/* What the guide will actually say, in the air, in order. The book is not
          paraphrasing the flight — these are the same beats, the same audio. */}
      {stop.beats.length
        ? <Beats stop={stop} />
        : <p className="jr-writing">Still being written<span className="jr-nib" aria-hidden /></p>}

      <p className="jr-fits"><Mark name="key" size={15} />
        {stop.asked
          ? <span>Here because <b>you asked for it by name</b>.</span>
          : <span>Here because <b>{stop.fits.toLowerCase()}</b>.</span>}
      </p>

      <div className="jr-dial">
        <label>
          Stay
          <input type="range" min={10} max={180} step={5} value={Math.round(stop.visitMin)}
            disabled={!onStay} onChange={e => onStay?.(stop.id, Number(e.target.value))} />
          <b>{Math.round(stop.visitMin)} min</b>
        </label>
        <span className="jr-caption" style={{ margin: 0 }}>
          Moves every arrival after it. The flight's own pacing comes from the narration, not from this.
        </span>
      </div>

      <footer className="jr-onward">
        {leg && next ? (
          <>
            <Mark name={markFor(next.name, index + 1)} size={19} />
            <span>
              {Math.round(leg.durationSec / 60)} minutes {TRANSPORT_LABEL[leg.transport].toLowerCase()} to <b>{next.name}</b>
              {leg.estimated && <em> — estimated, the router did not answer</em>}
            </span>
          </>
        ) : <span className="jr-onward-end">The day ends here.</span>}
      </footer>
    </Page>
  )
}

/** The narration, as it will be heard. Each beat can be played on its own; a
    beat that points at something nearby says which thing, because that is the
    moment the camera will turn. */
function Beats({ stop }: { stop: Stop }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState<number | null>(null)
  const target = (b: Beat): Target | undefined => stop.targets.find(t => t.id === b.targetId)
  const play = (i: number) => {
    const url = stop.beats[i].audioUrl
    if (!url || !audio.current) return
    audio.current.src = url
    void audio.current.play()
    setPlaying(i)
  }
  return (
    <div className="jr-voice" style={{ display: 'block' }}>
      <audio ref={audio} onEnded={() => setPlaying(null)} />
      <ol className="jr-tips" style={{ margin: '4px 0 0' }}>
        {stop.beats.map((b, i) => (
          <li key={i}>
            <Mark name={b.targetId ? 'compass' : 'clock'} size={18} />
            <span>
              <span className="jr-story" style={{ display: 'block', margin: 0 }}>{b.text}</span>
              <span className="jr-caption" style={{ margin: '2px 0 0' }}>
                {target(b) ? <>points at <b>{target(b)!.name}</b> · </> : null}
                {b.durationSec.toFixed(1)}s
                {b.audioUrl
                  ? <> · <button className="jr-btn tiny" onClick={() => play(i)}>{playing === i ? 'playing…' : 'hear it'}</button></>
                  : <> · no voice — the length is an estimate from the words</>}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function Near({ list, total, offset = 0 }: {
  list: { t: Target; s: Stop; i: number }[]; total: number; offset?: number
}) {
  return (
    <Page title={offset ? '' : 'What the guide will point at'} sub={offset ? '' : `${total} nearby`} className="jr-found-page">
      <ul className="jr-found">
        {list.map(({ t, s, i }, k) => (
          <li key={t.id} style={{ '--c': STOP_COLOURS[(offset + k + 3) % STOP_COLOURS.length] } as React.CSSProperties}>
            <div className="jr-found-plate"><Mark name={markFor(t.name, k)} size={28} /></div>
            <div className="jr-found-body">
              <h3>{t.name}</h3>
              <p>{firstSentences(t.summary, 1)}</p>
              <ul className="jr-tags">
                <li className="is-fit">from stop {i + 1}, {s.name}</li>
              </ul>
              <div className="jr-found-act">
                <a className="jr-cite" href={t.source.url} target="_blank" rel="noreferrer">Wikipedia</a>
              </div>
            </div>
          </li>
        ))}
        {!list.length && <li className="jr-empty">Nothing more on this page.</li>}
      </ul>
    </Page>
  )
}

function HowFound({ plan }: { plan: Plan }) {
  return (
    <Page title="How these turned up">
      <p className="jr-blurb">
        Wikipedia was asked what it has within three hundred metres of each stop. Anything with an
        article and a real description is on this page, and the guide is allowed to point at those
        and nothing else.
      </p>
      <p className="jr-blurb">
        That restriction is the whole reason the narration can be trusted: the writer was handed
        these summaries and told to say only what they say. A beat that mentions a place you cannot
        see from the stop would have to have been invented, so the writer is never given the chance.
      </p>
      <div className="jr-pressed"><Mark name={pressedFor(plan.origin.lat)} size={80} className="pressed" /></div>
      <p className="jr-caption">In the air, each of these is a turn of the camera at the moment it is named.</p>
    </Page>
  )
}

function Ending({ plan }: { plan: Plan }) {
  const last = plan.stops.at(-1)
  const moving = plan.legs.reduce((s, l) => s + l.durationSec, 0) / 60 + (plan.approach?.durationSec ?? 0) / 60
  const staying = plan.stops.reduce((s, x) => s + x.visitMin, 0)
  return (
    <Page title="The end of the day" sub={endsAt(plan)} className="jr-ending">
      <p className="jr-hand big">You finish at {endsAt(plan)}, at {last?.name}.</p>
      <ul className="jr-stats">
        <li><b>{plan.stops.length}</b><span>stops</span></li>
        <li><b>{kmOf(plan).toFixed(1)}</b><span>km</span></li>
        <li><b>{Math.round(moving)}</b><span>min {TRANSPORT_LABEL[plan.wish.transport].toLowerCase()}</span></li>
        <li><b>{Math.round(staying / 60 * 10) / 10}</b><span>hours there</span></li>
      </ul>
      <ol className="jr-passport" aria-label="Stamps">
        {plan.stops.map((s, i) => (
          <li key={s.id} style={{ '--c': colourOf(i), '--rot': `${((i * 37) % 11) - 5}deg` } as React.CSSProperties}>
            <Mark name={markFor(s.name, i)} size={26} /><b>{s.arrival}</b><span>{s.name}</span>
          </li>
        ))}
      </ol>
      <RouteSheet plan={plan} active={-1} />
      <p className="jr-caption">The line of the day, as a keepsake. A diagram of what followed what, not a map.</p>
    </Page>
  )
}

function BeforeYouGo({ plan }: { plan: Plan }) {
  const tips: { mark: Parameters<typeof Mark>[0]['name']; text: string }[] = []
  const first = plan.stops[0]
  const longest = [...plan.legs].sort((a, b) => b.durationSec - a.durationSec)[0]
  const silent = plan.stops.filter(s => !s.sources.length)
  const estimated = plan.legs.filter(l => l.estimated)
  const mute = plan.stops.filter(s => s.beats.some(b => !b.audioUrl))

  if (first) tips.push({ mark: 'sun', text: `${first.name} opens the day at ${first.arrival}. Check its hours before you set out — the book cannot.` })
  if (longest && longest.durationSec > 15 * 60) {
    const after = plan.stops.find(s => s.id === longest.fromStopId)
    tips.push({ mark: 'compass', text: `The long leg is after ${after?.name}: ${Math.round(longest.durationSec / 60)} minutes ${TRANSPORT_LABEL[longest.transport].toLowerCase()}.` })
  }
  if (kmOf(plan) > 3 && plan.wish.transport === 'walk')
    tips.push({ mark: 'fern', text: `${kmOf(plan).toFixed(1)} km on foot. The shoes matter more than the bag.` })
  if (silent.length)
    tips.push({ mark: 'key', text: `${silent.map(s => s.name).join(' and ')} ${silent.length === 1 ? 'has' : 'have'} no Wikipedia article — the guide will stand there quietly.` })
  if (estimated.length)
    tips.push({ mark: 'clock', text: `${estimated.length} leg${estimated.length === 1 ? ' was' : 's were'} timed by straight line; the router did not answer. Allow a little more.` })
  if (mute.length)
    tips.push({ mark: 'moon', text: `Some beats have no audio — the voice failed for them, and their lengths are estimated from the words.` })
  tips.push({ mark: 'bloom', text: 'The flight follows this same order, over the real city, and says these same sentences.' })

  return (
    <Page title="Before you go" className="jr-before">
      <ul className="jr-tips">{tips.map((t, i) => <li key={i}><Mark name={t.mark} size={20} /><span>{t.text}</span></li>)}</ul>
      <div className="jr-pressed"><Mark name={pressedFor(plan.origin.lat)} size={64} className="pressed" /></div>
      <ul className="jr-colophon jr-colophon-small">
        <li>Places: <b>Nominatim</b> on OpenStreetMap · descriptions and photographs: <b>Wikipedia</b> and <b>Wikimedia Commons</b> · roads and times: <b>Google Routes</b> · the city itself: <b>Google photorealistic 3D tiles</b>.</li>
      </ul>
    </Page>
  )
}

/* ------------------------------------------------------------- the crew bar */

const CREW: Agent[] = ['Geocode', 'Scout', 'Router', 'Timekeeper', 'Critic', 'Narrator', 'Voice']

function CrewStrip({ crew, planning }: { crew: Extract<CrewEvent, { type: 'crew' }>[]; planning: boolean }) {
  const latest = new Map<Agent, typeof crew[number]>()
  for (const c of crew) latest.set(c.agent, c)
  const newest = crew.at(-1)
  return (
    <div className="jr-crew" aria-live="polite">
      <ol>
        {CREW.map(w => {
          const p = latest.get(w)
          return <li key={w} className={`is-${p?.state ?? 'idle'}`} title={p?.kind === 'tool' ? 'code' : 'a model'}><i aria-hidden />{w}</li>
        })}
      </ol>
      <p className="jr-crew-line">{newest ? newest.detail : planning ? 'Starting…' : 'Done.'}</p>
    </div>
  )
}

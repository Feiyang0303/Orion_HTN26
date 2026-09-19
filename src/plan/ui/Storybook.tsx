import { useEffect, useMemo, useRef, useState } from 'react'
import { Mark, Stamp, Tape, Ticket } from './Marks'
import { firstSentences, illustrationFor, markFor, notesFor, paletteFor, pressedFor, scatter, skyFor } from './decor'
import { RouteSheet, TRANSPORT_MARK } from './RouteSheet'
import FoldedMap from './FoldedMap'
import type { Agent, CrewEvent } from '../events'
import {
  HHMM, LODGING_LABEL, MINS, PARTY_LABEL, TRANSPORT_LABEL,
  type Beat, type Day, type Plan, type Stop, type Table, type Target, type Trip,
} from '../../types'

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
  trip: Trip
  events: CrewEvent[]
  planning: boolean
  /** Fly one day. The flythrough takes a Plan, and a Day *is* a Plan, so this
      hands it straight over. */
  onFly: (day: Day) => void
  onClose: () => void
  onHome?: () => void
  /** The only edit the book allows: how long you mean to stay. It moves every
      arrival after it and nothing else — the flight's own pacing comes from
      the narration, so this cannot make the map lie. */
  onStay?: (dayNumber: number, stopId: string, minutes: number) => void
}

export default function Storybook({ trip, events, planning, onFly, onClose, onHome, onStay }: Props) {
  const [at, setAt] = useState(0)
  const [turning, setTurning] = useState<'none' | 'fwd' | 'back'>('none')
  const touched = useRef(false)

  const spreads = useMemo(() => buildSpreads(), [trip, planning, at])   // eslint-disable-line react-hooks/exhaustive-deps
  const notes = useMemo(() => trip.days[0] ? notesFor(trip.days[0]) : [], [trip])
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
    const named = trip.days.flatMap(d => d.stops).find(s => newest.detail.includes(s.name))
    const dayNo = Number(/^Day (\d+)/.exec(newest.detail)?.[1] ?? 0)
    const key = named ? named.id : dayNo ? `day${dayNo}` : newest.agent === 'Scout' ? 'cover' : 'cover'
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
        {onHome && <button className="jr-btn ghost" onClick={onHome}>← Orion</button>}
        <button className="jr-btn ghost" onClick={onClose}>Back to the desk</button>
        {/* Flying happens from a day's own page, because a trip has no single
            route; this only says so. */}
        <span className="jr-crew-line" style={{ flex: 1, textAlign: 'right' }}>
          {planning ? 'The crew is still working…' : 'Open a day to fly it.'}
        </span>
      </div>
    </div>
  )

  /* --------------------------------------------------------------- spreads */

  function buildSpreads() {
    const out: { key: string; tab: string; title: string; left: React.ReactNode; right: React.ReactNode }[] = []

    out.push({ key: 'cover', tab: '✦', title: 'Cover', left: <Cover trip={trip} />, right: <Opening trip={trip} /> })

    if (trip.stays.length) out.push({
      key: 'bed', tab: '⌂', title: 'Where you sleep',
      left: <Beds trip={trip} />, right: <HowChosen trip={trip} />,
    })

    for (const day of trip.days) {
      const here = out.length
      out.push({
        key: `day${day.number}`, tab: String(day.number), title: day.title,
        left: <DayPage day={day} trip={trip} onPick={i => { touched.current = true; setAt(a => a + 1 + i) }} onFly={() => onFly(day)} />,
        right: (
          <Page title="On the ground" sub={kmOf(day) ? `${kmOf(day).toFixed(1)} km` : ''} className="jr-map-page">
            {/* Folded while you are elsewhere in the book; it opens when you
                turn to this spread, and the tiles load behind the paper as the
                panels swing out. */}
            <FoldedMap day={day} colours={STOP_COLOURS} open={at === here} />
          </Page>
        ),
      })
      day.stops.forEach((stop, i) => out.push({
        key: stop.id, tab: '·', title: stop.name,
        left: <StopPlate plan={day} stop={stop} index={i} />,
        right: <StopEntry plan={day} stop={stop} index={i}
          onStay={onStay ? (id, m) => onStay(day.number, id, m) : undefined} />,
      }))
    }

    const targets = trip.days.flatMap(d => d.stops.flatMap((s, i) => s.targets.map(t => ({ t, s, i }))))
    if (targets.length) out.push({
      key: 'near', tab: '✧', title: 'What the guide will point at',
      left: <Near list={targets.slice(0, 3)} total={targets.length} />,
      right: targets.length > 3 ? <Near list={targets.slice(3, 6)} total={targets.length} offset={3} /> : <HowFound plan={trip.days[0]} />,
    })

    /* The closing spread is a summary, and a summary of a trip that is still
       being made is a wrong number in a confident typeface. */
    if (trip.days.length && !planning) out.push({
      key: 'end', tab: '❦', title: 'The end of the trip',
      left: <Ending trip={trip} />, right: <BeforeYouGo trip={trip} />,
    })

    return out
  }
}

/* ------------------------------------------------------------------- pages */

const kmOf = (plan: Plan) => (plan.legs.reduce((s, l) => s + l.distanceM, 0) + (plan.approach?.distanceM ?? 0)) / 1000
const tripKm = (trip: Trip) => trip.days.reduce((s, d) => s + kmOf(d), 0)
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
    said in three words. */
function Tags({ plan, stop, index }: { plan: Plan; stop: Stop; index: number }) {
  const leg = plan.legs[index], next = plan.stops[index + 1]
  const tags: { t: string; k: string }[] = [
    { t: `stay ${Math.round(stop.visitMin)} min`, k: 'time' },
    ...(stop.askedAs ? [{ t: `${stop.movedM} m from your pin`, k: 'edit' }]
      : stop.asked ? [{ t: 'yours by name', k: 'edit' }]
      : stop.fits ? [{ t: stop.fits.toLowerCase(), k: 'fit' }] : []),
    ...(leg && next ? [{ t: `${Math.round(leg.durationSec / 60)}′ ${TRANSPORT_LABEL[leg.transport].toLowerCase()} → ${next.name}`, k: 'leg' }] : []),
    ...(stop.photo ? [{ t: 'photographed', k: 'photo' }] : [{ t: 'drawn', k: 'photo' }]),
    ...(stop.sources.length ? [] : [{ t: 'no article', k: 'warn' }]),
    ...(leg?.estimated ? [{ t: 'time estimated', k: 'warn' }] : []),
    ...(stop.beats.length ? [{ t: `${stop.beats.length} beat${stop.beats.length === 1 ? '' : 's'} in the air`, k: 'fit' }] : []),
  ]
  return <ul className="jr-tags">{tags.map((x, i) => <li key={i} className={`is-${x.k}`}>{x.t}</li>)}</ul>
}

/* ------------------------------------------------------------------- cover */

function Cover({ trip }: { trip: Trip }) {
  const spots = scatter(trip.city, 3)
  const nights = trip.days.length
  return (
    <div className="jr-page jr-cover">
      <div className="jr-cover-rule" aria-hidden />
      <p className="jr-cover-kicker">{nights === 1 ? 'A day in' : `${nights} days in`}</p>
      <h1 className="jr-cover-title">{trip.city}</h1>
      <p className="jr-cover-epigraph">
        {trip.days.reduce((n, d) => n + d.stops.length, 0)} places, {tripKm(trip).toFixed(1)} km,
        {trip.stays[0] ? ` sleeping at ${trip.stays[0].name}.` : ' no bed chosen.'}
      </p>
      <div className="jr-cover-marks">
        <Mark name={skyFor(trip.wish.startAt)} size={26} className="fade" />
        <Mark name={pressedFor(trip.origin.lat)} size={58} className="pressed" />
        <Mark name="compass" size={26} className="fade" />
      </div>
      <p className="jr-cover-by">{trip.wish.interests.join(' · ') || 'no particular plan'}</p>
      <ol className="jr-cover-strip" aria-label="Days">
        {trip.days.map(d => (
          <li key={d.number} style={{ '--c': colourOf(d.number - 1) } as React.CSSProperties}>
            <span className="jr-disc">{d.number}</span>
            <Mark name={markFor(d.stops[0]?.name ?? d.title, d.number)} size={18} />
          </li>
        ))}
      </ol>
      <Stamp mark={markFor(trip.days[0]?.stops[0]?.name ?? trip.city, 0)} place={trip.city}
        value={tripKm(trip) ? `${tripKm(trip).toFixed(1)} km` : '—'} />
      {spots.map(s => (
        <span key={s.i} className="jr-foxing" aria-hidden
          style={{ left: `${8 + s.a * 78}%`, top: `${12 + s.b * 74}%`, ['--s' as string]: 0.6 + s.a }} />
      ))}
    </div>
  )
}

function Opening({ trip }: { trip: Trip }) {
  const asked = trip.wish.wants.filter(Boolean)
  const moved = trip.days.flatMap(d => d.stops).filter(s => s.askedAs)
  return (
    <Page title="What you asked for">
      <dl className="jr-brief">
        <div><dt>Days</dt><dd>{trip.days.length}</dd></div>
        <div><dt>Hours</dt><dd>{trip.wish.startAt} — {trip.wish.endAt}</dd></div>
        <div><dt>Who</dt><dd>{PARTY_LABEL[trip.wish.party]}</dd></div>
        <div><dt>Getting about</dt><dd>{TRANSPORT_LABEL[trip.wish.transport]}</dd></div>
        <div><dt>Bed</dt><dd>{LODGING_LABEL[trip.wish.lodging]}</dd></div>
        {trip.wish.diet.trim() && <div><dt>At the table</dt><dd>{trip.wish.diet}</dd></div>}
      </dl>
      <p className="jr-hand">
        {asked.length
          ? `You wanted ${asked.slice(0, -1).join(', ')}${asked.length > 1 ? ' and ' : ''}${asked.at(-1)}.`
          : 'You left the whole trip to the crew.'}
      </p>
      {/* The editor's note on the finished trip: written from the plan's own
          fields and nothing else, which is why it can be trusted to say where
          the days are tight. */}
      {trip.preface && <p className="jr-blurb">{trip.preface}</p>}
      {moved.length > 0 && (
        <p className="jr-warn">
          {moved.map(s => `You pinned ${s.askedAs}; nothing notable stands there, so the day goes to ${s.name}, ${s.movedM} m away.`).join(' ')}
        </p>
      )}
      <ul className="jr-checklist">
        {trip.days.map(d => (
          <li key={d.number} className="has-source">
            <Mark name={markFor(d.stops[0]?.name ?? d.title, d.number)} size={17} />
            <span>{d.title}</span><em>{d.stops.length} stops</em>
          </li>
        ))}
      </ul>
    </Page>
  )
}

/* ----------------------------------------------------------------- the bed */

function Beds({ trip }: { trip: Trip }) {
  return (
    <Page title="Where you sleep" sub={`${trip.stays.length} from OpenStreetMap`} className="jr-found-page">
      <ul className="jr-found">
        {trip.stays.map((b, i) => (
          <li key={b.id} style={{ '--c': STOP_COLOURS[i % STOP_COLOURS.length] } as React.CSSProperties}>
            <div className="jr-found-plate"><Mark name="station" size={28} /></div>
            <div className="jr-found-body">
              <h3>{b.name}</h3>
              <p>{b.why}</p>
              <ul className="jr-tags">
                <li className="is-fit">{b.kind.replace('_', ' ')}</li>
                {b.stars != null && <li className="is-time">{b.stars} stars, self-declared</li>}
                {b.address && <li className="is-photo">{b.address}</li>}
              </ul>
              <div className="jr-found-act">
                <a className="jr-cite" href={b.source.url} target="_blank" rel="noreferrer">OpenStreetMap</a>
              </div>
            </div>
          </li>
        ))}
        {!trip.stays.length && <li className="jr-empty">OpenStreetMap lists nothing to sleep in near the middle of this trip.</li>}
      </ul>
    </Page>
  )
}

function HowChosen({ trip }: { trip: Trip }) {
  return (
    <Page title="How the bed and the table were chosen">
      <p className="jr-blurb">
        Hotels and restaurants are not in Wikipedia, so they come from OpenStreetMap: every place on
        these pages is a real entry somebody mapped, with a real position, and the link under each one
        goes to it.
      </p>
      <p className="jr-blurb">
        OpenStreetMap has no ratings and no prices, so this book prints none. A star count, where it
        appears, is what the hotel told OpenStreetMap about itself. Opening hours are quoted from the
        tag exactly as written and may be out of date — the book cannot promise anywhere is open.
      </p>
      <p className="jr-blurb">
        What the crew could weigh was distance from where you will actually be, the sort of bed you
        asked for, the cuisine tag, and anything said about diets or step-free access. That is the
        whole basis of every choice here, and it is why none of them claims to be the best in the city.
      </p>
      <div className="jr-pressed"><Mark name={pressedFor(trip.origin.lat)} size={72} className="pressed" /></div>
    </Page>
  )
}

/* ------------------------------------------------------------------- a day */

function DayPage({ day, trip, onPick, onFly }: {
  day: Day; trip: Trip; onPick: (i: number) => void; onFly: () => void
}) {
  /* The ink this day is drawn in comes from what is in it. */
  const ink = paletteFor(day.stops.map(s => s.name))
  const style = { '--ink-day': ink.accent, '--wash-day': ink.wash, '--rule-day': ink.rule } as React.CSSProperties
  const leaving = (i: number) => HHMM(MINS(day.stops[i].arrival) + day.stops[i].visitMin)

  return (
    <div className="jr-page jr-day" style={style}>
      <header className="jr-day-head">
        <div>
          <p className="jr-kicker">Day {day.number} · {trip.city}</p>
          <h2>{day.title}</h2>
        </div>
        <span className="jr-day-hours">{day.stops[0]?.arrival ?? trip.wish.startAt} — {endsAt(day)}</span>
      </header>

      {/* The day itself: a time, a place, one line about it, and how you get to
          the next one. What a place *is* belongs to the flight, which is where
          someone is actually looking at it; a plan that reads like an
          encyclopaedia is a plan nobody reads on the morning they use it. */}
      <ol className="jr-day-run">
        {day.stops.map((s, i) => {
          const leg = day.legs[i]
          const table = day.tables.find(t => t.nearStopId === s.id)
          return (
            <li key={s.id} style={{ '--c': colourOf(i) } as React.CSSProperties}>
              <button className="jr-day-stop" onClick={() => onPick(i)}>
                <span className="jr-day-when">{s.arrival}<em>{leaving(i)}</em></span>
                <span className="jr-disc">{i + 1}</span>
                <span className="jr-day-what">
                  <b>{s.name}<Mark name={markFor(s.name, i)} size={15} /></b>
                  <span className="jr-day-line">
                    {s.askedAs ? `Yours — ${s.movedM} m from the pin you dropped. ` : ''}
                    {firstSentences(s.fits || s.blurb, 1)}
                  </span>
                </span>
              </button>

              {table && <TableRow table={table} />}

              {leg && (
                <p className="jr-day-hop">
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
                    strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={TRANSPORT_MARK[leg.transport]} />
                  </svg>
                  {Math.round(leg.durationSec / 60)} min{leg.estimated ? ', estimated' : ''}
                  <i>{(leg.distanceM / 1000).toFixed(1)} km</i>
                </p>
              )}
            </li>
          )
        })}
      </ol>

      {/* Pencil in the corner: the things a plan should say out loud and
          usually does not. Every line is counted from this day, never advice. */}
      <ul className="jr-day-notes">
        {dayNotes(day, trip).map((n, i) => <li key={i}>{n}</li>)}
      </ul>

      <div className="jr-day-foot">
        <button className="jr-btn primary" onClick={onFly} disabled={!day.stops.length}>
          Fly day {day.number}
        </button>
        <span className="jr-caption" style={{ margin: 0 }}>Each place is told properly in the air.</span>
      </div>
    </div>
  )
}

/** Four lines, in the spirit of the notes people pencil into a paper itinerary
    — and every one of them counted from this day rather than offered as
    advice the book has no standing to give. */
function dayNotes(day: Day, trip: Trip): string[] {
  const out: string[] = []
  const km = kmOf(day)
  const walking = trip.wish.transport === 'walk'
  if (km) out.push(`${km.toFixed(1)} km ${walking ? 'on foot' : `by ${trip.wish.transport}`} across the day — ${walking ? 'the shoes matter more than the bag' : 'the legs are priced door to door'}.`)
  const est = day.legs.filter(l => l.estimated).length
  if (est) out.push(`${est} leg${est === 1 ? '' : 's'} timed by straight line; the router did not answer. Allow a little more.`)
  const hours = day.tables.filter(t => t.openingHours)
  if (hours.length) out.push(`Hours are OpenStreetMap tags — ${hours[0].name} says “${hours[0].openingHours}”, unverified. Ring ahead if it matters.`)
  const silent = day.stops.filter(s => !s.sources.length)
  if (silent.length) out.push(`${silent.map(s => s.name).join(' and ')} has no article; the guide will stand there quietly.`)
  const first = day.stops[0]
  if (first && out.length < 4) out.push(`${first.name} opens the day at ${first.arrival}. Check its own hours before you set out — the book cannot.`)
  return out.slice(0, 4)
}

/** A meal, sitting in the timeline where the clock left room for it. */
function TableRow({ table }: { table: Table }) {
  return (
    <div className="jr-day-table">
      <Mark name="market" size={20} />
      <div>
        <b>{table.meal} · {table.name}</b>
        <span>
          {table.cuisine ? table.cuisine.replace(/;/g, ', ') : table.kind.replace('_', ' ')}
          {table.walkMin != null && <> · {table.walkMin} min from stop</>}
        </span>
        {table.why && <em>{table.why}</em>}
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- one place */

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
        {stop.askedAs
          ? <span>Here because you pinned <b>{stop.askedAs}</b> — nothing notable stands on that spot,
              and this is <b>{stop.movedM} m</b> away. {stop.fits}.</span>
          : stop.asked
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

/** The narration, as it will be heard. */
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
        {list.map(({ t, s }, k) => (
          <li key={t.id} style={{ '--c': STOP_COLOURS[(offset + k + 3) % STOP_COLOURS.length] } as React.CSSProperties}>
            <div className="jr-found-plate"><Mark name={markFor(t.name, k)} size={28} /></div>
            <div className="jr-found-body">
              <h3>{t.name}</h3>
              <p>{firstSentences(t.summary, 1)}</p>
              <ul className="jr-tags"><li className="is-fit">near {s.name}</li></ul>
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

function HowFound({ plan }: { plan?: Plan }) {
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
      {plan && <div className="jr-pressed"><Mark name={pressedFor(plan.origin.lat)} size={80} className="pressed" /></div>}
      <p className="jr-caption">In the air, each of these is a turn of the camera at the moment it is named.</p>
    </Page>
  )
}

/* -------------------------------------------------------------- the ending */

function Ending({ trip }: { trip: Trip }) {
  const stops = trip.days.flatMap(d => d.stops)
  const moving = trip.days.reduce((s, d) =>
    s + d.legs.reduce((n, l) => n + l.durationSec, 0) / 60 + (d.approach?.durationSec ?? 0) / 60, 0)
  const staying = stops.reduce((s, x) => s + x.visitMin, 0)
  return (
    <Page title="The end of the trip" sub={`${trip.days.length} day${trip.days.length === 1 ? '' : 's'}`} className="jr-ending">
      <p className="jr-hand big">{trip.days.length === 1 ? 'One day' : `${trip.days.length} days`} in {trip.city}, {stops.length} places.</p>
      <ul className="jr-stats">
        <li><b>{stops.length}</b><span>stops</span></li>
        <li><b>{tripKm(trip).toFixed(1)}</b><span>km</span></li>
        <li><b>{Math.round(moving)}</b><span>min {TRANSPORT_LABEL[trip.wish.transport].toLowerCase()}</span></li>
        <li><b>{Math.round(staying / 60 * 10) / 10}</b><span>hours there</span></li>
      </ul>
      <ol className="jr-passport" aria-label="Stamps">
        {trip.days.map(d => (
          <li key={d.number} style={{ '--c': colourOf(d.number - 1), '--rot': `${((d.number * 37) % 11) - 5}deg` } as React.CSSProperties}>
            <Mark name={markFor(d.stops[0]?.name ?? d.title, d.number)} size={26} />
            <b>Day {d.number}</b><span>{d.title}</span>
          </li>
        ))}
      </ol>
      {trip.days[0] && <RouteSheet plan={trip.days[0]} active={-1} />}
      <p className="jr-caption">The first day's line, as a keepsake. A diagram of what followed what, not a map.</p>
    </Page>
  )
}

function BeforeYouGo({ trip }: { trip: Trip }) {
  const tips: { mark: Parameters<typeof Mark>[0]['name']; text: string }[] = []
  const stops = trip.days.flatMap(d => d.stops)
  const first = trip.days[0]?.stops[0]
  const silent = stops.filter(s => !s.sources.length)
  const estimated = trip.days.flatMap(d => d.legs).filter(l => l.estimated)
  const mute = stops.filter(s => s.beats.some(b => !b.audioUrl))

  if (first) tips.push({ mark: 'sun', text: `${first.name} opens the trip at ${first.arrival}. Check its hours before you set out — the book cannot.` })
  if (trip.stays[0]) tips.push({ mark: 'station', text: `${trip.stays[0].name} is the bed the concierge chose, on distance from your days. Nothing here says it is available, or what it costs.` })
  if (trip.days.some(d => d.tables.length)) tips.push({ mark: 'market', text: 'Tables are OpenStreetMap entries near where you will be at that hour. Hours are quoted from tags and may be wrong; ring ahead if it matters.' })
  if (tripKm(trip) > 3 && trip.wish.transport === 'walk')
    tips.push({ mark: 'fern', text: `${tripKm(trip).toFixed(1)} km on foot across the trip. The shoes matter more than the bag.` })
  if (silent.length)
    tips.push({ mark: 'key', text: `${silent.map(s => s.name).join(' and ')} ${silent.length === 1 ? 'has' : 'have'} no Wikipedia article — the guide will stand there quietly.` })
  if (estimated.length)
    tips.push({ mark: 'clock', text: `${estimated.length} leg${estimated.length === 1 ? ' was' : 's were'} timed by straight line; the router did not answer. Allow a little more.` })
  if (mute.length)
    tips.push({ mark: 'moon', text: 'Some beats have no audio — the voice failed for them, and their lengths are estimated from the words.' })
  tips.push({ mark: 'bloom', text: 'Each day can be flown from its own page, over the real city, saying these same sentences.' })

  return (
    <Page title="Before you go" className="jr-before">
      <ul className="jr-tips">{tips.map((t, i) => <li key={i}><Mark name={t.mark} size={20} /><span>{t.text}</span></li>)}</ul>
      <ul className="jr-colophon jr-colophon-small">
        <li>
          Places: <b>{trip.provenance.places}</b> · beds and tables: <b>{trip.provenance.lodging}</b> ·
          roads and times: <b>{trip.provenance.router}</b> · photographs: <b>Wikimedia Commons</b> ·
          the city itself: <b>Google photorealistic 3D tiles</b>.
        </li>
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

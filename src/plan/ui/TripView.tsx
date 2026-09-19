import { Fragment, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { TRANSPORT_LABEL, type Claim, type Day, type LatLon, type Stay, type Stop, type Table, type Trip } from '../../types'
import { dayColour } from '../../ui/palette'
import Icon, { type IconName } from '../../ui/Icon'

/* The trip, read. One panel of glass over the city it describes: a header with the
 * shape of the whole thing, a tab per day, the place to sleep, and then the day as
 * a timeline. Each stop is a card with its photograph, when you arrive, how long
 * you stay and, opened, the very words the guide will say in the air, each sentence
 * marked with where it came from. Between stops sits the journey, in the mode it
 * was actually priced in; meals sit where the clock left room for them.
 *
 * Nothing here is written for this screen: the cards print the same fields the
 * flythrough flies, so what is read is what is heard. */

const km = (m: number) => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`)
const mins = (s: number) => `${Math.max(1, Math.round(s / 60))} min`


export default function TripView({ trip, day, onDay, onFly, onFocus, planning, onBook, onShuffleStay, shufflingStay }: {
  trip: Trip
  day: number | 'all'
  onDay: (d: number | 'all') => void
  onFly: (d: Day) => void
  onFocus: (at: LatLon | null) => void
  planning?: boolean
  /** Open the same trip as a paper book: a spread per day, the map that
      unfolds, the bed's page, the stops' pages. */
  onBook?: () => void
  /** Sleep somewhere else. Every day leaves from the bed and comes back to it,
      so this re-routes and re-times the whole trip around the new one. */
  onShuffleStay?: () => void
  shufflingStay?: boolean
}) {
  const shown = day === 'all' ? trip.days : trip.days.filter(d => d.number === day)
  const places = trip.days.reduce((n, d) => n + d.stops.length, 0)
  const distance = trip.days.reduce((n, d) => n + d.legs.reduce((a, l) => a + l.distanceM, 0), 0)
  const stay = trip.stays[0]

  return (
    <motion.aside className="t-panel o-glass" initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .8, ease: [.22, .9, .24, 1] }}>
      <header className="t-head">
        <p className="o-eyebrow">{trip.days.length === 1 ? 'A day in' : `${trip.days.length} days in`}</p>
        <h1 className="o-title">{trip.city}</h1>
        <p className="t-stats">{places} places<i />{km(distance)} on the ground<i />{trip.wish.startAt}–{trip.wish.endAt}</p>
        {trip.preface && <p className="t-preface">{trip.preface}</p>}
        {onBook && (
          <button type="button" className="o-btn small t-book-btn" onClick={onBook} disabled={planning}>
            <Icon name="spark" size={14} /> Open the journal
          </button>
        )}
      </header>

      {trip.days.length > 1 && (
        <nav className="t-tabs" aria-label="Days">
          {trip.days.map(d => (
            <button key={d.number} type="button" className="o-chip" aria-pressed={day === d.number} onClick={() => onDay(d.number)} style={{ ['--c' as string]: dayColour(d.number - 1) }}>
              <i />Day {d.number}
            </button>
          ))}
          <button type="button" className="o-chip" aria-pressed={day === 'all'} onClick={() => onDay('all')}>All</button>
        </nav>
      )}

      {stay && <StayCard stay={stay} onShuffle={onShuffleStay} busy={shufflingStay} />}

      <div className="t-days">
        {shown.map(d => <DayBlock key={d.number} day={d} many={trip.days.length > 1} stay={stay} onFly={onFly} onFocus={onFocus} planning={planning} />)}
      </div>

      <footer className="t-foot">
        Places from Wikipedia, chosen by a model and verified by code · beds and tables from OpenStreetMap · routes and times from Google Routes ·
        the guide may only say what a cited source says.
      </footer>
    </motion.aside>
  )
}

function StayCard({ stay, onShuffle, busy }: { stay: Stay; onShuffle?: () => void; busy?: boolean }) {
  const t = stay.tags ?? {}
  const facts = [
    stay.address, t.phone || t['contact:phone'],
    (t.website || t['contact:website'] || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
    t.wheelchair === 'yes' ? 'step-free' : '', t.internet_access && t.internet_access !== 'no' ? 'wi-fi' : '',
  ].filter(Boolean)
  return (
    <section className="t-stay">
      <span className="t-stay-mark" aria-hidden><Icon name="bed" size={20} /></span>
      <div>
        <p className="o-eyebrow">Where you sleep</p>
        <h3>{stay.name}</h3>
        <p>{stay.why}</p>
        {facts.length > 0 && <p className="t-stay-facts">{facts.join(' · ')}</p>}
        {/* One bed, not a shortlist: the arithmetic already knows which is
            nearest the days. This is for when the person wants somewhere else
            anyway — a different street, a different kind of room — and it
            re-routes every day around whatever comes back. */}
        {onShuffle && (
          <button type="button" className="o-btn quiet small t-stay-swap" onClick={onShuffle} disabled={busy}>
            <Icon name="again" size={13} /> {busy ? 'Finding another…' : 'Try another'}
          </button>
        )}
        {/* The street outside, as someone photographed it: the neighbourhood,
            never the rooms, and said so. */}
        {stay.photos?.length > 0 && (
          <div className="t-stay-photos">
            {stay.photos.slice(0, 3).map((ph, i) => (
              <a key={i} href={ph.pageUrl} target="_blank" rel="noreferrer" title={`Nearby · ${ph.credit}`}>
                <img src={ph.url} alt="" loading="lazy" />
              </a>
            ))}
          </div>
        )}
      </div>
      <a href={stay.source.url} target="_blank" rel="noreferrer" aria-label="Source on OpenStreetMap"><Icon name="arrow" size={14} /></a>
    </section>
  )
}

function DayBlock({ day, many, stay, onFly, onFocus, planning }: {
  day: Day; many: boolean; stay?: Stay; onFly: (d: Day) => void; onFocus: (at: LatLon | null) => void; planning?: boolean
}) {
  const c = dayColour(day.number - 1)
  const tableAfter = (s: Stop): Table[] => day.tables.filter(t => t.nearStopId === s.id)
  return (
    <section className="t-day" style={{ ['--c' as string]: c }}>
      <div className="t-day-head">
        <div>
          {many && <p className="t-day-no"><i />Day {day.number}</p>}
          <h2 className="o-title">{many ? day.title : 'The day'}</h2>
          <p className="t-epigraph">{day.epigraph}</p>
        </div>
        <button type="button" className="o-btn primary" disabled={planning} onClick={() => onFly(day)}>Fly this day <Icon name="arrow" size={15} /></button>
      </div>

      {many && day.preface && <p className="t-preface small">{day.preface}</p>}

      <ol className="t-line">
        {day.approach && stay && <li className="t-leg"><Leg leg={day.approach} label={`From ${stay.name}`} /></li>}
        {day.stops.map((s, i) => (
          <Fragment key={s.id}>
            <li className="t-stop-wrap"><StopCard stop={s} index={i} onFocus={onFocus} /></li>
            {tableAfter(s).map(t => <li key={t.id} className="t-meal"><Meal table={t} /></li>)}
            {day.legs[i] && <li className="t-leg"><Leg leg={day.legs[i]} /></li>}
          </Fragment>
        ))}
        {/* Home again, and dinner near the bed: the day is a loop, not a line. */}
        {day.back && stay && <li className="t-leg"><Leg leg={day.back} label={`Back to ${stay.name}`} /></li>}
        {stay && day.tables.filter(t => t.nearStopId === stay.id).map(t => <li key={t.id} className="t-meal"><Meal table={t} /></li>)}
      </ol>
    </section>
  )
}

function Leg({ leg, label }: { leg: Day['legs'][number]; label?: string }) {
  return (
    <div className="t-leg-in">
      <span className="t-leg-icon" aria-hidden><Icon name={leg.transport as IconName} size={15} /></span>
      <span>{label ? `${label} · ` : ''}{mins(leg.durationSec)} · {km(leg.distanceM)} · {TRANSPORT_LABEL[leg.transport].toLowerCase()}{leg.estimated ? ' · estimated' : ''}</span>
    </div>
  )
}

function Meal({ table }: { table: Table }) {
  return (
    <div className="t-meal-in">
      <span className="t-meal-icon" aria-hidden><Icon name={table.meal === 'dinner' ? 'moon' : 'fork'} size={17} /></span>
      <div>
        <b>{table.meal[0].toUpperCase() + table.meal.slice(1)} · {table.name}</b>
        <span>{[table.cuisine, table.walkMin != null ? `${table.walkMin} min from here` : ''].filter(Boolean).join(' · ') || table.why}</span>
      </div>
      <a href={table.source.url} target="_blank" rel="noreferrer" aria-label="Source on OpenStreetMap"><Icon name="arrow" size={14} /></a>
    </div>
  )
}

function StopCard({ stop, index, onFocus }: { stop: Stop; index: number; onFocus: (at: LatLon | null) => void }) {
  const [open, setOpen] = useState(false)
  const traced = stop.beats.flatMap(b => b.claims ?? []).filter(c => !c.framing)
  return (
    <motion.article className="t-stop" initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '0px 0px -8% 0px' }}
      transition={{ duration: .6, ease: [.22, .9, .24, 1] }} onMouseEnter={() => onFocus({ lat: stop.lat, lon: stop.lon })} onMouseLeave={() => onFocus(null)}>
      <span className="t-node" aria-hidden><b>{index + 1}</b></span>
      {stop.photo && (
        <figure className="t-photo">
          <img src={stop.photo.url} alt={stop.name} loading="lazy" />
          <figcaption><a href={stop.photo.pageUrl} target="_blank" rel="noreferrer">{stop.photo.credit}</a></figcaption>
        </figure>
      )}
      <div className="t-stop-body">
        <div className="t-when"><b>{stop.arrival}</b><span>· about {stop.visitMin} min{stop.asked ? ' · you asked for this' : ''}</span></div>
        <h3>{stop.name}</h3>
        {stop.blurb && <p className="t-blurb">{stop.blurb}</p>}
        <p className="t-fits">{stop.askedAs ? `You pinned ${stop.askedAs}; this is ${stop.movedM} m away and worth the flight. ` : ''}{stop.fits}</p>

        {stop.beats.length > 0 && (
          <>
            <button type="button" className="t-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
              <span>{open ? 'Hide' : 'Read'} what the guide will say</span>
              <em>{stop.beats.length} moment{stop.beats.length === 1 ? '' : 's'}{traced.length ? ` · ${traced.filter(c => c.supported).length}/${traced.length} lines sourced` : ''}</em>
            </button>
            <AnimatePresence initial={false}>
              {open && (
                <motion.ol className="t-beats" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: .45, ease: [.22, .9, .24, 1] }}>
                  {stop.beats.map((b, i) => (
                    <li key={i}>
                      <span className="t-beat-mark" aria-hidden>{b.targetId ? '◎' : '●'}</span>
                      <p>
                        {b.claims?.length ? <Sentences claims={b.claims} /> : b.text}
                        <small>{b.targetId ? `looking at ${stop.targets.find(t => t.id === b.targetId)?.name ?? 'something nearby'} · ` : ''}{b.durationSec.toFixed(0)}s{b.audioUrl ? '' : ' · voice not recorded'}</small>
                      </p>
                    </li>
                  ))}
                </motion.ol>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </motion.article>
  )
}

/** Narration with its receipts: hover or focus a sentence to read the line it rests on. */
function Sentences({ claims }: { claims: Claim[] }) {
  return <>{claims.map((c, i) => c.framing ? <span key={i}>{c.text} </span> : (
    <span key={i} className={`t-claim ${c.supported ? 'is-traced' : 'is-unverified'}`} tabIndex={0}
      title={c.supported ? `“${c.quote}” — ${c.source?.label}` : 'Could not be traced to the text the guide was given'}>
      {c.text}{c.supported && c.source && <a className="t-cite" href={c.source.url} target="_blank" rel="noreferrer" aria-label={`Source: ${c.source.label}`}>↗</a>}{' '}
    </span>
  ))}</>
}

import { Mark } from './Marks'

/* The front page.
 *
 * It has one job: say what this is, in the voice of the thing it is, and get
 * out of the way. No feature grid, no marketing — the three panels are the
 * three phases the app actually has, in order, so the page doubles as the
 * only explanation anyone needs of what is about to happen to them.
 */

const STAGES: { mark: Parameters<typeof Mark>[0]['name']; title: string; text: string }[] = [
  { mark: 'compass', title: 'The desk', text: 'Name a city. Pin the places you already want, or leave it to the scout. Hours, pace, who is going — the map shows every decision as you make it.' },
  { mark: 'key', title: 'The book', text: 'A crew reads up on each place and writes the day out: a page per stop, photographs and sources, the road drawn from the router’s own geometry.' },
  { mark: 'sun', title: 'The flight', text: 'Then you fly it — over the real city in photorealistic 3D, with the guide speaking at each stop and the camera turning to what it names.' },
]

export default function Home({ onStart }: { onStart: () => void }) {
  return (
    <div className="orion-home">
      <header>
        <p className="jr-kicker">A day, planned and then flown</p>
        <h1>Orion</h1>
        <p className="orion-home-lede">
          Name a place. An AI crew plans your day on real streets, then a guide flies you through it
          over the real city.
        </p>
      </header>

      <ol className="orion-home-stages">
        {STAGES.map((s, i) => (
          <li key={s.title}>
            <span className="orion-home-no">{i + 1}</span>
            <Mark name={s.mark} size={30} className="fade" />
            <h2>{s.title}</h2>
            <p>{s.text}</p>
          </li>
        ))}
      </ol>

      <button className="jr-btn primary big" onClick={onStart}>
        <Mark name="key" size={16} /> Plan a day
      </button>

      <p className="orion-home-fine">
        Places from OpenStreetMap · descriptions and photographs from Wikipedia and Wikimedia Commons ·
        roads and times from Google Routes · the city itself in Google photorealistic 3D tiles.
        Nothing the guide says comes from anywhere but those sources.
      </p>
    </div>
  )
}

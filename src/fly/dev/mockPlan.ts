import type { Beat, LatLon, Leg, Plan, Stop } from '../../types'

/* DEV ONLY. A hand-made stand-in for what planning will produce, so the
 * flythrough can be built without waiting on it. Stop coordinates are
 * approximate (from memory); leg polylines are real Routes API walks, the narration is placeholder text,
 * and audio is absent, so beat lengths are estimates. Never shown to users;
 * the real Plan comes from src/plan. */

const beat = (text: string, targetId?: string, durationSec = 6): Beat => ({ text, targetId, audioUrl: null, durationSec })
const ll = (lat: number, lon: number): LatLon => ({ lat, lon })

const stop = (id: string, name: string, at: LatLon, targets: Stop['targets'], beats: Beat[]): Stop => ({
  id, name, ...at, blurb: '[mock] placeholder blurb', photo: null, visitMin: 15,
  sources: [{ kind: 'wikipedia', label: `Wikipedia: ${name}`, url: 'https://en.wikipedia.org' }], targets, beats,
})
const target = (id: string, name: string, at: LatLon) => ({
  id, name, ...at, summary: '[mock]', source: { kind: 'wikipedia' as const, label: name, url: 'https://en.wikipedia.org' },
})

const notreDame = ll(48.85296, 2.34990)
const pontNeuf = ll(48.85700, 2.34130)
const louvre = ll(48.86100, 2.33650)
const carrousel = ll(48.86240, 2.33300)

const stops: Stop[] = [
  stop('notre-dame', 'Notre-Dame de Paris', notreDame,
    [target('point-zero', 'Point zéro', ll(48.85340, 2.34880)), target('square', 'Square Jean XXIII', ll(48.85250, 2.35130))],
    [beat('[mock] This is the cathedral, standing on the eastern tip of the island.'),
     beat('[mock] Just in front of it, a small plaque marks the centre of the road network.', 'point-zero'),
     beat('[mock] Behind the apse there is a quiet garden.', 'square')]),
  stop('pont-neuf', 'Pont Neuf', pontNeuf,
    [target('henri-iv', 'Statue of Henri IV', ll(48.85690, 2.34110))],
    [beat('[mock] The oldest standing bridge across the Seine in the city.'),
     beat('[mock] At the point of the island, a rider looks back along the river.', 'henri-iv', 7)]),
  stop('louvre', 'Louvre Pyramid', louvre,
    [target('carrousel', 'Arc du Carrousel', carrousel)],
    [beat('[mock] A glass pyramid in the courtyard of the old palace.'),
     beat('[mock] Beyond it, a small triumphal arch marks the way to the gardens.', 'carrousel')]),
]

// Real walking routes from the Google Routes API (computeRoutes, WALK), fetched once and pasted in,
// so this file needs no key at runtime. Stops are still approximate coordinates.
const legs: Leg[] = [
  { fromStopId: "notre-dame", toStopId: "pont-neuf", distanceM: 861, durationSec: 727,
    polyline: [ll(48.85328, 2.35013), ll(48.85354, 2.34926), ll(48.85357, 2.34902), ll(48.85362, 2.34892), ll(48.85364, 2.34877), ll(48.85371, 2.34856), ll(48.85369, 2.34833), ll(48.85385, 2.34784), ll(48.85376, 2.34773), ll(48.85357, 2.34759), ll(48.85353, 2.34749), ll(48.85352, 2.34734), ll(48.85353, 2.34725), ll(48.85364, 2.34731), ll(48.85365, 2.34726), ll(48.85367, 2.34727), ll(48.85369, 2.34708), ll(48.85362, 2.34706), ll(48.85372, 2.34673), ll(48.85396, 2.34608), ll(48.85405, 2.34596), ll(48.85407, 2.34579), ll(48.85434, 2.34506), ll(48.85438, 2.34510), ll(48.85449, 2.34486), ll(48.85444, 2.34480), ll(48.85487, 2.34384), ll(48.85494, 2.34386), ll(48.85528, 2.34326), ll(48.85532, 2.34312), ll(48.85547, 2.34295), ll(48.85541, 2.34282), ll(48.85658, 2.34153), ll(48.85681, 2.34127), ll(48.85671, 2.34112), ll(48.85678, 2.34094), ll(48.85702, 2.34113), ll(48.85695, 2.34131)] },
  { fromStopId: "pont-neuf", toStopId: "louvre", distanceM: 847, durationSec: 676,
    polyline: [ll(48.85700, 2.34126), ll(48.85702, 2.34113), ll(48.85715, 2.34125), ll(48.85725, 2.34138), ll(48.85739, 2.34142), ll(48.85841, 2.34229), ll(48.85847, 2.34229), ll(48.85892, 2.33982), ll(48.85897, 2.33962), ll(48.85915, 2.33968), ll(48.85914, 2.33976), ll(48.86000, 2.34022), ll(48.86033, 2.33872), ll(48.86027, 2.33863), ll(48.86026, 2.33849), ll(48.86033, 2.33840), ll(48.86041, 2.33839), ll(48.86090, 2.33635), ll(48.86102, 2.33642)] },
]

export const mockPlan: Plan = {
  id: 'mock-paris', city: 'Paris', origin: ll(48.85700, 2.34130), mode: 'short', stops, legs,
  generatedAt: new Date(0).toISOString(),
  provenance: { router: 'code', timekeeper: 'code', scout: 'mock', critic: 'mock', narrator: 'mock', tts: 'none' },
}

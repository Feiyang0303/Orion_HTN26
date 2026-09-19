import type { Beat, LatLon, Leg, Plan, Stop } from '../../types'

/* DEV ONLY. A hand-made stand-in for what planning will produce, so the
 * flythrough can be built without waiting on it. Coordinates and waypoints are
 * approximate (from memory, not routed), the narration is placeholder text,
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

// Waypoints follow the river side of the island, then the Quai du Louvre; rough on purpose.
const legs: Leg[] = [
  { fromStopId: 'notre-dame', toStopId: 'pont-neuf', distanceM: 900, durationSec: 650,
    polyline: [notreDame, ll(48.85400, 2.34700), ll(48.85480, 2.34450), ll(48.85580, 2.34250), pontNeuf] },
  { fromStopId: 'pont-neuf', toStopId: 'louvre', distanceM: 650, durationSec: 470,
    polyline: [pontNeuf, ll(48.85800, 2.34000), ll(48.85920, 2.33850), ll(48.86040, 2.33740), louvre] },
]

export const mockPlan: Plan = {
  id: 'mock-paris', city: 'Paris', origin: ll(48.85700, 2.34130), mode: 'short', stops, legs,
  generatedAt: new Date(0).toISOString(),
  provenance: { router: 'code', timekeeper: 'code', scout: 'mock', critic: 'mock', narrator: 'mock', tts: 'none' },
}

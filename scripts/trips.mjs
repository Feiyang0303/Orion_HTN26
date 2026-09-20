/* Saved trips: the trip and the narration that was recorded for it.
 *
 * MongoDB (MONGODB_URI) when it is configured, so a trip outlives the laptop that
 * planned it and opens from any device. Without it, the same routes are served from
 * memory, so everything (including sending a trip to a headset) works in development,
 * it just forgets when the proxy restarts. The page is told which one it got.
 *
 * For now the journal is deliberately global: every client connected to this
 * service sees and can change the same collection of trips.
 */
import { MongoClient, Binary } from 'mongodb'

const ID = /^[a-z0-9][a-z0-9-]{5,47}$/
const NAME = /^[\w.-]{1,64}$/
const MAX_TRIP_BYTES = 6e6
const MAX_CLIP_BYTES = 8e6

const summary = d => ({
  id: d._id, city: d.city, days: d.days, places: d.places, updatedAt: d.updatedAt,
})

/* ---------------------------------------------------------------- backends -- */

function memoryBackend() {
  const trips = new Map(), clips = new Map()
  let current = ''
  return {
    async setCurrent(id) { current = id },
    async getCurrent() { return current },
    persistent: false,
    async get(id) { return trips.get(id) ?? null },
    async put(doc) {
      const prev = trips.get(doc._id)
      trips.set(doc._id, { ...doc, createdAt: prev?.createdAt ?? doc.updatedAt })
      if (trips.size > 200) trips.delete(trips.keys().next().value)
    },
    async list() { return [...trips.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50) },
    async remove(id) { trips.delete(id); for (const k of clips.keys()) if (k.startsWith(`${id}/`)) clips.delete(k) },
    async putClip(id, name, buf) { clips.set(`${id}/${name}`, buf) },
    async getClip(id, name) { return clips.get(`${id}/${name}`) ?? null },
  }
}

function mongoBackend(uri) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 })
  let ready
  const db = () => ready ??= client.connect().then(async () => {
    const d = client.db(process.env.MONGODB_DB || 'orion')
    await d.collection('trips').createIndex({ updatedAt: -1 })
    await d.collection('clips').createIndex({ tripId: 1 })
    return d
  }).catch(e => { ready = undefined; throw e })
  return {
    persistent: true,
    async get(id) { return (await db()).collection('trips').findOne({ _id: id }) },
    async put(doc) {
      const { createdAt: _c, ...rest } = doc
      await (await db()).collection('trips').updateOne({ _id: doc._id }, { $set: rest, $setOnInsert: { createdAt: doc.updatedAt } }, { upsert: true })
    },
    async list() {
      return (await db()).collection('trips').find({}, { projection: { body: 0 } }).sort({ updatedAt: -1 }).limit(50).toArray()
    },
    async remove(id) {
      const d = await db()
      await d.collection('trips').deleteOne({ _id: id })
      await d.collection('clips').deleteMany({ tripId: id })
    },
    async putClip(id, name, buf) {
      await (await db()).collection('clips').updateOne({ _id: `${id}/${name}` }, { $set: { tripId: id, data: new Binary(buf) } }, { upsert: true })
    },
    async getClip(id, name) {
      const c = await (await db()).collection('clips').findOne({ _id: `${id}/${name}` })
      return c ? Buffer.from(c.data.buffer) : null
    },
    async setCurrent(id) { await (await db()).collection('meta').updateOne({ _id: 'vr-current' }, { $set: { id } }, { upsert: true }) },
    async getCurrent() { return (await (await db()).collection('meta').findOne({ _id: 'vr-current' }))?.id ?? '' },
  }
}

/* ------------------------------------------------------------------ routes -- */

export function tripRoutes({ json, readJson, readBuf, HttpError }) {
  const uri = process.env.MONGODB_URI
  const store = uri ? mongoBackend(uri) : memoryBackend()
  if (!uri) console.log('trips: MONGODB_URI is not set, so saved trips are kept in memory and lost when this restarts')

  const q = req => new URL(req.url, 'http://x').searchParams
  const idOf = req => { const id = q(req).get('id') ?? ''; if (!ID.test(id)) throw new HttpError(400, 'bad trip id'); return id }

  return {
    persistent: store.persistent,
    routes: {
      /** Save (create or replace) a trip. Body: { trip, mode, origin }. */
      'POST /api/trips/save': async (req, res) => {
        const id = idOf(req)
        const body = await readJson(req, MAX_TRIP_BYTES)
        if (!body.trip?.days || !Array.isArray(body.trip.days)) throw new HttpError(400, 'not a trip')
        const updatedAt = Date.now()
        await store.put({
          _id: id, updatedAt,
          city: String(body.trip.city ?? ''), days: body.trip.days.length,
          places: body.trip.days.reduce((n, d) => n + (d.stops?.length ?? 0), 0),
          body: { trip: body.trip, mode: body.mode, origin: body.origin },
        })
        json(res, 200, { id, updatedAt, persistent: store.persistent })
      },
      /** Anyone with the id may read it. */
      'GET /api/trips/get': async (req, res) => {
        const d = await store.get(idOf(req))
        if (!d) throw new HttpError(404, 'no such trip')
        json(res, 200, { id: d._id, updatedAt: d.updatedAt, ...d.body })
      },
      'GET /api/trips/list': async (_req, res) => {
        json(res, 200, { persistent: store.persistent, trips: (await store.list()).map(summary) })
      },
      'DELETE /api/trips/delete': async (req, res) => {
        const id = idOf(req), d = await store.get(id)
        if (d) await store.remove(id)
        json(res, 200, { ok: true })
      },
      /** Which trip /vr shows. Setting it replaces the last one: there is one headset session at a time. It is kept
          with the trips and not in this process, because when hosted the headset's request may reach another one. */
      'POST /api/vr/current': async (req, res) => {
        const id = idOf(req)
        if (!(await store.get(id))) throw new HttpError(404, 'no such trip')
        await store.setCurrent(id)
        json(res, 200, { id })
      },
      'GET /api/vr/current': async (_req, res) => {
        const id = await store.getCurrent()
        if (!id) throw new HttpError(404, 'nothing has been sent to VR yet')
        json(res, 200, { id })
      },
      'PUT /api/trips/clip': async (req, res) => {
        const name = q(req).get('name') ?? ''
        if (!NAME.test(name)) throw new HttpError(400, 'bad clip name')
        await store.putClip(idOf(req), name, await readBuf(req, MAX_CLIP_BYTES))
        json(res, 200, { ok: true })
      },
      'GET /api/trips/clip': async (req, res) => {
        const name = q(req).get('name') ?? ''
        if (!NAME.test(name)) throw new HttpError(400, 'bad clip name')
        const b = await store.getClip(idOf(req), name)
        if (!b) throw new HttpError(404, 'no such clip')
        res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': b.length, 'cache-control': 'public, max-age=86400' }).end(b)
      },
    },
  }
}

import { useCallback, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { XR } from '@react-three/xr'
import * as THREE from 'three'
import type { Day } from '../types'
import { probeTiles } from '../fly/GoogleTiles'
import { loadDays } from './share'
import { store } from './store'
import Scene, { FAR } from './Scene'
import './vr.css'

/* The page a headset opens: /?vr=<id>. Before the session it is a door (the city, the
 * trip, one button); in the session the whole page is the Canvas. On a laptop the same
 * scene is shown flat and can be looked around with the mouse, which is how it is developed
 * and how anyone without a headset can see what it is. */

export default function VRPage({ id }: { id: string }) {
  const [trip, setTrip] = useState<{ city: string; days: Day[] } | null>(null)
  const [error, setError] = useState('')
  const [xr, setXr] = useState<'checking' | 'yes' | 'no'>('checking')
  const [entering, setEntering] = useState(false)
  const [ready, setReady] = useState(false)
  const onReady = useCallback((r: boolean) => setReady(r), [])

  useEffect(() => {
    let live = true
    loadDays(id).then(t => live && setTrip(t)).catch(e => live && setError(`Couldn't open this trip (${e instanceof Error ? e.message : e}).`))
    probeTiles().then(r => { if (live && !r.ok) setError(r.why) })
    navigator.xr?.isSessionSupported('immersive-vr').then(ok => live && setXr(ok ? 'yes' : 'no'), () => live && setXr('no'))
    if (!navigator.xr) setXr('no')
    return () => { live = false }
  }, [id])

  const enter = async () => {
    setEntering(true)
    try { await store.enterVR() } catch (e) { setError(`Couldn't start VR: ${e instanceof Error ? e.message : e}`) } finally { setEntering(false) }
  }

  if (error) return <div className="vr-door"><p className="vr-error" role="alert">{error}</p></div>
  return (
    <div className="vr">
      {/* Near and far are handed to the headset's runtime, which measures them in the person's own metres: the scale is 1, so they are the city's too. */}
      {trip && (
        <Canvas className="vr-canvas" dpr={[1, 1.5]} camera={{ fov: 50, near: .3, far: FAR, position: [0, 1800, 2400] }}
          gl={{ antialias: true, toneMapping: THREE.NeutralToneMapping }}>
          <XR store={store}>
            <Scene days={trip.days} store={store} onReady={onReady} />
            <FlatView />
          </XR>
        </Canvas>
      )}
      <div className="vr-door o-glass">
        <p className="o-eyebrow">Orion · VR</p>
        <h1 className="o-title">{trip ? trip.city : 'Opening the trip…'}</h1>
        <p className="vr-sub">{trip ? `${trip.days.length === 1 ? 'A day' : `${trip.days.length} days`}, flown at full size, with the city around you.` : ' '}</p>
        <button className="o-btn primary" disabled={!ready || xr !== 'yes' || entering} onClick={enter}>{entering ? 'Starting…' : ready ? 'Enter VR' : 'Loading the city…'}</button>
        <p className="vr-note">{
          xr === 'checking' ? 'Checking for a headset…' :
          xr === 'no' ? (window.isSecureContext ? 'No headset found here. This is the flat view: drag to look around.' : 'VR needs a secure (https) address. Run “npm run vr” on the laptop and open the https link it shows.') :
          'Sit down for this one: the guide flies you through the city. A or X pauses it, and “Ride: blinks” on the panel at your lap stops all the motion.'}</p>
      </div>
    </div>
  )
}

/** On a screen, an orbit camera that the scene keeps where a head would be: dragging turns the head. */
function FlatView() {
  return <OrbitControls makeDefault enableZoom={false} enablePan={false} rotateSpeed={-.5} />
}

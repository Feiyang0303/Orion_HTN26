import { useCallback, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { XR } from '@react-three/xr'
import * as THREE from 'three'
import type { Day } from '../types'
import { probeTiles } from '../fly/GoogleTiles'
import { loadDays } from './share'
import { store } from './store'
import Scene from './Scene'
import './vr.css'

/* The page a headset opens: /?vr=<id>. Before the session it is a door (the city, the
 * trip, one button); in the session the whole page is the Canvas. On a laptop the same
 * scene is shown flat and can be orbited with the mouse, which is how it is developed
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
    loadDays(id).then(t => live && setTrip(t)).catch(e => live && setError(`Couldn't open this trip (${e instanceof Error ? e.message : e}). Is the laptop's server still running?`))
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
      {trip && (
        <Canvas className="vr-canvas" dpr={[1, 1.5]} camera={{ fov: 50, near: 20, far: 60000, position: [0, 1800, 2400] }}
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
        <p className="vr-sub">{trip ? `${trip.days.length === 1 ? 'A day' : `${trip.days.length} days`}, laid out as a model on the table in front of you.` : ' '}</p>
        <button className="o-btn primary" disabled={!ready || xr !== 'yes' || entering} onClick={enter}>{entering ? 'Starting…' : ready ? 'Enter VR' : 'Loading the city…'}</button>
        <p className="vr-note">{
          xr === 'checking' ? 'Checking for a headset…' :
          xr === 'no' ? (window.isSecureContext ? 'No headset found here. This is the flat view: drag to look around.' : 'VR needs a secure (https) address. Run “npm run vr” on the laptop and open the https link it shows.') :
          'Put the headset on after pressing the button. Stand or sit; you will not be moved.'}</p>
      </div>
    </div>
  )
}

/** On a screen, an orbit camera aimed at where the table would be. */
function FlatView() {
  return <OrbitControls makeDefault enableDamping target={[0, 0, 0]} maxPolarAngle={Math.PI * .49} />
}

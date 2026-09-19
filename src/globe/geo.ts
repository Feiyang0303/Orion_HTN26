import * as THREE from 'three'

/** A point on a unit sphere: y is up, longitude 0 is +z... chosen so a city facing the
    camera is a plain rotation and the maths below stays symmetric. */
export function toSphere(lat: number, lon: number, r = 1): THREE.Vector3 {
  const phi = (90 - lat) * Math.PI / 180
  const theta = (lon + 180) * Math.PI / 180
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta))
}

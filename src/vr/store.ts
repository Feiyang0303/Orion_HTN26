import { createXRStore } from '@react-three/xr'

/* One store for the page: the DOM's "Enter VR" button and the scene's "Leave VR" button both talk to it. */
export const store = createXRStore({
  // The guide does the moving; hands and controllers only point at the panel.
  controller: { teleportPointer: false },
  hand: { teleportPointer: false },
  emulate: false,
  // A headset's GPU is a phone's. The edges of each lens are drawn coarser (they are blurred by the lens anyway),
  // and the session runs at 72 Hz, because a steady 72 is far kinder to a person than a 90 that keeps missing.
  foveation: 1,
  frameRate: 'low',
})

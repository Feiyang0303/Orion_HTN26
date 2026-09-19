import { createXRStore } from '@react-three/xr'

/* One store for the page: the DOM's "Enter VR" button and the scene's "Leave VR" button both talk to it. */
export const store = createXRStore({
  // The world is a model on a table; hands and controllers should be visible against it.
  controller: { teleportPointer: false },
  hand: { teleportPointer: false },
  emulate: false,
  foveation: 0,
  frameRate: 'high',
})

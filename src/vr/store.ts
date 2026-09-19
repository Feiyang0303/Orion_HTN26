import { createXRStore } from '@react-three/xr'

/* One store for the page: the DOM's "Enter VR" button and the scene's "Leave VR" button both talk to it. */
export const store = createXRStore({
  // The guide does the moving; hands and controllers only point at the panel.
  controller: { teleportPointer: false },
  hand: { teleportPointer: false },
  emulate: false,
  foveation: 0,
  frameRate: 'high',
})

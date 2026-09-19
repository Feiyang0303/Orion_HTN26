import { createXRStore } from '@react-three/xr'

/* One store for the page: the DOM's "Enter VR" button and the scene's "Leave VR" button both talk to it. */
export const store = createXRStore({
  // The guide does the moving; hands and controllers only point at the panel.
  controller: { teleportPointer: false },
  hand: { teleportPointer: false },
  emulate: false,
  foveation: 0,
  // Sharpness over smoothness: 90 Hz instead of 120 leaves the GPU room to draw more pixels than the default buffer has.
  frameRate: 'mid',
  frameBufferScaling: max => Math.min(max, 1.25),
})

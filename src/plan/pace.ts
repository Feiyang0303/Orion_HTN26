/* How much faster (and so higher) the flight plays every clip the goose
   speaks: see fly/quack.ts for the why. It lives here, away from the DOM,
   because clip durations are worked out from it at planning time, which
   also runs from node scripts. A pair with ELEVENLABS_GOOSE_SPEED on the
   proxy, which is its inverse — change one, change the other. */
export const QUACK_RATE = 1.22

# In-headset test script

Before you start: send a trip to VR from the web app (so `/api/vr/current` has one), be on Wi-Fi,
stand or sit with a little room. The lap console's bottom line shows `city NN% · NN fps`: read it
out when something looks wrong.

## 1. Is the city around me, and sharp, at the first stop?
1. Open **Orion** (Library → Unknown Sources). You should see a dusk sky, an amber ring on the
   floor under you, a caption panel low in front reading "Looking for your trip…", then
   "Finding <city>…".
2. Within ~10–20 s the view blinks to black and opens on the first stop. **Check:**
   - The real city is all around you, at real size, below and ahead; you are above the rooftops.
   - What the caption is about is in front of you and **sharp within ~8 s** (the guide waits up to
     that long before speaking). Note `city %` when the guide starts.
   - Turn right round: there is city behind you too (coarser is fine), fading into haze, no hard edge.
   - Tilt and roll your head: the horizon stays level and the world does not swim. The floor ring
     stays exactly under you.
   - **Google's attribution** is legible on the strip just under the caption panel.
   - `fps` reads 72 and stays there while you look around.
3. The guide speaks; the caption follows the voice; an amber beam and ring mark what it is describing.
   When it turns to a different thing, you are moved **behind a blink**, never slid.

## 2. The ride down a leg
4. When the stop's narration ends you blink onto the street line, ~55 m up, and move off following a
   small bright orb. **Check:** the start is gentle; the edges of your view darken as you speed up and
   open again as you slow; bends are taken slowly; you are never tilted; it never feels faster than a
   brisk car (30 m/s).
5. On a leg longer than 1 km there is **one blink in the middle**; you come out of it already moving.
6. At the far end you slow to a stop, blink, and are at the next stop's vantage.
   Walking legs are drawn as beads; driving/transit as a glowing ribbon.

## 3. Pause
7. Press **A** (or **X**): voice and clock stop, the console button reads "Play". Press again: the
   voice resumes mid-sentence, not from the start.
8. Pause **during a leg**: you ease to a stop rather than halting dead.
9. Point at the console in your lap and pull the trigger on **Next ›** and **‹ Prev**: each is a blink
   to that stop. Point at a numbered pin in the city and pull the trigger: same.

## 4. Blinks mode
10. Trigger **Ride: smooth** so it reads **Ride: blinks**. Let a stop finish: you should blink straight
    to the next stop with **no motion at all**. Switch back to smooth.

## 5. Exit
11. Hold **B** (or **Y**) for just under a second: the app closes. Reopen it; the **Leave** button on
    the console does the same. A quick tap of B does nothing.

## What to tell me
- Anything in step 2 that failed, with the `city % · fps` line.
- Whether stops feel the right distance away (they are at 0.62× the web's; "closer" / "farther" is enough).
- Any moment you felt a lurch, and what was happening (start of a leg, a bend, the mid-leg blink).
- If it is black forever: `adb logcat -s Unity` output.

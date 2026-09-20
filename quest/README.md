# Orion for Meta Quest

The native headset client for Orion. It plays the same guided flight as the web app's `/vr`, over
Google Photorealistic 3D Tiles, at a quality a browser on a Quest cannot reach. Open the app and it
plays the trip you last sent to VR from the web (`GET /api/vr/current`).

Unity 6.3 LTS (`6000.3.24f1`) · Cesium for Unity 1.25 · URP · OpenXR with Meta Quest Support.

> **Status: builds and boots; the city itself has not been seen yet.** See "What has been verified" at
> the bottom.

## How it is put together

The scene is empty. `App` builds everything when it loads, so there is nothing to click together.

| | |
|---|---|
| `Runtime/Flight/` | The flight's logic, with no scene in it: `Timeline` (one clock: dwell → travel → dwell…), `Comfort` (`Ride`: cruise ≤ 30 m/s, ≤ 3 m/s² along, ≤ 4 m/s² sideways, legs over 1 km flown only at their ends; `Follower`: position and yaw only, both capped), `Director` (frames a stop by its measured height), `LegStyle`, `RoutePath`, `Geo`, `Anchors`, `Trip`. |
| `Runtime/World/` | `City` (Cesium georeference + Google tileset, haze, sky, look-ahead cameras), `Ground` (lat/lon → world, height by rays onto the tiles' physics meshes), `Shots` (vantages at stops with a line-of-sight check; the corner-rounded trail down a leg), `Marks` (route, pins, guide orb, beam and ring). |
| `Runtime/Rig/` | The person's space: head camera, the fixed floor ring, `Veil` (blink + vignette), `Captions`, `Console`, `Credits` (Cesium's attribution overlay drawn into a texture, because a headset has no screen overlay), `Pointer`. |
| `Runtime/FlightDeck.cs` | The frame loop: clock, blinks, follower, narration, panels. The port of the web's `src/vr/Scene.tsx`. |
| `Editor/Build.cs` | Project setup (URP, Player, OpenXR, scene), key injection and the APK build, all from the command line. |
| `Tests/` | EditMode tests of the flight logic. |

Controls: **A / X** pause · hold **B / Y** 0.8 s to leave · point and pull the trigger on the lap
console (Prev · Pause/Play · Next · Ride: smooth/blinks · Day › · Leave) or on a stop's pin.

### Where this departs from the web version, on purpose
- **Stop vantages are closer**: `Frame.Closer = 0.62` of the web's distances and heights (a wide
  shot of a building-sized stop is ~165 m out and ~90 m up, not 270 / 150), never nearer than 70 m
  along the line of sight. A first guess for 1:1 scale; it has not been looked at in a headset.
- **No opening dive.** The web flight dives from its planning view. Here a day arrives in the dark at
  its first stop (the web's `/vr` also skips the dive).
- **An ungrounded point takes the height of the last ground found**, not the ellipsoid, which can be
  a long way under a city.
- Tile detail: one screen-space error for the whole flight (12 px), 64 px for what is out of view, fog culling beyond 4.5 km, a 512 MB tile cache.

## Never set a Cesium3DTileset property in a loop

Most of `Cesium3DTileset`'s setters (`maximumScreenSpaceError`, `url`, …) **reload the whole tileset**, and
each reload is a billable root request to Google (10,000 a day by default, then HTTP 429 for everyone
using the key, the web app included). An early version loosened the screen-space error on legs every
frame, and one headless play-mode run used the entire day's quota in under two minutes. `City` now sets
every property once, the app caps its frame rate outside a headset, a refusal is shown on the caption
panel, and `./build.sh smoke` stops at the first refusal.

Guards against a repeat, in order of how much they are worth:
1. **On the key, in Google Cloud (do this):** cap "3D Tiles root requests per day" (Map Tiles API → Quotas) at a few
   hundred, and add a Billing budget alert. Only this protects the web app too, and only this cannot be got round.
2. `City` keeps the `Cesium3DTileset` private; a test fails if any other runtime file names the type, or if `City` sets a
   tileset property outside `Make`. There is one `City` per run, enforced.
3. `TileBudget`: each device loads Google's tileset at most 40 times a (Pacific) day, counted before the request is made.
   Past that the app says so and does not ask. A normal run spends one.

## The Google tiles key

The build reads `VITE_GOOGLE_MAPS_KEY` from the web app's `.env` one directory up (or
`ORION_GOOGLE_TILES_KEY` if set) and writes it to `Assets/Orion/Resources/OrionConfig.json`, which is
gitignored. The build never logs or commits it. Cesium itself writes the tileset's address, key
included, into the Unity log when a load fails (`Logs/` is gitignored; `adb logcat` on the headset shows it too). Be aware it ships inside the APK, and the key is
currently unrestricted: keep the APK to yourselves, and cap the key's quota in Google Cloud.

Terms: Google's Map Tiles API policies list Cesium for Unity as a supported renderer. Tiles may not
be prefetched, stored or used offline (this app streams only), and the attribution must stay in
view (the strip under the captions).

## Setup (once)

Only you can do these:
1. **Unity Hub**: open it, sign in, and accept the (free) Personal licence.
2. **Quest developer mode**: in the Meta Horizon phone app → Devices → your headset → Developer Mode.
3. **USB**: plug the headset in, put it on, and allow USB debugging ("always allow").

Then, from a terminal:

```sh
"/Applications/Unity Hub.app/Contents/MacOS/Unity Hub" -- --headless install --version 6000.3.24f1 --architecture arm64
"/Applications/Unity Hub.app/Contents/MacOS/Unity Hub" -- --headless install-modules --version 6000.3.24f1 --module android android-sdk-ndk-tools android-open-jdk
```

(On this Mac the Hub's headless installer hung without downloading, so the editor, Android support,
OpenJDK 17, NDK r27c and the SDK pieces were fetched from the URLs Unity's release API lists and
unpacked into `/Applications/Unity/Hub/Editor/6000.3.24f1`, the layout the Hub uses.)

## Build, test, install

```sh
./build.sh test     # EditMode logic tests  → Logs/tests.xml
./build.sh apk      # sets the project up, injects the key, builds Build/orion-quest.apk
adb install -r Build/orion-quest.apk
adb shell am start -n com.orion.quest/com.unity3d.player.UnityPlayerGameActivity
adb logcat -s Unity      # if something is wrong
```

In the editor (no headset), press Play: the view is taken from where the head would be. Set
`ORION_FIXTURE=paris-short-v1` in the environment to fly the offline fixture instead of the trip
last sent.

```sh
./build.sh smoke     # plays the flight headless; state in the log, Logs/smoke-N.png from the head camera; stops if the tile server refuses
# the same without touching Google at all: a synthetic trip over a public sample tileset
ORION_FIXTURE=sample-block ORION_TILESET_URL=https://raw.githubusercontent.com/CesiumGS/3d-tiles-samples/main/1.0/TilesetWithRequestVolume/city/tileset.json ./build.sh smoke
```

## What has been verified

| | |
|---|---|
| Google key works without a Referer (so from a native app) | **Checked** with curl, 2026-09-19 |
| Map Tiles terms allow Cesium for Unity | **Read** on Google's policy page |
| API shape (`/api/vr/current`, trips, fixture) | **Checked** against the live endpoint (a Toronto trip: no clips, two silent stops, a 3.7 km leg) and the fixture |
| Project opens and compiles in Unity 6000.3.24f1 | **Yes**, from the command line (`./build.sh setup`) |
| Logic tests | **15 of 15 pass** in the editor (`./build.sh test`) |
| APK builds | **Yes**: 47 MB, arm64, IL2CPP, Vulkan, OpenXR loader + Meta Quest feature + Touch profile + foveation, multiview, `com.oculus.intent.category.VR`, INTERNET, Cesium's native library inside, all four Orion shaders compiled |
| Editor play mode: app boots, trip parses, rig waits over the first stop, captions and route draw | **Yes** (`./build.sh smoke`, screenshots in `Logs/`) |
| Editor play mode: a refusal from Google is shown and nothing retries | **Yes**: one request, "Google would not serve the city … (HTTP 429)", 72 fps |
| Editor play mode: **tiles load and the whole flight plays** | **Yes, over a public sample tileset** (Cesium's `3d-tiles-samples` city block, no key) with the `sample-block` fixture: tiles and their colliders load, stops are found by ray, the rig is placed behind a blink, captions/beam/pins/beads/ribbon draw, the guide turns to a target and the rig is moved behind a blink, both legs are ridden behind the guide orb with the vignette closing, the day ends at stop 3. 72 fps, no errors. Screenshots in `Logs/smoke-*.png` |
| Editor play mode: the same over **Google's** tiles | **NOT YET.** The first smoke run found the per-frame reload bug (see above) by spending the key's daily quota; nothing can be loaded with this key until it resets (midnight Pacific). Unproven until then: Google's unlit material under URP, the attribution strip, real-city scale and load times |
| Anything in the headset | only you can (`TESTING.md`) |

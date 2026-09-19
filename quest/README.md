# Orion for Meta Quest

The native headset client for Orion. It plays the same guided flight as the web app's `/vr`, over
Google Photorealistic 3D Tiles, at a quality a browser on a Quest cannot reach. Open the app and it
plays the trip you last sent to VR from the web (`GET /api/vr/current`).

Unity 6.3 LTS (`6000.3.24f1`) · Cesium for Unity 1.25 · URP · OpenXR with Meta Quest Support.

> **Status: written, not yet compiled.** Nothing here has been through the Unity editor yet. See
> "What has been verified" at the bottom; it is updated as that changes.

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
- Tile detail: Cesium has one screen-space error per tileset (12 px at a stop, 24 px on a leg),
  64 px for what is out of view, fog culling beyond 4.5 km, a 512 MB tile cache.

## The Google tiles key

The build reads `VITE_GOOGLE_MAPS_KEY` from the web app's `.env` one directory up (or
`ORION_GOOGLE_TILES_KEY` if set) and writes it to `Assets/Orion/Resources/OrionConfig.json`, which is
gitignored. It is never logged or committed. Be aware it ships inside the APK, and the key is
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

## What has been verified

| | |
|---|---|
| Google key works without a Referer (so from a native app) | **Checked** with curl, 2026-09-19 |
| Map Tiles terms allow Cesium for Unity | **Read** on Google's policy page |
| API shape (`/api/vr/current`, fixture plan) | **Checked** against the live endpoint and the fixture |
| C# compiles | not yet |
| Logic tests pass | not yet |
| Editor play mode: city loads, flight plays | not yet |
| APK builds | not yet |
| Anything in the headset | only you can |

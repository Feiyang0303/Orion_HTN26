using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using CesiumForUnity;
using Orion.Flight;
using UnityEngine;

namespace Orion.World
{
    /* The real city: Google's Photorealistic 3D Tiles, streamed by Cesium. A headset has a mobile
     * GPU and a fraction of a laptop's memory, so: nothing is fetched beyond the haze, what is
     * out of view is kept only coarsely so there is a city there if they turn round, and the cache
     * is bounded. Photogrammetry has its lighting baked in, so the tiles are drawn unlit (Orion/Tiles). */

    public class City : MonoBehaviour
    {
        // Screen-space error, in the headset's own pixels. One value for the whole flight: Cesium reloads the entire
        // tileset when this is set, a fresh request to Google each time, so it is set once and never touched again.
        const float ScreenSpaceError = 12;
        const long CacheBytes = 512L * 1024 * 1024;
        const int PreloadPx = 700;

        /// <summary>Google would not serve the city: the HTTP status it answered with (429 is a used-up quota).</summary>
        public event Action<long> Refused;

        public CesiumGeoreference Georeference { get; private set; }

        // Nothing outside this class can reach the tileset. Most of its setters reload it, and every reload is a billable
        // request to Google: so its properties are set here, once, and the rest of the app gets only what it can read.
        Cesium3DTileset tiles;
        static bool made;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void NewRun() => made = false;          // the editor can start a run without reloading this class

        /// <summary>How much of what is wanted has loaded, 0 to 100.</summary>
        public float LoadProgress => tiles.ComputeLoadProgress();
        /// <summary>The layer the city's colliders are on.</summary>
        public int Layer => tiles.gameObject.layer;
        readonly List<Camera> ahead = new List<Camera>();

        /// <summary>The city, or null if this device has already asked Google for it as often as it may today (see TileBudget).</summary>
        public static City Make(string googleTilesKey)
        {
            if (made) throw new InvalidOperationException("There is one city per run: a second would be a second request to Google.");
            made = true;
            string url = $"https://tile.googleapis.com/v1/3dtiles/root.json?key={googleTilesKey}";
#if UNITY_EDITOR
            // Offline development: ORION_TILESET_URL flies over another tileset (with ORION_FIXTURE, a trip that is on it), so the
            // flight can be worked on without spending Google's root requests.
            string other = Environment.GetEnvironmentVariable("ORION_TILESET_URL");
            if (!string.IsNullOrEmpty(other)) url = other;
#endif
            if (url.Contains("googleapis.com") && !TileBudget.TrySpend()) return null;

            var city = new GameObject("City").AddComponent<City>();
            city.Georeference = city.gameObject.AddComponent<CesiumGeoreference>();

            var go = new GameObject("Google Photorealistic 3D Tiles");
            go.transform.SetParent(city.transform, false);
            var t = city.tiles = go.AddComponent<Cesium3DTileset>();
            t.tilesetSource = CesiumDataSource.FromUrl;
            t.url = url;
            t.showCreditsOnScreen = true;                        // Google's terms: the attribution stays in view (see Credits)
            t.maximumScreenSpaceError = ScreenSpaceError;
            t.maximumCachedBytes = CacheBytes;
            t.maximumSimultaneousTileLoads = 12;
            t.preloadAncestors = true;
            t.preloadSiblings = true;
            t.enableFrustumCulling = true;
            t.enableFogCulling = false;                          // Cesium's fog drops far tiles by its own reckoning, leaving a hard edge; the far plane and Orion's haze end the city instead
            t.enforceCulledScreenSpaceError = true;
            t.culledScreenSpaceError = 64;
            t.createPhysicsMeshes = true;                        // the ground is found by rays onto them (see Ground)
            t.generateSmoothNormals = false;
            t.opaqueMaterial = new Material(Look.ShaderNamed("OrionTiles"));      // unlit, with the haze Cesium's own lacks

            Cesium3DTileset.OnCesium3DTilesetLoadFailure += city.OnLoadFailure;

            Shader.SetGlobalColor("_OrionHaze", Look.Haze.linear);
            Shader.SetGlobalVector("_OrionHazeRange", new Vector4(Rig.Far * .35f, Rig.Far * .95f));
            RenderSettings.skybox = new Material(Look.ShaderNamed("OrionSky"));
            return city;
        }

        // Only the status is passed on: Cesium's own message carries the tileset's address, and the key is in it. The
        // status is read out of that message, because the struct's own httpStatusCode says 200 for a refused root request.
        void OnLoadFailure(Cesium3DTilesetLoadFailureDetails failure)
        {
            if (failure.tileset != tiles) return;
            var said = Regex.Match(failure.message ?? "", @"status code (\d+)");
            Refused?.Invoke(said.Success ? long.Parse(said.Groups[1].Value) : failure.httpStatusCode);
        }

        void OnDestroy() => Cesium3DTileset.OnCesium3DTilesetLoadFailure -= OnLoadFailure;

        /// <summary>Centre the world on a day. Everything the flight places is within a few kilometres of here.</summary>
        public void CentreOn(LatLon origin) => Georeference.SetOriginLongitudeLatitudeHeight(origin.lon, origin.lat, 0);

        /// <summary>Tiles are chosen for the cameras Cesium knows about. Cameras that draw nothing, held on the
        /// views coming up, make it fetch those views in advance, and drop them as the flight moves past.</summary>
        public void LookAhead(IReadOnlyList<(Vector3 eye, Vector3 look)> views)
        {
            var manager = CesiumCameraManager.GetOrCreate(tiles.gameObject);
            while (ahead.Count < views.Count)
            {
                var cam = new GameObject($"Look ahead {ahead.Count}").AddComponent<Camera>();
                cam.transform.SetParent(transform, false);
                cam.enabled = false;
                cam.fieldOfView = 70; cam.nearClipPlane = .3f; cam.farClipPlane = Rig.Far;
                cam.targetTexture = new RenderTexture(PreloadPx, PreloadPx, 0);      // never drawn into: it is how a camera is given a resolution
                ahead.Add(cam);
            }
            manager.additionalCameras.Clear();
            for (int i = 0; i < views.Count; i++)
            {
                ahead[i].transform.SetPositionAndRotation(views[i].eye, Quaternion.LookRotation(views[i].look - views[i].eye, Vector3.up));
                manager.additionalCameras.Add(ahead[i]);
            }
        }
    }
}

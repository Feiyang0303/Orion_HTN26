using System.Collections.Generic;
using CesiumForUnity;
using Orion.Flight;
using UnityEngine;

namespace Orion.World
{
    /* The real city: Google's Photorealistic 3D Tiles, streamed by Cesium. A headset has a mobile
     * GPU and a fraction of a laptop's memory, so: detail is spent where the person is (a screen-
     * space error that loosens while they are moving), nothing is fetched beyond the haze, what is
     * out of view is kept only coarsely so there is a city there if they turn round, and the cache
     * is bounded. Photogrammetry has its lighting baked in, and the tiles say so (KHR_materials_unlit),
     * which Cesium honours with its unlit material. */

    public class City : MonoBehaviour
    {
        const float DwellError = 12, TravelError = 24;         // screen-space error, in the headset's own pixels
        const long CacheBytes = 512L * 1024 * 1024;
        const int PreloadPx = 700;

        public CesiumGeoreference Georeference { get; private set; }
        public Cesium3DTileset Tiles { get; private set; }
        readonly List<Camera> ahead = new List<Camera>();

        public static City Make(string googleTilesKey)
        {
            var city = new GameObject("City").AddComponent<City>();
            city.Georeference = city.gameObject.AddComponent<CesiumGeoreference>();

            var go = new GameObject("Google Photorealistic 3D Tiles");
            go.transform.SetParent(city.transform, false);
            var t = city.Tiles = go.AddComponent<Cesium3DTileset>();
            t.tilesetSource = CesiumDataSource.FromUrl;
            t.url = $"https://tile.googleapis.com/v1/3dtiles/root.json?key={googleTilesKey}";
            t.showCreditsOnScreen = true;                        // Google's terms: the attribution stays in view (see Credits)
            t.maximumScreenSpaceError = DwellError;
            t.maximumCachedBytes = CacheBytes;
            t.maximumSimultaneousTileLoads = 12;
            t.preloadAncestors = true;
            t.preloadSiblings = true;
            t.enableFrustumCulling = true;
            t.enableFogCulling = true;
            t.enforceCulledScreenSpaceError = true;
            t.culledScreenSpaceError = 64;
            t.createPhysicsMeshes = true;                        // the ground is found by rays onto them (see Ground)
            t.generateSmoothNormals = false;

            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = Look.Haze;
            RenderSettings.fogStartDistance = Rig.Far * .4f;
            RenderSettings.fogEndDistance = Rig.Far;
            RenderSettings.skybox = new Material(Look.Shader("OrionSky"));
            return city;
        }

        /// <summary>Centre the world on a day. Everything the flight places is within a few kilometres of here.</summary>
        public void CentreOn(LatLon origin) => Georeference.SetOriginLongitudeLatitudeHeight(origin.lon, origin.lat, 0);

        public void SetMoving(bool moving) => Tiles.maximumScreenSpaceError = moving ? TravelError : DwellError;

        /// <summary>Tiles are chosen for the cameras Cesium knows about. Cameras that draw nothing, held on the
        /// views coming up, make it fetch those views in advance, and drop them as the flight moves past.</summary>
        public void LookAhead(IReadOnlyList<(Vector3 eye, Vector3 look)> views)
        {
            var manager = CesiumCameraManager.GetOrCreate(Tiles.gameObject);
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

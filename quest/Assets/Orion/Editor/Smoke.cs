using System.IO;
using System.Linq;
using CesiumForUnity;
using TMPro;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Orion.Editor
{
    /* The flight, played in the editor with nobody watching: `./build.sh smoke` enters play mode, and at a
     * few moments writes what the head camera sees to Logs/smoke-N.png and what state things are in to the
     * log, then closes the editor. Set ORION_FIXTURE to fly a fixture instead of the trip last sent. */

    [InitializeOnLoad]
    public static class Smoke
    {
        const string Flag = "Orion.Smoke";
        static readonly float[] Moments = { 12, 25, 40, 60, 85, 110 };
        static double started;
        static int taken;

        static Smoke()
        {
            if (!SessionState.GetBool(Flag, false)) return;
            EditorApplication.update += Tick;                                              // entering play mode reloads this class
            Cesium3DTileset.OnCesium3DTilesetLoadFailure += failure =>                     // never keep asking a server that has said no
            {
                Debug.LogError($"[smoke] the tile server refused: HTTP {failure.httpStatusCode}. Stopping.");
                pendingExit = 3;
            };
        }

        static int pendingExit = -1;      // frames left before leaving after a refusal: long enough to see what the app shows

        public static void Run()
        {
            Build.WriteConfig();
            SessionState.SetBool(Flag, true);
            EditorSceneManager.OpenScene("Assets/Orion/Main.unity");
            EditorApplication.EnterPlaymode();
        }

        static void Tick()
        {
            if (!EditorApplication.isPlaying) return;
            if (pendingExit > 0 && --pendingExit == 0) { Report(); SessionState.EraseBool(Flag); EditorApplication.Exit(1); return; }
            if (started == 0) started = EditorApplication.timeSinceStartup;
            if (EditorApplication.timeSinceStartup - started < Moments[taken]) return;
            Report();
            if (++taken < Moments.Length) return;
            SessionState.EraseBool(Flag);
            EditorApplication.Exit(0);
        }

        static void Report()
        {
            var head = Camera.main;
            var tiles = Object.FindFirstObjectByType<Cesium3DTileset>();
            var rig = GameObject.Find("Rig");
            string captions = string.Join(" | ", Object.FindObjectsByType<TextMeshPro>(FindObjectsSortMode.None)
                .Where(t => t.transform.parent != null && t.transform.parent.name == "Captions").Select(t => $"{t.name}: {t.text}"));
            Debug.Log($"[smoke {EditorApplication.timeSinceStartup - started:0}s] city {(tiles ? tiles.ComputeLoadProgress() : -1):0}%  tile renderers {(tiles ? tiles.GetComponentsInChildren<MeshRenderer>().Length : 0)}  "
                + $"colliders {(tiles ? tiles.GetComponentsInChildren<MeshCollider>().Length : 0)}  rig {(rig ? rig.transform.position.ToString("0") : "none")} yaw {(rig ? rig.transform.eulerAngles.y : 0):0}  "
                + $"veil {Object.FindFirstObjectByType<Veil>()?.Fade:0.00}  fps {1 / Time.smoothDeltaTime:0}  ||  {captions}");

            var target = new RenderTexture(1280, 720, 24);
            head.targetTexture = target; head.Render(); head.targetTexture = null;
            RenderTexture.active = target;
            var image = new Texture2D(target.width, target.height, TextureFormat.RGB24, false);
            image.ReadPixels(new Rect(0, 0, target.width, target.height), 0, 0);
            RenderTexture.active = null;
            File.WriteAllBytes($"Logs/smoke-{taken}.png", image.EncodeToPNG());
        }
    }
}

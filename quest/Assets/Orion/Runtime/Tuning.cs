using System.Collections.Generic;
using System.Globalization;
using System.IO;
using UnityEngine;

namespace Orion
{
    /* What a headset can hold at 72 Hz is found by trying, on the headset. A file of `name=value` lines at
     * <persistentDataPath>/tuning.txt overrides the numbers below for the next launch, so a setting can be tried with
     *   adb shell "echo sse=32 > /sdcard/Android/data/com.orion.quest/files/tuning.txt"
     * and no rebuild. With no file, these are the settings. */

    public static class Tuning
    {
        static readonly Dictionary<string, float> set = new Dictionary<string, float>();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void Read()
        {
            set.Clear();
            string file = Path.Combine(Application.persistentDataPath, "tuning.txt");
            if (!File.Exists(file)) return;
            foreach (string line in File.ReadAllLines(file))
            {
                var pair = line.Split('=');
                if (pair.Length == 2 && float.TryParse(pair[1].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out float v)) set[pair[0].Trim()] = v;
            }
            Debug.Log($"[orion] tuning: {string.Join(", ", File.ReadAllLines(file))}");
        }

        static float Get(string name, float otherwise) => set.TryGetValue(name, out float v) ? v : otherwise;

        /// <summary>Screen-space error, in the headset's own pixels (see City).</summary>
        public static float ScreenSpaceError => Get("sse", 24);
        /// <summary>How far the city is drawn, and fetched, metres.</summary>
        public static float Far => Get("far", 3000);
        /// <summary>Whether tiles out of view are let go of. Off, the whole circle stays loaded for when a head turns.</summary>
        public static bool Cull => Get("cull", 1) > 0;
        /// <summary>The screen-space error tiles out of view are kept to: low enough that a head turning back finds the city
        /// nearly as it left it, high enough that what is behind does not cost what is in front.</summary>
        public static float CulledError => Get("culled", 48);
        /// <summary>How many views coming up are fetched in advance.</summary>
        public static int LookAhead => (int)Get("ahead", 1);
        public static uint TileLoads => (uint)Get("loads", 24);
        /// <summary>Eye buffer size, as a multiple of the headset's default.</summary>
        public static float EyeScale => Get("eyes", SystemInfo.systemMemorySize >= 7000 ? 1.2f : 1);      // a Quest Pro or 3 has the GPU to spare for it at these settings; a Quest 2 has not
    }
}

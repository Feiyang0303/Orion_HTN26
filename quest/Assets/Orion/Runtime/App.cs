using System;
using Orion.Flight;
using Orion.World;
using UnityEngine;

namespace Orion
{
    /// <summary>Open the app and it plays the trip last sent to VR from the web app.</summary>
    public class App : MonoBehaviour
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot() => new GameObject("Orion").AddComponent<App>();

        void Start()
        {
            Application.targetFrameRate = 72;                    // in a headset the compositor sets the pace; anywhere else, this does
            var rig = Rig.Make();
            rig.Veil.Fade = 0;
            rig.Carry(Vector3.up * Rig.HeadHeight, 0);

            Config config;
            try { config = Config.Load(); }
            catch (InvalidOperationException e) { rig.Captions.Show("ORION", "This build has no key", e.Message, null); return; }

            var world = City.Make(config.googleTilesKey);
            if (world == null)
            {
                rig.Captions.Show("ORION", "That is enough for today", $"This headset has loaded the city {TileBudget.PerDay} times today, and each load is a billed request to Google. It will again tomorrow (Pacific time).", null);
                return;
            }
            world.Refused += status => rig.Captions.Show("ORION", "Google would not serve the city",
                status == 429 ? "The map key has used up its tile requests for today (HTTP 429). They come back at midnight Pacific." : $"The tile server answered HTTP {status}.", null);
            var marks = new GameObject("Marks").AddComponent<Marks>();
            marks.Build(rig.Head.transform);
            var client = new TripClient(config.apiBase);
            var narration = Narration.Make(rig.Head.transform, client);
            void Begin(Trip trip)
            {
                if (trip?.days == null || trip.days.Length == 0 || trip.days[0].stops.Length == 0) rig.Captions.Show("ORION", "That trip has no stops", "Send another from Orion on the web, then open this again.", null);
                else FlightDeck.Begin(trip, world, rig, marks, narration);
            }

#if UNITY_EDITOR
            // Offline development: ORION_FIXTURE names a Day-shaped plan under Assets/Orion/Fixtures to fly instead of the trip last sent.
            string fixture = Environment.GetEnvironmentVariable("ORION_FIXTURE");
            if (!string.IsNullOrEmpty(fixture))
            {
                string json = System.IO.File.ReadAllText($"{Application.dataPath}/Orion/Fixtures/{fixture}.json");
                Begin(new Trip { city = JsonUtility.FromJson<Trip>(json).city, days = new[] { JsonUtility.FromJson<Day>(json) } });
                return;
            }
#endif
            rig.Captions.Show("ORION", "Looking for your trip…", "", null);
            StartCoroutine(client.Current(
                Begin,
                onNone: () => rig.Captions.Show("ORION", "No trip has been sent yet", "In Orion on the web, open a trip and send it to VR. Then open this again.", null),
                onError: error => rig.Captions.Show("ORION", "Orion could not be reached", error, null)));
        }
    }
}

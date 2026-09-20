using System;
using System.Collections.Generic;

namespace Orion.Flight
{
    /* The trip as the web API serves it (src/types.ts in the web app). Only what the
     * flight reads is declared; JsonUtility ignores the rest. */

    [Serializable] public class LatLon { public double lat, lon; }

    [Serializable] public class Target { public string id, name; public double lat, lon; }

    [Serializable]
    public class Beat
    {
        public string text, targetId, audioUrl;      // targetId and audioUrl may be absent: JsonUtility leaves them empty
        public float durationSec;

        /// <summary>Whether there is anything to say. JsonUtility makes an empty Beat where a plan has none.</summary>
        public bool Said => !string.IsNullOrWhiteSpace(text);
    }

    [Serializable]
    public class Stop
    {
        public string id, name;
        public double lat, lon;
        public Target[] targets = Array.Empty<Target>();
        public Beat[] beats = Array.Empty<Beat>();
    }

    [Serializable]
    public class Leg
    {
        public string fromStopId, toStopId, transport;
        public LatLon[] polyline = Array.Empty<LatLon>();
        public float distanceM, durationSec;
        public bool estimated;
        /// <summary>What the guide says on the way, if anything.</summary>
        public Beat bridge;
    }

    [Serializable]
    public class Day
    {
        public int number = 1;
        public string title;
        public LatLon origin;
        public Stop[] stops = Array.Empty<Stop>();
        public Leg[] legs = Array.Empty<Leg>();
        /// <summary>The welcome, spoken at the first place before anything else, and the goodbye, at the last.</summary>
        public Beat opening, closing;

        /// <summary>Everything the guide says in the day, in the order it is said.</summary>
        public IEnumerable<Beat> Spoken()
        {
            if (opening != null && opening.Said) yield return opening;
            for (int i = 0; i < stops.Length; i++)
            {
                foreach (var b in stops[i].beats) if (b.Said) yield return b;
                if (i < legs.Length && legs[i].bridge != null && legs[i].bridge.Said) yield return legs[i].bridge;
            }
            if (closing != null && closing.Said) yield return closing;
        }
    }

    [Serializable] public class Trip { public string city; public LatLon origin; public Day[] days = Array.Empty<Day>(); }

    /// <summary>GET /api/trips/get</summary>
    [Serializable] public class TripEnvelope { public string id; public Trip trip; }

    /// <summary>GET /api/vr/current</summary>
    [Serializable] public class CurrentTrip { public string id; }
}

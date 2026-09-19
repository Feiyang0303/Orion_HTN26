using System;

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
    }

    [Serializable]
    public class Day
    {
        public int number = 1;
        public string title;
        public LatLon origin;
        public Stop[] stops = Array.Empty<Stop>();
        public Leg[] legs = Array.Empty<Leg>();
    }

    [Serializable] public class Trip { public string city; public LatLon origin; public Day[] days = Array.Empty<Day>(); }

    /// <summary>GET /api/trips/get</summary>
    [Serializable] public class TripEnvelope { public string id; public Trip trip; }

    /// <summary>GET /api/vr/current</summary>
    [Serializable] public class CurrentTrip { public string id; }
}

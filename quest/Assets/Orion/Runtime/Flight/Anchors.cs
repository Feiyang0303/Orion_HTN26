using System.Collections.Generic;

namespace Orion.Flight
{
    /// <summary>Everything in a Day that needs a place on the real ground, as real lon/lat.</summary>
    public readonly struct Anchor
    {
        public const float SampleStepM = 30;

        public readonly string Key;
        public readonly double Lat, Lon;
        Anchor(string key, double lat, double lon) { Key = key; Lat = lat; Lon = lon; }

        public const string Origin = "origin";
        public static string Stop(int i) => $"s{i}";
        public static string Target(int i, string id) => $"t{i}:{id}";
        public static string Leg(int i, int j) => $"l{i}:{j}";

        public static List<Anchor> For(Day day)
        {
            var o = new List<Anchor> { new Anchor(Origin, day.origin.lat, day.origin.lon) };
            for (int i = 0; i < day.stops.Length; i++)
            {
                var s = day.stops[i];
                o.Add(new Anchor(Stop(i), s.lat, s.lon));
                foreach (var t in s.targets) o.Add(new Anchor(Target(i, t.id), t.lat, t.lon));
            }
            for (int i = 0; i < day.legs.Length; i++)
            {
                var pts = Geo.Resample(day.legs[i].polyline, SampleStepM);
                for (int j = 0; j < pts.Count; j++) o.Add(new Anchor(Leg(i, j), pts[j].lat, pts[j].lon));
            }
            return o;
        }
    }
}

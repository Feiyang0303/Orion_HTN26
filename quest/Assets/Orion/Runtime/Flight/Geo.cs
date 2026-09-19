using System;
using System.Collections.Generic;

namespace Orion.Flight
{
    public static class Geo
    {
        const double Deg = Math.PI / 180;

        public static double MetresBetween(LatLon a, LatLon b)
        {
            const double R = 6371000;
            double dLat = (b.lat - a.lat) * Deg, dLon = (b.lon - a.lon) * Deg;
            double h = Math.Pow(Math.Sin(dLat / 2), 2) + Math.Cos(a.lat * Deg) * Math.Cos(b.lat * Deg) * Math.Pow(Math.Sin(dLon / 2), 2);
            return 2 * R * Math.Asin(Math.Sqrt(h));
        }

        /// <summary>Points along a polyline at most `step` metres apart, interpolating inside long
        /// segments so the ground is sampled along the street, not only at its bends. Always keeps
        /// both ends. Capped at `max` points.</summary>
        public static List<LatLon> Resample(IReadOnlyList<LatLon> line, double step, int max = 400)
        {
            var o = new List<LatLon>(line.Count);
            if (line.Count < 2) { o.AddRange(line); return o; }
            o.Add(line[0]);
            for (int i = 1; i < line.Count; i++)
            {
                LatLon a = line[i - 1], b = line[i];
                int n = Math.Max(1, (int)Math.Ceiling(MetresBetween(a, b) / step));
                for (int k = 1; k <= n; k++) o.Add(new LatLon { lat = a.lat + (b.lat - a.lat) * k / n, lon = a.lon + (b.lon - a.lon) * k / n });
            }
            if (o.Count <= max) return o;
            int every = (int)Math.Ceiling(o.Count / (double)max);
            var thin = new List<LatLon>(max + 1);
            for (int i = 0; i < o.Count; i++) if (i % every == 0 || i == o.Count - 1) thin.Add(o[i]);
            return thin;
        }

        public static float Smootherstep(float x)
        {
            float c = Math.Min(1, Math.Max(0, x));
            return c * c * c * (c * (c * 6 - 15) + 10);
        }
    }
}

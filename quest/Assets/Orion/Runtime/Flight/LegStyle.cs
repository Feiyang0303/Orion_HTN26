using System;
using System.Collections.Generic;
using UnityEngine;

namespace Orion.Flight
{
    /* How a route sits on the city, and how each way of travelling looks.
     *
     * Heights come from rays dropped onto photogrammetry, which is a model of whatever is on
     * top: a tree that overhangs the street, an awning, a bridge deck. One such hit among points
     * 30 m apart is a spike in the line. Real streets do not jump twenty metres in thirty, so the
     * heights are cleaned before anything uses them. */

    public readonly struct LegStyle
    {
        const float MaxSlope = .3f;          // metres of height per metre along the route: steeper than any street

        /// <summary>Radius of the drawn line, metres.</summary>
        public readonly float Radius;
        /// <summary>Metres between beads, or 0 for a continuous ribbon.</summary>
        public readonly float BeadGap;
        public readonly bool Glow;
        public readonly float Opacity;

        LegStyle(float radius, float beadGap, bool glow, float opacity) { Radius = radius; BeadGap = beadGap; Glow = glow; Opacity = opacity; }

        /// <summary>Walking is footsteps, cycling longer-spaced beads, transit a ribbon and driving a wide
        /// road of light. A leg that is only an estimate is drawn broken and faint, so a guess never looks like a route.</summary>
        public static LegStyle For(string transport, bool estimated)
        {
            LegStyle s = transport switch
            {
                "cycle" => new LegStyle(2.3f, 14.4f, false, .95f),
                "transit" => new LegStyle(3.1f, 0, true, .95f),
                "drive" => new LegStyle(3.8f, 0, true, .95f),
                _ => new LegStyle(2.0f, 6.75f, false, .95f),          // walk; old plans predate the field
            };
            return estimated ? new LegStyle(s.Radius, s.BeadGap > 0 ? s.BeadGap : 10.8f, false, .5f) : s;
        }

        /// <summary>The same points with their heights made believable: outliers replaced by the median of
        /// their neighbours, then the slope limited, then a light average. x and z are untouched.</summary>
        public static List<Vector3> SmoothHeights(List<Vector3> pts)
        {
            int n = pts.Count;
            if (n < 3) return new List<Vector3>(pts);
            var median = new float[n];
            var w = new List<float>(5);
            for (int i = 0; i < n; i++)
            {
                w.Clear();
                for (int k = Math.Max(0, i - 2); k < Math.Min(n, i + 3); k++) w.Add(pts[k].y);
                w.Sort();
                median[i] = w[w.Count >> 1];
            }
            void Run(int from, int to, int step)
            {
                for (int i = from; i != to; i += step)
                {
                    float d = new Vector2(pts[i].x - pts[i - step].x, pts[i].z - pts[i - step].z).magnitude * MaxSlope;
                    median[i] = Mathf.Min(median[i - step] + d, Mathf.Max(median[i - step] - d, median[i]));
                }
            }
            Run(1, n, 1); Run(n - 2, -1, -1);
            var o = new List<Vector3>(n);
            for (int i = 0; i < n; i++) o.Add(new Vector3(pts[i].x, (median[Math.Max(0, i - 1)] + median[i] * 2 + median[Math.Min(n - 1, i + 1)]) / 4, pts[i].z));
            return o;
        }
    }
}

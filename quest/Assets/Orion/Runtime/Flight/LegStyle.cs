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

        /// <summary>Width of the drawn line, metres.</summary>
        public readonly float Width;
        /// <summary>Metres of dash and of gap, or 0 for a solid line.</summary>
        public readonly float DashOn, DashOff;
        /// <summary>A wider, fainter line under the main one.</summary>
        public readonly bool Glow;
        public readonly float Opacity;
        /// <summary>How fast the travelling light moves along the line, metres a second.</summary>
        public readonly float PulseMps;

        LegStyle(float width, float dashOn, float dashOff, bool glow, float opacity, float pulseMps)
        { Width = width; DashOn = dashOn; DashOff = dashOff; Glow = glow; Opacity = opacity; PulseMps = pulseMps; }

        /// <summary>Walking is footsteps, cycling long dashes, transit a ribbon and driving a wide road of light, as on the
        /// desktop (whose widths are in pixels; these are what they come to from a vantage's distance). A leg that is only
        /// an estimate is drawn broken and faint, so a guess never looks like a route.</summary>
        public static LegStyle For(string transport, bool estimated)
        {
            LegStyle s = transport switch
            {
                "cycle" => new LegStyle(3.4f, 34, 16, false, .95f, 90),
                "transit" => new LegStyle(5f, 0, 0, true, .95f, 170),
                "drive" => new LegStyle(6f, 0, 0, true, .95f, 220),
                _ => new LegStyle(3f, 9, 15, false, .95f, 40),          // walk; old plans predate the field
            };
            return estimated ? new LegStyle(s.Width, 12, 14, false, .5f, s.PulseMps) : s;
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

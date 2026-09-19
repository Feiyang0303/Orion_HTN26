using System.Collections.Generic;
using UnityEngine;

namespace Orion.Flight
{
    /// <summary>A polyline in world space with arc-length lookup. One path per leg, joined into a
    /// route, so "how far along" is a single number of metres.</summary>
    public class RoutePath
    {
        public readonly List<Vector3> Pts;
        public readonly float Length;
        readonly float[] cum;

        public RoutePath(List<Vector3> pts)
        {
            Pts = pts;
            cum = new float[Mathf.Max(1, pts.Count)];
            for (int i = 1; i < pts.Count; i++) cum[i] = cum[i - 1] + Vector3.Distance(pts[i], pts[i - 1]);
            Length = cum[cum.Length - 1];
        }

        /// <summary>Where `s` metres falls, counted in points: 2.5 is halfway between the third and the fourth.</summary>
        public float IndexAt(float s)
        {
            int n = Pts.Count;
            if (n < 2 || s <= 0) return 0;
            if (s >= Length) return n - 1;
            int lo = 0, hi = n - 1;
            while (hi - lo > 1) { int mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
            float seg = cum[hi] - cum[lo];
            return lo + (seg > 0 ? (s - cum[lo]) / seg : 0);
        }

        public Vector3 At(float s)
        {
            if (Pts.Count == 0) return Vector3.zero;
            float f = IndexAt(s);
            int i = (int)f;
            return i + 1 < Pts.Count ? Vector3.LerpUnclamped(Pts[i], Pts[i + 1], f - i) : Pts[i];
        }

        /// <summary>Horizontal unit direction of travel around s, or `fallback` if the path is degenerate there.</summary>
        public Vector3 Heading(float s, float back, float ahead, Vector3 fallback)
        {
            Vector3 a = At(s - back), b = At(s + ahead);
            var d = new Vector3(b.x - a.x, 0, b.z - a.z);
            return d.sqrMagnitude < 1e-6f ? fallback : d.normalized;
        }
    }
}

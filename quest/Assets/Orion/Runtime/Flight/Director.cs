using UnityEngine;

namespace Orion.Flight
{
    /* THE DIRECTOR. Where a stop is seen from depends on what is there: a cathedral needs a
     * wide, high vantage to be seen whole, a statue a close one. The tiles have no labels, but
     * they do have surfaces: a few rays down around a target (roof height against the street
     * around it) say how tall it stands, which is enough to frame it.
     *
     * The web flight frames for a window on a screen. In a headset at 1:1 scale the same
     * distances leave buildings small, so the vantages are pulled in by `Closer`, down to the
     * distance at which photogrammetry starts to look melted. */

    public readonly struct Frame
    {
        /// <summary>Headset vantages as a fraction of the web flight's.</summary>
        public const float Closer = .62f;
        /// <summary>Never nearer than this to what is being looked at, along the line of sight: closer, photogrammetry melts.</summary>
        const float MinRange = 70;

        public readonly float Dist, Up, LookUp;
        Frame(float dist, float up, float lookUp) { Dist = dist; Up = up; LookUp = lookUp; }

        /// <summary>`heightM` is what was measured (null if the tiles were not there yet).</summary>
        public static Frame For(float? heightM, bool wide)
        {
            float h = heightM ?? 25;                         // unknown: assume something building-sized
            float t = Mathf.Clamp01(h / 120);                // 0 = at street level, 1 = tower-sized
            float dist = (wide ? 230 + 190 * t : 150 + 170 * t) * Closer;
            float up = (wide ? 130 + 90 * t : 80 + 100 * t) * Closer;
            float lookUp = wide ? 12 + 30 * t : 8 + 28 * t;
            float range = Mathf.Sqrt(dist * dist + (up - lookUp) * (up - lookUp));
            if (range < MinRange) { float k = MinRange / range; dist *= k; up = lookUp + (up - lookUp) * k; }
            return new Frame(dist, up, lookUp);
        }
    }
}

using System.Collections.Generic;
using UnityEngine;

namespace Orion.Flight
{
    /* Being flown, without being made ill.
     *
     * What upsets people in a headset is the eyes reporting an acceleration the ears did not
     * feel: starts, stops, turns, and being pushed sideways. Steady motion straight ahead is
     * tolerated far better. So a leg is ridden the way a careful driver would take it: never
     * faster than Cruise, slower through a bend (so the sideways push stays under TurnG), gently
     * up to speed and gently down. However long the leg is, only its two ends are flown, and the
     * middle is blinked across. And whatever the shots ask for, the person's space only ever
     * follows them through `Follower`, which caps speed, acceleration and turning, and leaves
     * pitch and roll entirely alone. */

    public class Ride
    {
        public const float Cruise = 30;          // m/s, the most a leg is ever flown at
        public const float Push = 3;             // m/s², speeding up and slowing down
        const float TurnG = 4;                   // m/s², sideways, through a bend
        const float MaxFlown = 1000;             // metres of a leg actually flown; the rest is blinked over
        const float Step = 5, BendSpan = 25;     // metres: how finely the ride is worked out, and the stretch a bend is measured over

        /// <summary>Seconds the leg takes.</summary>
        public readonly float T;
        readonly List<float> d = new List<float>();
        readonly float[] at, v;                  // when each sample is reached, and the speed there
        readonly int join = -1;                  // the first sample after the blink: no distance is flown to reach it

        /// <summary>How long a leg of this length takes if it is straight: what the timeline is built
        /// with, before there is a street to measure. The real ride is a little longer, and the clock waits for it.</summary>
        public static float StraightSec(float distanceM)
        {
            float L = Mathf.Min(distanceM, MaxFlown);
            return L >= Cruise * Cruise / Push ? L / Cruise + Cruise / Push : 2 * Mathf.Sqrt(L / Push);
        }

        /// <summary>The ride down a trail: for every few metres of it, the speed the bend there allows,
        /// then limited so that speed is only ever gained and lost at Push, from rest to rest.</summary>
        public Ride(RoutePath trail)
        {
            float L = trail.Length;
            bool cut = L > MaxFlown;
            if (cut)
            {
                for (float x = 0; x <= MaxFlown / 2; x += Step) d.Add(x);
                join = d.Count;
                for (float x = L - MaxFlown / 2; x <= L; x += Step) d.Add(x);
            }
            else for (float x = 0; x <= L; x += Step) d.Add(x);

            int n = d.Count;
            at = new float[n]; v = new float[n];
            if (n < 2) return;
            for (int i = 0; i < n; i++)
            {
                float x = d[i];
                if (x < BendSpan || x > L - BendSpan) { v[i] = Cruise; continue; }     // no stretch to measure a bend over; it is nearly at rest here anyway
                Vector3 a = trail.At(x - BendSpan), b = trail.At(x), c = trail.At(x + BendSpan);
                float bend = Mathf.Abs(Mathf.Atan2(c.z - b.z, c.x - b.x) - Mathf.Atan2(b.z - a.z, b.x - a.x));
                float k = Mathf.Min(bend, 2 * Mathf.PI - bend) / BendSpan;             // radians turned per metre
                v[i] = Mathf.Min(Cruise, Mathf.Sqrt(TurnG / Mathf.Max(k, 1e-6f)));
            }
            v[0] = v[n - 1] = .5f;
            for (int i = 1; i < n; i++) v[i] = Mathf.Min(v[i], Mathf.Sqrt(v[i - 1] * v[i - 1] + 2 * Push * Gap(i)));
            for (int i = n - 2; i >= 0; i--) v[i] = Mathf.Min(v[i], Mathf.Sqrt(v[i + 1] * v[i + 1] + 2 * Push * Gap(i + 1)));
            for (int i = 1; i < n; i++) at[i] = at[i - 1] + 2 * Gap(i) / (v[i] + v[i - 1]);
            T = at[n - 1];
        }

        float Gap(int i) => i == join ? 0 : d[i] - d[i - 1];

        /// <summary>How fast the person is going at `t` seconds, metres a second.</summary>
        public float SpeedAt(float t)
        {
            if (d.Count < 2) return 0;
            int lo = 0, hi = d.Count - 1;
            while (hi - lo > 1) { int mid = (lo + hi) >> 1; if (at[mid] <= t) lo = mid; else hi = mid; }
            if (hi == join) return v[hi];
            float span = at[hi] - at[lo];
            return span > 0 ? Mathf.Lerp(v[lo], v[hi], Mathf.Clamp01((t - at[lo]) / span)) : v[hi];
        }

        /// <summary>Where the person is at `t` seconds: metres down the trail, and which side of the blink (0 before, 1 after).</summary>
        public (float s, int part) At(float t)
        {
            if (d.Count < 2) return (0, 0);
            int lo = 0, hi = d.Count - 1;
            while (hi - lo > 1) { int mid = (lo + hi) >> 1; if (at[mid] <= t) lo = mid; else hi = mid; }
            if (hi == join) return (d[hi], 1);
            // Between two samples the speed changes steadily, which is what their times were worked out from: so the speed never jumps.
            float gap = d[hi] - d[lo], tau = Mathf.Clamp(t - at[lo], 0, at[hi] - at[lo]), a = (v[hi] * v[hi] - v[lo] * v[lo]) / (2 * gap);
            return (Mathf.Min(d[hi], d[lo] + v[lo] * tau + .5f * a * tau * tau), join >= 0 && hi >= join ? 1 : 0);
        }
    }

    /// <summary>Where the person's space is, chasing where the shots say it should be. A critically
    /// damped spring with its acceleration and speed clamped, in position and in yaw. There is no
    /// pitch and no roll here on purpose: the horizon belongs to the person's own head.</summary>
    public class Follower
    {
        const float MaxSpeed = 40, MaxAccel = 8;                 // m/s, m/s²: above Cruise so the follower can catch up, never by much
        const float MaxTurn = .45f, MaxTurnAccel = .8f;          // rad/s, rad/s²
        const float Stiff = 3, TurnStiff = 1.6f;

        public Vector3 Pos, Vel;
        public float Yaw, Turn;                                  // radians, clockwise from north seen from above (Unity's yaw)

        /// <summary>Be there, moving as the shot is moving. Only ever done behind a blink.</summary>
        public void Snap(Vector3 pos, float yaw, Vector3 vel) { Pos = pos; Vel = vel; Yaw = yaw; Turn = 0; }

        /// <summary>Carry on as it was going, toward nothing: what happens while the view fades out.</summary>
        public void Coast(float dt) { Pos += Vel * dt; Yaw += Turn * dt; }

        public void Follow(Vector3 pos, float yaw, float dt)
        {
            Vector3 acc = Vector3.ClampMagnitude((pos - Pos) * (Stiff * Stiff) - Vel * (2 * Stiff), MaxAccel);
            Vel = Vector3.ClampMagnitude(Vel + acc * dt, MaxSpeed);
            Pos += Vel * dt;
            float a = Mathf.Clamp(TurnStiff * TurnStiff * AngleTo(Yaw, yaw) - 2 * TurnStiff * Turn, -MaxTurnAccel, MaxTurnAccel);
            Turn = Mathf.Clamp(Turn + a * dt, -MaxTurn, MaxTurn);
            Yaw += Turn * dt;
        }

        /// <summary>0 at rest, 1 at full tilt: how far the vignette should close.</summary>
        public float Motion => Mathf.Min(1, Mathf.Max(Vel.magnitude / Ride.Cruise, Mathf.Abs(Turn) / MaxTurn * 1.5f));

        /// <summary>The short way round from one yaw to another.</summary>
        public static float AngleTo(float from, float to)
        {
            float d = (to - from) % (2 * Mathf.PI);
            return d > Mathf.PI ? d - 2 * Mathf.PI : d < -Mathf.PI ? d + 2 * Mathf.PI : d;
        }
    }
}

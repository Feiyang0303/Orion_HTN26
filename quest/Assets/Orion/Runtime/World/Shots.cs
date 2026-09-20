using System.Collections.Generic;
using Orion.Flight;
using UnityEngine;

namespace Orion.World
{
    /* Where the person is put. A headset cannot be told where to look, so a shot is only ever an
     * `eye` (where their head is carried to) and a `look` (what their space is turned to face).
     *
     *   at a stop   a vantage behind the way the route arrived, at the Director's distance and
     *               height, checked for line of sight to the target before it is committed
     *   on a leg    ~55 m up, trailing the guide by up to ~110 m, down a line of their own: the
     *               street with its corners rounded off, because a person cannot be swung wide
     *               round a corner the way a camera can
     */

    public class Shots
    {
        public const float ChaseUp = 55, ChaseBack = 110, ChaseLook = 60;
        const float TrailEaseM = 550;              // a person is the full ChaseBack behind the guide only this far into a leg
        const float TrailStepM = 10;               // their line is sampled this often along the street
        const float RoundM = 70; const int Rounding = 5;      // and each point of it is the mean of the street this far either side, in this many steps each way
        static readonly float[] BeatOffsets = { 0, .7f, -.7f, 1.4f };
        static readonly (float scale, float lift)[] Fallbacks = { (1, 0), (1, 40), (1.25f, 90), (1.5f, 170) };

        readonly Ground ground;
        // Both keyed by (stop, target): what stands there, and the vantage found on it. A person is moved only
        // when the guide turns to a different thing, so there is one vantage per thing and not one per beat.
        readonly Dictionary<(int, string), (string anchor, float? h, float at)> sizes = new Dictionary<(int, string), (string, float?, float)>();
        readonly Dictionary<(int, string), (float scale, float lift, float at)> vantages = new Dictionary<(int, string), (float, float, float)>();

        public List<RoutePath> LegPaths { get; private set; } = new List<RoutePath>();
        RoutePath route = new RoutePath(new List<Vector3>());
        float[] legStart = new float[0];

        public Shots(Ground ground) { this.ground = ground; }

        /// <summary>The day's legs as world-space paths on whatever ground has been found so far.</summary>
        public void RouteOn(Day day)
        {
            LegPaths = new List<RoutePath>(day.legs.Length);
            var all = new List<Vector3>();
            legStart = new float[day.legs.Length];
            float acc = 0;
            for (int i = 0; i < day.legs.Length; i++)
            {
                int n = Geo.Resample(day.legs[i].polyline, Anchor.SampleStepM).Count;
                var pts = new List<Vector3>(n);
                for (int j = 0; j < n; j++) if (ground.TryGet(Anchor.Leg(i, j), out var c)) pts.Add(c.Pos);
                var path = new RoutePath(LegStyle.SmoothHeights(pts));
                LegPaths.Add(path);
                all.AddRange(path.Pts);
                legStart[i] = acc; acc += path.Length;
            }
            route = new RoutePath(all);
        }

        /// <summary>Where a thing is, or failing that its stop, or failing that the day's origin.</summary>
        Vector3 Cell(string key, int stop) =>
            ground.TryGet(key, out var c) || ground.TryGet(Anchor.Stop(stop), out c) || ground.TryGet(Anchor.Origin, out c) ? c.Pos : Vector3.zero;

        /// <summary>The way the route arrives at a stop.</summary>
        Vector3 HeadingIn(int stop)
        {
            if (LegPaths.Count == 0 || route.Length == 0) return Vector3.forward;
            int leg = Mathf.Max(0, stop - 1);
            float at = stop > 0 ? legStart[leg] + LegPaths[leg].Length : 0;
            return route.Heading(at, 25, 25, Vector3.forward);
        }

        /// <summary>A vantage on a stop (or one target at it) that can see it: start at the Director's
        /// distance and climb / back off until the line of sight is clear. Re-checked every 1.5 s
        /// because the surface refines under us as tiles stream in. `check` false only predicts.</summary>
        public void Dwell(int stop, int? beatIndex, string target, float now, out Vector3 eye, out Vector3 look, bool check = true)
        {
            var key = (stop, target ?? "");
            if (!sizes.TryGetValue(key, out var size)) size = (string.IsNullOrEmpty(target) ? Anchor.Stop(stop) : Anchor.Target(stop, target), null, float.MinValue);
            Vector3 tg = Cell(size.anchor, stop);
            // Measured when it is being looked at, and again now and then, because the surface sharpens as finer tiles arrive.
            // A prediction takes what is known: seventeen rays apiece for every shot of the day is not worth a guess.
            if (check && (size.h == null || now - size.at > 4)) sizes[key] = size = (size.anchor, ground.Measure(tg), now);
            Frame fr = Frame.For(size.h, beatIndex == null);
            Vector3 lookAt = look = new Vector3(tg.x, tg.y + fr.LookUp, tg.z);
            Vector3 hd = HeadingIn(stop);
            float ang = Mathf.Atan2(-hd.z, -hd.x) + BeatOffsets[(beatIndex ?? 0) % 4];       // behind the way we came
            Vector3 Place(float scale, float lift) => new Vector3(tg.x + Mathf.Cos(ang) * fr.Dist * scale, tg.y + fr.Up + lift, tg.z + Mathf.Sin(ang) * fr.Dist * scale);

            bool known = vantages.TryGetValue(key, out var v);
            if (check && (!known || now - v.at > 1.5f))
            {
                foreach (var (scale, lift) in Fallbacks)
                {
                    v = (scale, lift, now);
                    if (ground.LineOfSight(Place(scale, lift), lookAt)) break;
                }
                vantages[key] = v; known = true;
            }
            eye = known ? Place(v.scale, v.lift) : Place(1, 0);
        }

        Vector3 Rounded(float s)
        {
            Vector3 sum = Vector3.zero;
            for (int i = -Rounding; i <= Rounding; i++) sum += route.At(s + i * RoundM / Rounding);
            return sum / (2 * Rounding + 1);
        }

        static float Behind(float s) => ChaseBack * Geo.Smootherstep(s / TrailEaseM);

        /// <summary>The line a person is carried down over a leg. It is a path in its own right, so
        /// that a speed along it is the speed they feel.</summary>
        public RoutePath Trail(int leg)
        {
            float L = LegPaths[leg].Length;
            var pts = new List<Vector3>();
            if (L > 0) for (int i = 0; i <= Mathf.CeilToInt(L / TrailStepM); i++)
            {
                float s = Mathf.Min(L, i * TrailStepM);
                pts.Add(Rounded(legStart[leg] + s - Behind(s)) + Vector3.up * ChaseUp);
            }
            return new RoutePath(pts);
        }

        /// <summary>`d` metres down a leg's trail: the eye, what lies ahead of it, and (returned) how far along the leg the guide is.</summary>
        public float Carry(int leg, RoutePath trail, float d, out Vector3 eye, out Vector3 look)
        {
            float s = Mathf.Min(LegPaths[leg].Length, trail.IndexAt(d) * TrailStepM);
            eye = trail.At(d);
            look = Rounded(legStart[leg] + s - Behind(s) + ChaseBack + ChaseLook) + Vector3.up * 4;
            return s;
        }
    }
}

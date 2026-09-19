using System;
using System.Collections.Generic;
using Orion.Flight;
using Orion.World;
using UnityEngine;
using UnityEngine.XR;

namespace Orion
{
    /* The trip, in a headset: the real city at its real size all around, the guide flying the
     * person down each leg and stopping them at each place.
     *
     * A headset's camera cannot be written to, because it is the person's head, so what is moved
     * is their whole space (the Rig): it is carried to where a shot's eye is and turned to face
     * what the shot looks at, and the looking itself is left to them. Only position and yaw are
     * ever applied. Moving a person this way makes many of them ill, so everything about it is
     * gentle (Comfort.cs): a capped speed, eased starts and stops, a vignette that closes in while
     * moving, and a blink instead of any move that is not straight down a street: between a leg
     * and a stop, from one thing to look at to the next, across the middle of a long leg, Prev and
     * Next. "Ride: blinks" blinks the legs as well, so that nothing moves at all.
     *
     * One clock drives the rig, the captions and the voice. */

    public class FlightDeck : MonoBehaviour
    {
        const float PreloadAheadSec = 12; const int PreloadMost = 2;
        const float SettledAt = 95, SettleMaxSec = 8;          // a stop is in focus when this much (%) of what is wanted has loaded; and it is waited for no longer than this
        const float WaitingHeight = 400;                       // where a person waits, above the first stop, while there is no city yet

        Day[] days; string city;
        City world; Rig rig; Marks marks; Narration narration;
        Ground ground; Shots shots;

        int dayAt; Day day; Timeline timeline; bool smooth = true;

        // where things are on the real ground, rebuilt as the ground is found
        Vector3?[] stops = Array.Empty<Vector3?>();
        List<RoutePath> trails = new List<RoutePath>(); List<Ride> rides = new List<Ride>();
        readonly Dictionary<(int, string), Vector3> targets = new Dictionary<(int, string), Vector3>();
        readonly List<(float t, Vector3 eye, Vector3 look)> coming = new List<(float, Vector3, Vector3)>();
        readonly List<(Vector3, Vector3)> ahead = new List<(Vector3, Vector3)>();
        bool ready, groundMoved; float builtAt = float.MinValue, sweep;

        // the clock
        float t; bool playing = true;
        float settling;                                        // seconds spent waiting at this stop, or -1 once it has stopped waiting

        // the blink: anything that is not a gentle ride down a street happens behind it
        float fade = 1, fadeGoal; Action fadeThen;

        // the person's space, chasing the shots
        readonly Follower follower = new Follower();
        (int kind, int index, int part, string target) key, shot;
        Vector3 eye, look, was, drift; float yaw; bool placed, cutting;

        bool pauseHeld; float leaveHeld;
        (int stop, int beat, bool playing, bool travelling, bool ready, bool smooth, int day)? shown;      // what the panels last showed
        int fetchedFor = -1;

        public static FlightDeck Begin(Trip trip, City world, Rig rig, Marks marks, Narration narration)
        {
            var deck = rig.gameObject.AddComponent<FlightDeck>();
            deck.days = trip.days; deck.city = trip.city;
            deck.world = world; deck.rig = rig; deck.marks = marks; deck.narration = narration;
            deck.ground = new Ground(world.Georeference, world.Tiles);
            deck.shots = new Shots(deck.ground);
            deck.SetDay(0);
            return deck;
        }

        void SetDay(int index)
        {
            dayAt = index; day = days[index];
            timeline = new Timeline(day, Ride.StraightSec);      // a leg takes longer when a person is on it
            world.CentreOn(day.origin);
            ground.SetAnchors(Anchor.For(day));
            marks.SetStops(day, Jump);
            placed = false; ready = false; groundMoved = true; builtAt = float.MinValue; fetchedFor = -1;
            Jump(0);
        }

        void Jump(int stop)
        {
            t = timeline.DwellStart[Mathf.Clamp(stop, 0, day.stops.Length - 1)];
            playing = true; settling = 0; shown = null;
            groundMoved = true;                                  // the route is redrawn, so legs ahead of here are lit again
        }

        void TogglePlay()
        {
            if (t >= timeline.Total) Jump(0); else { playing = !playing; shown = null; }
        }

        static void Leave() => Application.Quit();

        /// <summary>Everything placed on the ground as it is now known: the stops, the route, the line the
        /// person is carried down each leg and the ride down it, and the shots coming up.</summary>
        void Place()
        {
            groundMoved = false; builtAt = Time.time;
            stops = new Vector3?[day.stops.Length];
            targets.Clear();
            for (int i = 0; i < stops.Length; i++)
            {
                if (ground.TryGet(Anchor.Stop(i), out var c)) stops[i] = c.Pos;
                foreach (var tg in day.stops[i].targets) if (ground.TryGet(Anchor.Target(i, tg.id), out var p)) targets[(i, tg.id)] = p.Pos;
            }
            shots.RouteOn(day);
            trails = new List<RoutePath>(); rides = new List<Ride>();
            for (int i = 0; i < day.legs.Length; i++) { trails.Add(shots.Trail(i)); rides.Add(new Ride(trails[i])); }
            ready = Array.TrueForAll(stops, s => s.HasValue) && ground.TryGet(Anchor.Stop(0), out var first) && first.Grounded;
            marks.Place(day, shots.LegPaths, stops);

            // Every shot of the day and when it comes, for the tile loader to get ahead of.
            coming.Clear();
            foreach (var seg in timeline.Segments)
            {
                if (seg.Kind == SegmentKind.Dwell)
                {
                    string seen = null; bool any = false;
                    foreach (var b in seg.Beats)
                    {
                        var v = ViewAt(seg, b.T0);
                        if (any && v.target == seen) continue;
                        shots.Dwell(v.stop, v.first, v.target, 0, out var e, out var l, check: false);
                        coming.Add((any ? b.T0 : seg.T0, e, l)); seen = v.target; any = true;
                    }
                    if (!any) { shots.Dwell(seg.Index, null, null, 0, out var e, out var l, check: false); coming.Add((seg.T0, e, l)); }
                }
                else if (rides[seg.Index].T > 0)
                    foreach (float f in new[] { .1f, .3f, .5f, .7f, .9f })
                    {
                        shots.Carry(seg.Index, trails[seg.Index], rides[seg.Index].At(f * rides[seg.Index].T).s, out var e, out var l);
                        coming.Add((seg.T0 + f * (seg.T1 - seg.T0), e, l));
                    }
            }
        }

        /// <summary>What a stop is being looked at from, at time `at`: the vantage on whatever the guide is
        /// talking about, or is about to. A person is not swung round a place between sentences the way
        /// a camera is, so they are moved only when the guide turns to a different thing, and then to the
        /// first vantage on it.</summary>
        (int stop, int? first, string target) ViewAt(Segment seg, float at)
        {
            var dwell = seg.Kind == SegmentKind.Dwell ? seg : timeline.DwellOf(seg.Index);
            if (dwell.Beats.Length == 0) return (dwell.Index, null, null);
            var slot = Array.Find(dwell.Beats, b => at < b.T1) ?? dwell.Beats[dwell.Beats.Length - 1];
            string target = slot.Beat.targetId ?? "";
            return (dwell.Index, Array.Find(dwell.Beats, b => (b.Beat.targetId ?? "") == target).Index, target);
        }

        void Update()
        {
            float raw = Time.deltaTime, dt = Mathf.Min(raw, .05f);
            if (ground.Step(Time.time)) groundMoved = true;
            if (groundMoved && Time.time - builtAt > .5f) Place();

            /* the buttons that need no aiming: A or X pauses the guide, holding B or Y leaves */
            bool pause = rig.Hands[0].Primary || rig.Hands[1].Primary;
            if (pause && !pauseHeld) TogglePlay();
            pauseHeld = pause;
            leaveHeld = rig.Hands[0].Secondary || rig.Hands[1].Secondary ? leaveHeld + dt : 0;
            if (leaveHeld > .8f) Leave();

            /* the guide's clock */
            // The timeline gives a leg the time a straight street would take. A real one has bends to slow for, so
            // while it is being ridden the clock runs slow by just enough for the ride to fit.
            var on = timeline.At(t).seg;
            Ride ride = on.Kind == SegmentKind.Travel && on.Index < rides.Count && rides[on.Index].T > 0 ? rides[on.Index] : null;
            // The guide waits for the city: for there to be one at all, and then, on arriving at a stop, for the place
            // to come into focus before it starts talking about it (a headset takes its time over that), though never for long.
            float loaded = world.Tiles.ComputeLoadProgress();
            bool arriving = on.Kind == SegmentKind.Dwell && t - on.T0 < 1;
            if (!arriving) settling = 0;
            else if (settling >= 0) settling = (settling < .5f || loaded < SettledAt) && settling < SettleMaxSec ? settling + dt : -1;
            if (playing && ready && placed && !(arriving && settling >= 0)) t = Mathf.Min(timeline.Total, t + dt * (ride != null ? (on.T1 - on.T0) / ride.T : 1));
            if (t >= timeline.Total && playing) { playing = false; shown = null; }
            var (seg, u) = timeline.At(t);
            if (!smooth && seg.Kind == SegmentKind.Travel) { t = seg.T1; (seg, u) = timeline.At(t); ride = null; }     // "Ride: blinks": a leg is not ridden at all
            var beat = seg.ActiveBeat(t);
            bool travelling = seg.Kind == SegmentKind.Travel;
            world.SetMoving(travelling);

            /* the blink */
            fade += (fadeGoal - fade) * (1 - Mathf.Exp(-dt * 16));
            if (fadeGoal == 1 && fade > .97f && fadeThen != null) { var then = fadeThen; fadeThen = null; then(); if (placed) fadeGoal = 0; }
            rig.Veil.Fade = fade;

            Vector3? guide = null;
            if (ready)
            {
                /* the shot being taken now, and which shot that is. A new one is a blink away. */
                (int, int, int, string) now;
                if (travelling && ride != null)
                {
                    var r = ride.At(u * ride.T);
                    guide = shots.LegPaths[seg.Index].At(shots.Carry(seg.Index, trails[seg.Index], r.s, out eye, out look));
                    now = (1, seg.Index, r.part, "");
                }
                else
                {
                    var v = ViewAt(seg, t);
                    shots.Dwell(v.stop, v.first, v.target, Time.time, out eye, out look);      // held still: no drift round the target with a person aboard
                    now = (0, v.stop, 0, v.target ?? "");
                }
                Vector3 to = look - eye;
                if (new Vector2(to.x, to.z).magnitude > 40) yaw = Mathf.Atan2(to.x, to.z);       // too close to what lies ahead, its bearing is noise
                // How the shot itself is moving, so that a blink in the middle of a leg sets the person down already under way.
                drift = travelling && now == shot && dt > 0 ? Vector3.ClampMagnitude((eye - was) / dt, Ride.Cruise) : Vector3.zero;
                shot = now; was = eye;

                float off = Vector3.Distance(follower.Pos, eye);
                if (!placed) { fade = 1; fadeGoal = 1; cutting = true; }                          // a new day arrives in the dark
                else if (!cutting && (now != key || off > (travelling ? 300 : 15) || Mathf.Abs(Follower.AngleTo(follower.Yaw, yaw)) > 1.6f)) { cutting = true; fadeGoal = 1; }
                if (cutting && fade > .97f) { follower.Snap(eye, yaw, drift); key = now; placed = true; cutting = false; if (fadeThen == null) fadeGoal = 0; }
                else if (cutting) follower.Coast(dt);
                else follower.Follow(eye, yaw, dt);
                rig.Carry(follower.Pos, follower.Yaw);
                rig.Veil.Vignette = follower.Motion;
            }
            else if (!placed && stops.Length > 0 && stops[0].HasValue)
            {
                // No city yet. Wait high above where it will be, clear of whatever arrives; the look-ahead cameras fetch the first vantage's tiles meanwhile.
                rig.Carry(stops[0].Value + Vector3.up * WaitingHeight, 0);
                rig.Veil.Vignette = 0;
            }

            if (!XRSettings.isDeviceActive)
            {
                // No headset (the editor): the view is from where a head would be, facing what the shot is of.
                rig.Head.transform.localPosition = Vector3.up * Rig.HeadHeight;
                if (ready) rig.Head.transform.rotation = Quaternion.LookRotation(look - rig.NominalHead, Vector3.up);
            }

            /* the shots coming up, fetched before the person gets to them */
            sweep += dt;
            if (sweep > .5f)
            {
                sweep = 0;
                ahead.Clear();
                foreach (var c in coming) if (c.t >= t - 1 && c.t <= t + PreloadAheadSec && ahead.Count < PreloadMost) ahead.Add((c.eye, c.look));
                world.LookAhead(ahead);
                rig.Console.ShowStats($"city {loaded:0}%  ·  {1 / Mathf.Max(raw, .001f):0} fps");
            }

            /* the guide: the light you follow down a leg, and a beam on whatever it is talking about */
            int cur = travelling ? seg.Index + 1 : seg.Index;
            Vector3? lit = null;
            if (!travelling && beat != null)
                lit = !string.IsNullOrEmpty(beat.Beat.targetId) && targets.TryGetValue((seg.Index, beat.Beat.targetId), out var tg) ? tg : stops[seg.Index];
            marks.Show(cur, !travelling, t, guide, lit);

            /* narration: one clip per beat, started where the clock says it should be */
            if (fetchedFor != cur) { fetchedFor = cur; narration.Fetch(day, cur, cur + 1); }
            narration.Tick(beat, t, playing && placed);

            /* what the panels show */
            var showing = (cur, beat?.Index ?? -1, playing, travelling, ready, smooth, dayAt);
            if (showing == shown) return;
            shown = showing;
            var stop = day.stops[Mathf.Min(cur, day.stops.Length - 1)];
            string targetName = beat == null || string.IsNullOrEmpty(beat.Beat.targetId) ? null : Array.Find(stop.targets, x => x.id == beat.Beat.targetId)?.name;
            int count = day.stops.Length;
            rig.Captions.Show(
                $"STOP {Mathf.Min(cur + 1, count)} OF {count}{(travelling ? "  ·  ON THE WAY" : "")}",
                stop.name,
                !ready ? $"Finding {city}…" : beat?.Beat.text ?? (travelling ? "" : "…"),
                targetName);
            rig.Console.Set(playing, smooth,
                days.Length > 1 ? $"Day {day.number}{(string.IsNullOrEmpty(day.title) ? "" : " · " + day.title)}" : null,
                onPrev: () => Jump(cur - 1), onPlay: TogglePlay, onNext: () => Jump(cur + 1),
                onSmooth: () => { smooth = !smooth; shown = null; },
                onDay: () => { fadeGoal = 1; fadeThen = () => SetDay((dayAt + 1) % days.Length); },
                onLeave: Leave);
        }
    }
}

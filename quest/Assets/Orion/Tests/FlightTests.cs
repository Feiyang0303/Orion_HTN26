using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using Orion.Flight;
using UnityEngine;

namespace Orion.Tests
{
    /// <summary>The flight's logic, which needs no city and no headset: the schedule, the ride, the follower.</summary>
    public class FlightTests
    {
        static Day Fixture() => JsonUtility.FromJson<Day>(File.ReadAllText($"{Application.dataPath}/Orion/Fixtures/paris-short-v1.json"));

        static RoutePath Street(params (float x, float z)[] corners)
        {
            var pts = new List<Vector3>();
            for (int i = 1; i < corners.Length; i++)
                for (int k = 0; k < 20; k++) pts.Add(Vector3.Lerp(new Vector3(corners[i - 1].x, 0, corners[i - 1].z), new Vector3(corners[i].x, 0, corners[i].z), k / 20f));
            pts.Add(new Vector3(corners[corners.Length - 1].x, 0, corners[corners.Length - 1].z));
            return new RoutePath(pts);
        }

        [Test]
        public void TheFixtureParsesAsADay()
        {
            var day = Fixture();
            Assert.AreEqual(3, day.stops.Length);
            Assert.AreEqual(2, day.legs.Length);
            Assert.AreEqual("Les Invalides", day.stops[0].name);
            Assert.AreEqual(6, day.stops[0].targets.Length);
            Assert.AreEqual(6.15f, day.stops[0].beats[0].durationSec, 1e-3f);
            Assert.IsTrue(string.IsNullOrEmpty(day.stops[0].beats[0].audioUrl));
            Assert.AreEqual(34, day.legs[0].polyline.Length);
            Assert.AreEqual(1, day.number);
        }

        [Test]
        public void ADwellLastsAsLongAsItsBeats()
        {
            var day = Fixture();
            var tl = new Timeline(day, Ride.StraightSec);
            var first = tl.Segments[0];
            Assert.AreEqual(SegmentKind.Dwell, first.Kind);
            float beats = 0;
            foreach (var b in day.stops[0].beats) beats += b.durationSec;
            Assert.AreEqual(Timeline.LeadSec + beats + Timeline.BeatGap * day.stops[0].beats.Length + Timeline.TailSec, first.T1 - first.T0, 1e-3f);
            Assert.AreEqual(SegmentKind.Travel, tl.Segments[1].Kind);
            Assert.AreEqual(tl.Segments[tl.Segments.Count - 1].T1, tl.Total);
            Assert.AreEqual(first.T1, tl.DwellStart[1] - (tl.Segments[1].T1 - tl.Segments[1].T0), 1e-3f);
        }

        [Test]
        public void TheClockFindsItsBeat()
        {
            var tl = new Timeline(Fixture(), Ride.StraightSec);
            var dwell = tl.Segments[0];
            Assert.IsNull(dwell.ActiveBeat(dwell.T0 + .5f), "nothing is said during the lead-in");
            Assert.AreEqual(0, dwell.ActiveBeat(dwell.T0 + Timeline.LeadSec + .1f).Index);
            Assert.AreEqual(1, dwell.ActiveBeat(dwell.Beats[1].T0 + .1f).Index);
            Assert.AreSame(tl.Segments[tl.Segments.Count - 1], tl.At(1e9f).seg);
            Assert.AreEqual(1, tl.At(1e9f).u);
        }

        [Test]
        public void AStraightRideKeepsToTheComfortLimits()
        {
            var ride = new Ride(Street((0, 0), (0, 800)));
            Assert.AreEqual(Ride.StraightSec(800), ride.T, 1.5f);
            float last = 0, lastV = 0;
            for (float t = 0; t <= ride.T; t += .1f)
            {
                float s = ride.At(t).s, v = (s - last) / .1f;
                Assert.LessOrEqual(v, Ride.Cruise + .5f, $"speed at {t:0.0}s");
                if (t > .2f) Assert.LessOrEqual(Mathf.Abs(v - lastV) / .1f, 3.6f, $"acceleration at {t:0.0}s");
                last = s; lastV = v;
            }
            Assert.AreEqual(800, ride.At(ride.T).s, 1f);
        }

        [Test]
        public void TheRidesSpeedIsTheSlopeOfItsDistance()
        {
            var ride = new Ride(Street((0, 0), (0, 300), (300, 300)));
            Assert.AreEqual(.5f, ride.SpeedAt(0), 1e-3f, "it sets off from rest");
            for (float t = .5f; t < ride.T - .5f; t += .37f)
            {
                float slope = (ride.At(t + .01f).s - ride.At(t - .01f).s) / .02f;
                Assert.AreEqual(slope, ride.SpeedAt(t), .35f, $"at {t:0.00}s");
                Assert.LessOrEqual(ride.SpeedAt(t), Ride.Cruise + 1e-3f);
            }
        }

        [Test]
        public void ABendIsSlowedFor()
        {
            var straight = new Ride(Street((0, 0), (0, 600)));
            var bent = new Ride(Street((0, 0), (0, 300), (300, 300)));
            Assert.Greater(bent.T, straight.T);
        }

        [Test]
        public void ALongLegIsFlownOnlyAtItsEnds()
        {
            var ride = new Ride(Street((0, 0), (0, 3000)));
            Assert.Less(ride.T, Ride.StraightSec(1000) + 12, "the middle is not flown");
            bool jumped = false; float last = 0;
            for (float t = 0; t <= ride.T; t += .05f)
            {
                var (s, part) = ride.At(t);
                if (s - last > 100) { jumped = true; Assert.AreEqual(1, part); }
                last = s;
            }
            Assert.IsTrue(jumped, "there is a blink across the middle");
            Assert.AreEqual(0, ride.At(1).part);
        }

        [Test]
        public void TheFollowerIsCapped()
        {
            var f = new Follower();
            f.Snap(Vector3.zero, 0, Vector3.zero);
            Vector3 lastVel = Vector3.zero; float lastTurn = 0;
            for (int i = 0; i < 72 * 20; i++)
            {
                f.Follow(new Vector3(0, 0, 5000), 3, 1 / 72f);
                Assert.LessOrEqual(f.Vel.magnitude, 40.01f);
                Assert.LessOrEqual((f.Vel - lastVel).magnitude * 72, 8.01f);
                Assert.LessOrEqual(Mathf.Abs(f.Turn), .4501f);
                Assert.LessOrEqual(Mathf.Abs(f.Turn - lastTurn) * 72, .801f);
                lastVel = f.Vel; lastTurn = f.Turn;
            }
            Assert.AreEqual(3, f.Yaw, .05f, "it settles facing where it was told");
            Assert.AreEqual(1, f.Motion, 1e-3f);
        }

        [Test]
        public void YawGoesTheShortWayRound()
        {
            Assert.AreEqual(.2f, Follower.AngleTo(-.1f, .1f), 1e-5f);
            Assert.AreEqual(-.2f, Follower.AngleTo(.1f - Mathf.PI, Mathf.PI - .1f), 1e-4f);
        }

        [Test]
        public void ASpikeInTheRouteIsFlattened()
        {
            var pts = new List<Vector3>();
            for (int i = 0; i < 20; i++) pts.Add(new Vector3(i * 30, i == 10 ? 25 : 0, 0));       // a tree over the street
            var smooth = LegStyle.SmoothHeights(pts);
            foreach (var p in smooth) Assert.Less(p.y, 1f);
            Assert.AreEqual(pts[10].x, smooth[10].x);
        }

        [Test]
        public void APathIsMeasuredInMetres()
        {
            var path = Street((0, 0), (0, 100), (100, 100));
            Assert.AreEqual(200, path.Length, 1e-2f);
            Assert.AreEqual(new Vector3(50, 0, 100), path.At(150));
            Assert.AreEqual(Vector3.forward, path.Heading(50, 15, 40, Vector3.right));
            Assert.AreEqual(Vector3.right, path.Heading(-5, 0, 0, Vector3.right), "a degenerate stretch falls back");
        }

        [Test]
        public void ResamplingKeepsBothEndsAndTheSpacing()
        {
            var line = Fixture().legs[0].polyline;
            var pts = Geo.Resample(line, Anchor.SampleStepM);
            Assert.AreEqual(line[0].lat, pts[0].lat);
            Assert.AreEqual(line[line.Length - 1].lon, pts[pts.Count - 1].lon);
            for (int i = 1; i < pts.Count; i++) Assert.LessOrEqual(Geo.MetresBetween(pts[i - 1], pts[i]), Anchor.SampleStepM + .01);
        }

        /// <summary>A day shaped like the ones the web app really sends: some stops the guide says nothing at, and no clips.</summary>
        static Day Sparse() => new Day
        {
            origin = new LatLon { lat = 43.65, lon = -79.38 },
            stops = new[]
            {
                new Stop { id = "a", name = "A" },
                new Stop { id = "b", name = "B", beats = new[] { new Beat { text = "One.", durationSec = 11.2f }, new Beat { text = "Two.", targetId = "t", durationSec = 3 } } },
                new Stop { id = "c", name = "C" },
            },
            legs = new[] { new Leg { transport = "walk", distanceM = 1063 }, new Leg { transport = "transit", distanceM = 3699 } },
        };

        [Test]
        public void AStopWithNothingSaidIsStillVisited()
        {
            var tl = new Timeline(Sparse(), Ride.StraightSec);
            var silent = tl.Segments[0];
            Assert.AreEqual(0, silent.Beats.Length);
            Assert.AreEqual(Timeline.LeadSec + Timeline.TailSec + 2, silent.T1 - silent.T0, 1e-4f, "long enough to look around");
            Assert.IsNull(silent.ActiveBeat(silent.T0 + 1));
            Assert.AreEqual(5, tl.Segments.Count);
            Assert.AreSame(tl.Segments[2], tl.DwellOf(1));
            Assert.AreEqual(tl.Segments[4].T0, tl.DwellStart[2]);
        }

        [Test]
        public void TheWelcomeTheLinesOnTheWayAndTheGoodbyeAreAllGivenTheirTime()
        {
            var day = Sparse();
            day.opening = new Beat { text = "Welcome.", durationSec = 4 };
            day.closing = new Beat { text = "Goodbye.", durationSec = 3 };
            day.legs[0].bridge = new Beat { text = "A very long line said on the way.", durationSec = 60 };
            var tl = new Timeline(day, Ride.StraightSec);
            Assert.AreEqual(SegmentKind.Hold, tl.Segments[0].Kind);
            Assert.AreEqual(Timeline.HoldLeadSec + 4 + Timeline.TailSec, tl.Segments[0].T1, 1e-4f);
            Assert.AreEqual(tl.Segments[0].T1, tl.DwellStart[0], "the first stop follows the welcome");
            var leg = tl.Segments[2];
            Assert.AreEqual(SegmentKind.Travel, leg.Kind);
            Assert.AreEqual(Timeline.BridgeLeadSec + 60 + Timeline.TailSec, leg.T1 - leg.T0, 1e-3f, "a leg is never cut short of its own line");
            Assert.AreEqual("A very long line said on the way.", leg.ActiveBeat(leg.T0 + 10).Beat.text);
            var last = tl.Segments[tl.Segments.Count - 1];
            Assert.AreEqual(SegmentKind.Hold, last.Kind);
            Assert.AreEqual(2, last.Index, "the goodbye is said at the last stop");
            Assert.AreEqual(5, new List<Beat>(day.Spoken()).Count);
        }

        [Test]
        public void ALongLegCostsNoMoreClockThanAKilometre()
        {
            Assert.AreEqual(Ride.StraightSec(1000), Ride.StraightSec(3699));
            var tl = new Timeline(Sparse(), Ride.StraightSec);
            Assert.AreEqual(Ride.StraightSec(1000), tl.Segments[3].T1 - tl.Segments[3].T0, 1e-4f);
        }

        [Test]
        public void OnlyTheCityTouchesTheTileset()
        {
            // Most of Cesium3DTileset's setters reload it, and a reload is a billed request to Google. One set in a per-frame
            // loop once spent a day's quota in two minutes. So the type may be named in one file only.
            foreach (string file in Directory.GetFiles($"{Application.dataPath}/Orion/Runtime", "*.cs", SearchOption.AllDirectories))
                if (Path.GetFileName(file) != "City.cs") StringAssert.DoesNotContain("Cesium3DTileset", File.ReadAllText(file), Path.GetFileName(file));
        }

        [Test]
        public void TheCitySetsTheTilesetUpInOnePlace()
        {
            string city = File.ReadAllText($"{Application.dataPath}/Orion/Runtime/World/City.cs");
            int make = city.IndexOf("public static City Make", System.StringComparison.Ordinal), end = city.IndexOf("return city;", make, System.StringComparison.Ordinal);
            var assignments = System.Text.RegularExpressions.Regex.Matches(city, @"\b(t|tiles)\.[a-zA-Z]+\s*=[^=]");
            Assert.Greater(assignments.Count, 5);
            foreach (System.Text.RegularExpressions.Match m in assignments) Assert.IsTrue(m.Index > make && m.Index < end, $"'{m.Value.Trim()}' is set outside Make");
        }

        [Test]
        public void TheDirectorNeverComesCloserThanPhotogrammetryAllows()
        {
            foreach (float h in new[] { 0f, 25f, 60f, 120f, 250f })
                foreach (bool wide in new[] { true, false })
                {
                    var f = Frame.For(h, wide);
                    Assert.GreaterOrEqual(Mathf.Sqrt(f.Dist * f.Dist + (f.Up - f.LookUp) * (f.Up - f.LookUp)), 69.9f);
                }
            Assert.Greater(Frame.For(120, true).Dist, Frame.For(10, true).Dist, "a tower is seen from farther than a statue");
            Assert.AreEqual(Frame.For(25, false).Dist, Frame.For(null, false).Dist, "unknown is taken to be building-sized");
        }
    }
}

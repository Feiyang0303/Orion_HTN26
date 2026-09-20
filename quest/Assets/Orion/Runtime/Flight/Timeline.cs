using System;
using System.Collections.Generic;

namespace Orion.Flight
{
    /* The flight as a schedule, built from a Day and nothing else. Playback just asks "what is
     * happening at time t?". Every duration that matters comes from the day: a dwell is as long as
     * its beats, so the rig never outruns or waits on the guide.
     *
     *   hold(welcome) → dwell(stop 0) → travel(leg 0) → dwell(stop 1) → … → dwell(last) → hold(goodbye)
     *
     * The gaps are deliberately small: a beat is a sentence or two of one continuous talk, not a
     * slide. What silence there is belongs at the seams.
     *
     * The web flight dives from its planning view after the welcome. A headset has no planning view
     * to dive from: a day arrives in the dark at its first place, and the welcome is said there. */

    public enum SegmentKind { Hold, Dwell, Travel }

    public class BeatSlot { public int Index; public float T0, T1; public Beat Beat; }

    public class Segment
    {
        public SegmentKind Kind;
        /// <summary>The stop of a dwell, the leg of a travel, and the stop a hold is said at.</summary>
        public int Index;
        public float T0, T1;
        /// <summary>A dwell's beats; a travel's bridge line, if it has one; a hold's welcome or goodbye.</summary>
        public BeatSlot[] Beats = Array.Empty<BeatSlot>();

        /// <summary>The beat being spoken at time t, or null during lead-in and gaps.</summary>
        public BeatSlot ActiveBeat(float t)
        {
            foreach (var b in Beats) if (t >= b.T0 && t < b.T1) return b;
            return null;
        }
    }

    public class Timeline
    {
        public const float LeadSec = .7f;          // the view settles before the guide speaks
        public const float BeatGap = .12f;         // breath between beats: a breath, not a pause
        public const float TailSec = .5f;          // hold after the last beat before moving on
        public const float HoldLeadSec = .6f;      // before the welcome and the goodbye
        public const float BridgeLeadSec = .35f;   // the person is under way before the line on the way is spoken

        public readonly List<Segment> Segments = new List<Segment>();
        public readonly float Total;
        /// <summary>Start time of each stop's dwell, indexed by stop.</summary>
        public readonly float[] DwellStart;

        /// <summary>`travelSec` is how long a leg of a given length takes.</summary>
        public Timeline(Day day, Func<float, float> travelSec)
        {
            DwellStart = new float[day.stops.Length];
            float t = 0;

            // A beat said over a view the person is already at: the segment is exactly as long as the words.
            void Hold(Beat beat, int stop)
            {
                if (beat == null || !beat.Said) return;
                var slot = new BeatSlot { T0 = t + HoldLeadSec, T1 = t + HoldLeadSec + beat.durationSec, Beat = beat };
                Segments.Add(new Segment { Kind = SegmentKind.Hold, Index = stop, T0 = t, T1 = slot.T1 + TailSec, Beats = new[] { slot } });
                t = slot.T1 + TailSec;
            }

            Hold(day.opening, 0);
            for (int i = 0; i < day.stops.Length; i++)
            {
                DwellStart[i] = t;
                float c = t + LeadSec;
                var beats = new BeatSlot[day.stops[i].beats.Length];
                for (int k = 0; k < beats.Length; k++)
                {
                    var beat = day.stops[i].beats[k];
                    beats[k] = new BeatSlot { Index = k, T0 = c, T1 = c + beat.durationSec, Beat = beat };
                    c = beats[k].T1 + BeatGap;
                }
                float end = Math.Max(c + TailSec, t + LeadSec + TailSec + 2);
                Segments.Add(new Segment { Kind = SegmentKind.Dwell, Index = i, T0 = t, T1 = end, Beats = beats });
                t = end;
                if (i >= day.legs.Length) continue;

                // A leg is never cut short of its own line: if the words outlast the ride, the ride is taken more slowly.
                var leg = day.legs[i];
                float arrive = t + travelSec(leg.distanceM);
                var said = Array.Empty<BeatSlot>();
                if (leg.bridge != null && leg.bridge.Said)
                {
                    var slot = new BeatSlot { T0 = t + BridgeLeadSec, T1 = t + BridgeLeadSec + leg.bridge.durationSec, Beat = leg.bridge };
                    said = new[] { slot };
                    arrive = Math.Max(arrive, slot.T1 + TailSec);
                }
                Segments.Add(new Segment { Kind = SegmentKind.Travel, Index = i, T0 = t, T1 = arrive, Beats = said });
                t = arrive;
            }
            Hold(day.closing, Math.Max(0, day.stops.Length - 1));
            Total = t;
        }

        /// <summary>The segment containing t (clamped to the ends) and how far through it, 0..1.</summary>
        public (Segment seg, float u) At(float time)
        {
            float c = Math.Min(Math.Max(time, 0), Total);
            Segment seg = Segments[Segments.Count - 1];
            foreach (var s in Segments) if (c < s.T1) { seg = s; break; }
            return (seg, seg.T1 > seg.T0 ? Math.Min(1, (c - seg.T0) / (seg.T1 - seg.T0)) : 1);
        }

        public Segment DwellOf(int stop) => Segments.Find(s => s.Kind == SegmentKind.Dwell && s.Index == stop);
    }
}

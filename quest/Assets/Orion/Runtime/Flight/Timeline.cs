using System;
using System.Collections.Generic;

namespace Orion.Flight
{
    /* The flight as a schedule, built from a Day and nothing else. Playback just asks "what is
     * happening at time t?". Dwell at a stop is the sum of its beats' audio lengths, so the rig
     * never outruns or waits on the guide.
     *
     *   dwell(stop 0) → travel(leg 0) → dwell(stop 1) → … → dwell(last)
     *
     * The web flight opens with a dive from its planning view. A headset has no planning view to
     * dive from: a day arrives in the dark, at its first stop. */

    public enum SegmentKind { Dwell, Travel }

    public class BeatSlot { public int Index; public float T0, T1; public Beat Beat; }

    public class Segment
    {
        public SegmentKind Kind;
        public int Index;                               // the stop of a dwell, the leg of a travel
        public float T0, T1;
        public BeatSlot[] Beats = Array.Empty<BeatSlot>();

        /// <summary>The beat being spoken at time t, or null during lead-in, gaps and travel.</summary>
        public BeatSlot ActiveBeat(float t)
        {
            foreach (var b in Beats) if (t >= b.T0 && t < b.T1) return b;
            return null;
        }
    }

    public class Timeline
    {
        public const float LeadSec = 1.4f;   // the view settles before the guide speaks
        public const float BeatGap = .35f;   // breath between beats
        public const float TailSec = 1.0f;   // hold after the last beat before moving on

        public readonly List<Segment> Segments = new List<Segment>();
        public readonly float Total;
        /// <summary>Start time of each stop's dwell, indexed by stop.</summary>
        public readonly float[] DwellStart;

        /// <summary>`travelSec` is how long a leg of a given length takes.</summary>
        public Timeline(Day day, Func<float, float> travelSec)
        {
            DwellStart = new float[day.stops.Length];
            float t = 0;
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
                if (i < day.legs.Length) Segments.Add(new Segment { Kind = SegmentKind.Travel, Index = i, T0 = t, T1 = t += travelSec(day.legs[i].distanceM) });
            }
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

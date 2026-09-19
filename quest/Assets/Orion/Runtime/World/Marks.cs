using System;
using System.Collections.Generic;
using Orion.Flight;
using TMPro;
using UnityEngine;

namespace Orion.World
{
    /* What is drawn on the city: the route, a pin on each stop, the guide's light to follow down
     * a leg, and a beam and ring on whatever is being described. Sized in `Unit`s, large enough to
     * read from a vantage's distance; the guide is just ahead of the person, so it has its own. */

    public class Marks : MonoBehaviour
    {
        const float Unit = 900 * Frame.Closer, GuideUnit = 250;
        const float Lift = .0015f * Unit + 2;                 // the route floats this far above the street it was measured on
        const float PinHeight = .034f * Unit;

        readonly List<GameObject> legs = new List<GameObject>();
        readonly List<Pin> pins = new List<Pin>();
        Transform orb, beam, head;
        Material played;
        int playedLegs;                                        // legs already behind the person are dimmed, once

        class Pin { public Transform Root, Face; public Renderer Ball; public TextMeshPro Name; public Pointable Hit; }

        public void Build(Transform head)
        {
            this.head = head;
            played = Look.Flat(Look.Amber.Alpha(.4f));

            orb = new GameObject("Guide").transform;
            orb.SetParent(transform, false);
            Look.Draw("Core", orb, Meshes.Sphere(.011f * GuideUnit, 24, 16), Look.Flat(Look.Warm));
            Look.Draw("Halo", orb, Meshes.Sphere(.026f * GuideUnit, 24, 16), Look.Flat(Look.Amber.Alpha(.22f)));

            beam = new GameObject("Beam").transform;
            beam.SetParent(transform, false);
            Look.Draw("Shaft", beam, Meshes.Shaft(.0012f * Unit, .0035f * Unit, .1f * Unit), Look.Flat(Look.Amber.Alpha(.35f)));
            Look.Draw("Ring", beam, Meshes.Ring(.012f * Unit, .0155f * Unit, 48), Look.Flat(Look.Amber.Alpha(.9f), depthTest: false)).transform.localPosition = Vector3.up * .002f * Unit;

            orb.gameObject.SetActive(false);
            beam.gameObject.SetActive(false);
        }

        /// <summary>A pin on each stop of a new day. `onPick` is told which one was pointed at and chosen.</summary>
        public void SetStops(Day day, Action<int> onPick)
        {
            foreach (var p in pins) Destroy(p.Root.gameObject);
            pins.Clear();
            for (int i = 0; i < day.stops.Length; i++)
            {
                int stop = i;
                var root = new GameObject($"Pin {i + 1}").transform;
                root.SetParent(transform, false);
                Look.Draw("Stem", root, Meshes.Shaft(.0007f * Unit, .0007f * Unit, PinHeight, 8), Look.Flat(Look.Amber));
                var ball = Look.Draw("Ball", root, Meshes.Sphere(.0085f * Unit, 24, 16), Look.Flat(Look.Amber, depthWrite: true));
                ball.transform.localPosition = Vector3.up * (PinHeight + .008f * Unit);
                var face = new GameObject("Face").transform;
                face.SetParent(ball.transform, false);
                var number = Look.Text("Number", face, .0105f * Unit, Look.Ink, TextAlignmentOptions.Center, new Vector2(.03f, .02f) * Unit);
                number.text = (i + 1).ToString();
                number.transform.localPosition = Vector3.back * .0088f * Unit;
                var label = Look.Text("Name", face, .0125f * Unit, Look.Cream, TextAlignmentOptions.Bottom, new Vector2(.14f, .06f) * Unit);
                label.text = day.stops[i].name;
                label.outlineColor = Look.Background; label.outlineWidth = .2f;
                label.transform.localPosition = Vector3.up * (.0135f + .03f) * Unit;
                var hit = Pointable.On(ball, .0085f * Unit, () => onPick(stop));
                pins.Add(new Pin { Root = root, Face = face, Ball = ball.GetComponent<Renderer>(), Name = label, Hit = hit });
                root.gameObject.SetActive(false);
            }
        }

        /// <summary>The route and the pins, on the ground as it is now known.</summary>
        public void Place(Day day, IReadOnlyList<RoutePath> paths, IReadOnlyList<Vector3?> stops)
        {
            foreach (var l in legs) Destroy(l);
            legs.Clear();
            playedLegs = 0;
            for (int i = 0; i < paths.Count; i++)
            {
                var path = paths[i];
                if (path.Pts.Count < 2) { legs.Add(new GameObject($"Leg {i} (unplaced)")); legs[i].transform.SetParent(transform, false); continue; }
                var style = LegStyle.For(day.legs[i].transport, day.legs[i].estimated);
                var leg = new GameObject($"Leg {i}");
                leg.transform.SetParent(transform, false);
                var colour = Look.Flat(Look.Amber.Alpha(style.Opacity));
                if (style.BeadGap > 0)
                {
                    var at = new List<Vector3>();
                    for (float s = 0; s <= path.Length; s += style.BeadGap) at.Add(path.At(s) + Vector3.up * Lift);
                    Look.Draw("Beads", leg.transform, Meshes.Beads(at, style.Radius * 1.35f), colour);
                }
                else
                {
                    var line = new List<Vector3>(path.Pts.Count);
                    foreach (var p in path.Pts) line.Add(p + Vector3.up * Lift);
                    Look.Draw("Ribbon", leg.transform, Meshes.Tube(line, style.Radius), colour);
                    if (style.Glow) Look.Draw("Glow", leg.transform, Meshes.Tube(line, style.Radius * 2.6f), Look.Flat(Look.Amber.Alpha(.14f)));
                }
                legs.Add(leg);
            }
            for (int i = 0; i < pins.Count; i++)
            {
                pins[i].Root.gameObject.SetActive(stops[i].HasValue);
                if (stops[i].HasValue) pins[i].Root.position = stops[i].Value;
            }
        }

        /// <summary>Each frame: which stop is current, where the guide's light is, what the beam is on.</summary>
        public void Show(int currentStop, bool dwelling, float t, Vector3? guide, Vector3? target)
        {
            orb.gameObject.SetActive(guide.HasValue);
            if (guide.HasValue) orb.position = guide.Value + Vector3.up * (.03f * GuideUnit + Mathf.Sin(t * 2.2f) * .003f * GuideUnit);
            beam.gameObject.SetActive(target.HasValue);
            if (target.HasValue) beam.position = target.Value;

            for (int i = 0; i < pins.Count; i++)
            {
                var p = pins[i];
                bool active = i == currentStop;
                p.Root.localScale = Vector3.one * (1 + (dwelling && active ? .18f + Mathf.Sin(t * 4) * .08f : 0));
                p.Ball.sharedMaterial.color = active ? Look.Warm : Look.Amber;
                p.Ball.transform.localScale = Vector3.one * (p.Hit.Hot ? 1.2f : 1);
                p.Name.gameObject.SetActive(active);
                p.Face.rotation = Quaternion.LookRotation(p.Face.position - head.position, Vector3.up);     // text reads from its back, so it looks away from the reader
            }
            for (; playedLegs < Mathf.Min(currentStop, legs.Count); playedLegs++)
                foreach (var r in legs[playedLegs].GetComponentsInChildren<Renderer>()) if (r.name != "Glow") r.sharedMaterial = played;
        }
    }
}

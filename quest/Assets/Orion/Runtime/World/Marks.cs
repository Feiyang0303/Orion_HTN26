using System;
using System.Collections.Generic;
using Orion.Flight;
using TMPro;
using UnityEngine;

namespace Orion.World
{
    /* What is drawn on the city, in the manner of the desktop flight.
     *
     *   the route    light laid along the street (Orion/Route), each leg in the manner it is travelled; a leg by transit
     *                as what it is made of: a walk to the platform, the ride in the line's own colour between two marked
     *                stations, a walk out; a leg nobody could route as a faint broken arc over the city. Nothing rides
     *                it for show: on the leg being flown, the ribbon burns brightest just behind the guide
     *   a stop       a small amber disc with its number, and its name on a chip of dark glass beside it. It is a
     *                label, not an object: it faces the person, is drawn over whatever stands in front of it, and is
     *                the same size to the eye from any distance, as a label on a screen is
     *   the subject  a ring on the ground that breathes, a ripple leaving it, and a hairline of light standing on it
     *   the guide    a small light to follow down a leg
     */

    public class Marks : MonoBehaviour
    {
        const float Lift = 3;                                  // the route floats this far above the street it was measured on
        const float TagHeight = 30;                            // a stop's label stands this far above its ground
        const float TagSize = .033f;                           // and its disc is this wide to the eye: the tangent of 1.9 degrees, which a headset's ~20 pixels a degree can read
        const float RingInner = 9, RingOuter = 11.5f, BeamHeight = 48;
        const float GuideRadius = 1.3f;                        // the guide is a small light: on the leg being flown it is the ribbon that says where it is

        static readonly int Head = Shader.PropertyToID("_Head"), Opacity = Shader.PropertyToID("_Opacity"), MinWidth = Shader.PropertyToID("_MinWidth"), FlowMps = Shader.PropertyToID("_FlowMps");

        /// <summary>A leg as drawn: its ribbons' materials (those that show the traveller's wake, and all of them), and the
        /// labels that stand on it.</summary>
        class Drawn { public GameObject Root; public List<Material> Wake = new List<Material>(), All = new List<Material>(); }
        /// <summary>A label that faces the person and is the same size to the eye from any distance.</summary>
        class Label { public Transform Tag; public float Size; }
        class Pin { public Transform Root, Tag; public Material Disc; public TextMeshPro Number, Name; public ChipLook Chip; public Pointable Hit; }
        /// <summary>The materials of a name chip, so it can be dimmed as one.</summary>
        class ChipLook { public Material Border, Fill; }

        readonly List<Drawn> legs = new List<Drawn>();
        readonly List<Pin> pins = new List<Pin>();
        readonly List<Label> labels = new List<Label>();
        Transform orb, halo, subject, ring, ripple, head;
        Material rippleLook;
        Color colour = Look.Amber;
        int playedLegs;                                        // legs already behind the person are dimmed, once

        public void Build(Transform head)
        {
            this.head = head;

            orb = new GameObject("Guide").transform;
            orb.SetParent(transform, false);
            Look.Draw("Core", orb, Meshes.Sphere(GuideRadius, 24, 16), Look.Flat(Look.Warm));
            halo = Look.Draw("Halo", orb, Meshes.Sphere(GuideRadius * 2.4f, 24, 16), Look.Flat(Look.Amber.Alpha(.16f))).transform;

            subject = new GameObject("Subject").transform;
            subject.SetParent(transform, false);
            ring = Look.Draw("Ring", subject, Meshes.Ring(RingInner, RingOuter, 64), Look.Flat(Look.Amber.Alpha(.9f), depthTest: false)).transform;
            rippleLook = Look.Flat(Look.Amber.Alpha(.5f), depthTest: false);
            ripple = Look.Draw("Ripple", subject, Meshes.Ring(RingOuter, RingOuter + 1.2f, 64), rippleLook).transform;
            Look.Draw("Beam", subject, Meshes.Shaft(.32f, .12f, BeamHeight, 8), Look.Flat(Look.Amber.Alpha(.75f), depthTest: false));
            ring.localPosition = ripple.localPosition = Vector3.up * 1.5f;

            orb.gameObject.SetActive(false);
            subject.gameObject.SetActive(false);
        }

        /// <summary>A label on each stop of a new day. `onPick` is told which one was pointed at and chosen.</summary>
        public void SetStops(Day day, Action<int> onPick)
        {
            foreach (var p in pins) Destroy(p.Root.gameObject);
            pins.Clear();
            colour = Look.Days[(Mathf.Max(1, day.number) - 1) % Look.Days.Length];
            for (int i = 0; i < day.stops.Length; i++)
            {
                int stop = i;
                var pin = new Pin { Root = new GameObject($"Stop {i + 1}").transform };
                pin.Root.SetParent(transform, false);
                Look.Draw("Stem", pin.Root, Meshes.Shaft(.18f, .18f, TagHeight, 6), Look.Flat(colour.Alpha(.45f)));

                // The label is laid out with its disc one unit wide, and scaled each frame to be the same size to the eye.
                pin.Tag = new GameObject("Tag").transform;
                pin.Tag.SetParent(pin.Root, false);
                pin.Tag.localPosition = Vector3.up * TagHeight;
                pin.Disc = Look.Flat(colour, depthTest: false);
                var disc = Look.Draw("Disc", pin.Tag, Meshes.RoundedRect(1, 1, .5f, 12), pin.Disc, 10);
                pin.Number = Look.Text("Number", pin.Tag, Face.SansBold, .5f, Look.Ink, TextAlignmentOptions.Center, new Vector2(1, 1), onTop: true, order: 12);
                pin.Number.text = (i + 1).ToString();
                pin.Number.transform.localPosition = Vector3.back * .01f;

                pin.Name = Look.Text("Name", pin.Tag, Face.Sans, .42f, Look.Soft, TextAlignmentOptions.Left, new Vector2(12, 1), onTop: true, order: 12);
                pin.Name.textWrappingMode = TextWrappingModes.NoWrap;
                pin.Name.text = day.stops[i].name;
                pin.Name.ForceMeshUpdate();
                float wide = pin.Name.preferredWidth + .6f;
                var chip = Look.Panel("Chip", pin.Tag, wide, .86f, .43f, .78f, onTop: true, order: 10, Hairline: .03f);
                chip.transform.localPosition = new Vector3(.75f + wide / 2, 0, 0);
                pin.Name.rectTransform.pivot = new Vector2(0, .5f);
                pin.Name.transform.localPosition = new Vector3(.75f + .3f, 0, -.02f);
                pin.Chip = new ChipLook { Border = chip.GetComponent<Renderer>().sharedMaterial, Fill = chip.transform.GetChild(0).GetComponent<Renderer>().sharedMaterial };

                pin.Hit = Pointable.On(disc, .7f, () => onPick(stop));
                pin.Root.gameObject.SetActive(false);
                pins.Add(pin);
            }
        }

        /// <summary>The route and the labels, on the ground as it is now known.</summary>
        public void Place(Day day, IReadOnlyList<RoutePath> paths, IReadOnlyList<Vector3?> stops)
        {
            foreach (var l in legs) Destroy(l.Root);
            legs.Clear(); labels.Clear();
            playedLegs = 0;
            for (int i = 0; i < paths.Count; i++)
            {
                var leg = new Drawn { Root = new GameObject($"Leg {i}") };
                leg.Root.transform.SetParent(transform, false);
                legs.Add(leg);
                if (paths[i].Pts.Count >= 2) Draw(leg, day.legs[i], paths[i]);
            }
            for (int i = 0; i < pins.Count; i++)
            {
                pins[i].Root.gameObject.SetActive(stops[i].HasValue);
                if (stops[i].HasValue) pins[i].Root.position = stops[i].Value;
            }
        }

        void Draw(Drawn drawn, Leg leg, RoutePath ground)
        {
            var whole = LegStyle.For(leg.transport, leg.estimated);
            // A leg that could not be routed is two points and a guess. It is lifted into an arc over the city, because a
            // straight line through the buildings reads as a street that is not there.
            var path = ground;
            if (whole.Guess)
            {
                float span = Vector3.Distance(ground.Pts[0], ground.Pts[ground.Pts.Count - 1]), rise = Mathf.Min(160, span * .16f), run = 0;
                var arc = new List<Vector3>(ground.Pts.Count);
                for (int k = 0; k < ground.Pts.Count; k++)
                {
                    if (k > 0) run += Vector3.Distance(ground.Pts[k], ground.Pts[k - 1]);
                    arc.Add(ground.Pts[k] + Vector3.up * (Mathf.Sin(Mathf.PI * Mathf.Min(1, run / Mathf.Max(1, span))) * rise));
                }
                path = new RoutePath(arc);
            }

            // The leg as stretches, each in its own manner. The steps' own distances share the line out between them.
            float said = 0;
            foreach (var step in leg.steps) said += step.distanceM;
            if (whole.Guess || leg.steps.Length == 0 || said <= 0) { Stretch(drawn, path, 0, path.Length, whole, colour); return; }
            float at = 0;
            foreach (var step in leg.steps)
            {
                float from = at; at += step.distanceM / said * path.Length;
                if (at - from <= 1) continue;
                bool ride = step.mode == "transit";
                Color line = ride ? (string.IsNullOrEmpty(step.line?.colour) ? Look.Warm : Look.Hex(step.line.colour)) : colour;
                Stretch(drawn, path, from, at, LegStyle.For(ride ? "transit" : "walk"), line);
                if (!ride) continue;

                // the two stations of a ride, and the line's own sign worn along it: its name, on its colour
                Station(drawn, path.At(from), line, step.from);
                Station(drawn, path.At(at), line, step.to);
                if (string.IsNullOrEmpty(step.line?.name)) continue;
                int signs = Mathf.Clamp(Mathf.RoundToInt((at - from) / 900), 1, 3);
                Color ink = string.IsNullOrEmpty(step.line.textColour) ? Look.Ink : Look.Hex(step.line.textColour);
                for (int k = 0; k < signs; k++) Sign(drawn, path.At(from + (at - from) * (k + 1) / (signs + 1)) + Vector3.up * (Lift + 6), step.line.name, line, ink, line);
            }
        }

        /// <summary>One stretch in one manner: a soft dark casing (a city in daylight is a bright, busy thing to draw on), for
        /// the wide ones a glow, the faint ghost of it that shows through whatever stands over the street, and the ribbon.</summary>
        void Stretch(Drawn drawn, RoutePath path, float from, float to, LegStyle style, Color of)
        {
            var mesh = Meshes.RouteStrip(path, from, to);
            float o = style.Opacity;
            void Layer(string name, Material m, bool wake) { Look.Draw(name, drawn.Root.transform, mesh, m); drawn.All.Add(m); if (wake) drawn.Wake.Add(m); }
            Layer("Casing", Look.Route(of, style, 1.9f, o * .42f, true, .7f, Lift, 0, shadow: true), false);
            if (style.Glow) Layer("Glow", Look.Route(of, style, 3.2f, o * .2f, style.Guess, 1, Lift, 1), true);
            if (!style.Guess) Layer("Ghost", Look.Route(of, style, 1, o * .4f, true, .3f, Lift, 2), true);
            Layer("Ribbon", Look.Route(of, style, 1, o, style.Guess, .3f, Lift, 3), true);
        }

        void Station(Drawn drawn, Vector3 at, Color line, string name)
        {
            var root = new GameObject("Station").transform;
            root.SetParent(drawn.Root.transform, false);
            root.position = at + Vector3.up * (Lift + .5f);
            Look.Draw("Disc", root, Meshes.Ring(0, 14, 40), Look.Flat(line.Alpha(.95f), depthTest: false, queue: 3004));
            Look.Draw("Hole", root, Meshes.Ring(0, 8.5f, 40), Look.Flat(Look.Glass.Alpha(.92f), depthTest: false, queue: 3005)).transform.localPosition = Vector3.up * .2f;
            if (!string.IsNullOrEmpty(name)) Sign(drawn, root.position + Vector3.up * 16, name, Look.Glass.Alpha(.78f), Look.Soft, line);
        }

        /// <summary>A chip of text standing on the route: a station's name on dark glass edged in its line's colour, or a line's
        /// name on the line's own colour.</summary>
        void Sign(Drawn drawn, Vector3 at, string text, Color fill, Color ink, Color edge)
        {
            var tag = new GameObject("Sign").transform;
            tag.SetParent(drawn.Root.transform, false);
            tag.position = at;
            var words = Look.Text("Words", tag, Face.Sans, .42f, ink, TextAlignmentOptions.Center, new Vector2(14, 1), onTop: true, order: 12);
            words.textWrappingMode = TextWrappingModes.NoWrap;
            words.text = text;
            words.ForceMeshUpdate();
            float wide = words.preferredWidth + .6f;
            Look.Draw("Edge", tag, Meshes.RoundedRect(wide + .06f, .92f, .46f), Look.Flat(edge.Alpha(.9f), depthTest: false), 10);
            Look.Draw("Fill", tag, Meshes.RoundedRect(wide, .86f, .43f), Look.Flat(fill, depthTest: false), 11).transform.localPosition = Vector3.back * .01f;
            words.transform.localPosition = Vector3.back * .02f;
            labels.Add(new Label { Tag = tag, Size = TagSize * .85f });
        }

        /// <summary>Each frame: which stop is current, where the guide's light is, what is being talked about.</summary>
        /// <param name="riding">The leg being flown and how far along it the guide is, metres; null at a stop.</param>
        public void Show(int currentStop, bool dwelling, float t, Vector3? guide, Vector3? target, (int leg, float along)? riding)
        {
            orb.gameObject.SetActive(guide.HasValue);
            if (guide.HasValue)
            {
                orb.position = guide.Value + Vector3.up * (8 + Mathf.Sin(t * 2.2f) * .8f);
                halo.localScale = Vector3.one * (1 + .12f * Mathf.Sin(Time.time * 3.1f));
            }

            subject.gameObject.SetActive(target.HasValue);
            if (target.HasValue)
            {
                subject.position = target.Value;
                ring.localScale = Vector3.one * (1 + .12f * Mathf.Sin(Time.time / .26f));          // it breathes, as the desktop's does
                float out01 = Time.time % 2.2f / 2.2f;                                            // and a ripple leaves it
                ripple.localScale = Vector3.one * (1 + 1.6f * out01);
                rippleLook.color = Look.Amber.Alpha(.5f * (1 - out01) * (1 - out01));
            }

            for (int i = 0; i < pins.Count; i++)
            {
                var p = pins[i];
                if (!p.Root.gameObject.activeSelf) continue;
                bool active = i == currentStop && dwelling;
                Vector3 away = p.Tag.position - head.position;
                float size = Mathf.Clamp(away.magnitude, 40, 4000) * TagSize * (active ? 1.25f : 1) * (p.Hit.Hot ? 1.15f : 1);
                p.Tag.localScale = Vector3.one * size;
                p.Tag.rotation = Quaternion.LookRotation(away, Vector3.up);                        // text reads from its back, so it looks away from the reader
                float strength = active ? 1 : i < currentStop ? .45f : .8f;                       // where we are; where we have been; where we are going
                p.Disc.color = (active ? Look.Warm : colour).Alpha(strength);
                p.Number.alpha = strength; p.Name.alpha = strength;
                p.Chip.Border.color = (active ? Look.LineHot : Look.Line).Alpha(.9f * strength);
                p.Chip.Fill.color = Look.Glass.Alpha(.78f * strength);
            }

            foreach (var l in labels)
            {
                Vector3 off = l.Tag.position - head.position;
                l.Tag.localScale = Vector3.one * (Mathf.Clamp(off.magnitude, 40, 4000) * l.Size);
                l.Tag.rotation = Quaternion.LookRotation(off, Vector3.up);
            }

            // A leg already travelled is dimmed, once: fainter, narrower, its light no longer flowing, its signs put away. On the
            // leg being flown the ribbon says where the guide is; on the others nothing is travelling.
            for (; playedLegs < Mathf.Min(currentStop, legs.Count); playedLegs++)
            {
                foreach (var m in legs[playedLegs].All) { m.SetFloat(Opacity, m.GetFloat(Opacity) * .35f); m.SetFloat(MinWidth, m.GetFloat(MinWidth) * .6f); m.SetFloat(FlowMps, 0); }
                foreach (Transform child in legs[playedLegs].Root.transform) if (child.name == "Station" || child.name == "Sign") child.gameObject.SetActive(false);
            }
            for (int i = 0; i < legs.Count; i++)
            {
                float at = riding.HasValue && riding.Value.leg == i && i >= playedLegs ? riding.Value.along : -1;
                foreach (var m in legs[i].Wake) m.SetFloat(Head, at);
            }
        }
    }
}

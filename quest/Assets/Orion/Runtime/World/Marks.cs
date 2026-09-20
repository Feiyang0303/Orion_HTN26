using System;
using System.Collections.Generic;
using Orion.Flight;
using TMPro;
using UnityEngine;

namespace Orion.World
{
    /* What is drawn on the city, in the manner of the desktop flight.
     *
     *   the route    in the way each leg is travelled, with a light running along it the way it goes
     *   a stop       a small amber disc with its number, and its name on a chip of dark glass beside it. It is a
     *                label, not an object: it faces the person, is drawn over whatever stands in front of it, and is
     *                the same size to the eye from any distance, as a label on a screen is
     *   the subject  a ring on the ground that breathes, a ripple leaving it, and a hairline of light standing on it
     *   the guide    a small light to follow down a leg
     */

    public class Marks : MonoBehaviour
    {
        const float Lift = 3;                                  // the route floats this far above the street it was measured on
        const float SparkRadius = 4.5f, SparkRest = 60;        // the light that runs along a leg, and the metres' worth of pause before it sets off again
        const float TagHeight = 30;                            // a stop's label stands this far above its ground
        const float TagSize = .033f;                           // and its disc is this wide to the eye: the tangent of 1.9 degrees, which a headset's ~20 pixels a degree can read
        const float RingInner = 9, RingOuter = 11.5f, BeamHeight = 48;
        const float GuideRadius = 2.6f;

        class Drawn { public GameObject Root; public RoutePath Path; public LegStyle Style; public Transform Spark; }
        class Pin { public Transform Root, Tag; public Material Disc; public TextMeshPro Number, Name; public ChipLook Chip; public Pointable Hit; }
        /// <summary>The materials of a name chip, so it can be dimmed as one.</summary>
        class ChipLook { public Material Border, Fill; }

        readonly List<Drawn> legs = new List<Drawn>();
        readonly List<Pin> pins = new List<Pin>();
        Transform orb, halo, subject, ring, ripple, head;
        Material rippleLook, played;
        Color colour = Look.Amber;
        int playedLegs;                                        // legs already behind the person are dimmed, once

        public void Build(Transform head)
        {
            this.head = head;

            orb = new GameObject("Guide").transform;
            orb.SetParent(transform, false);
            Look.Draw("Core", orb, Meshes.Sphere(GuideRadius, 24, 16), Look.Flat(Look.Warm));
            halo = Look.Draw("Halo", orb, Meshes.Sphere(GuideRadius * 2.4f, 24, 16), Look.Flat(Look.Amber.Alpha(.2f))).transform;

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
            played = Look.Flat(colour.Alpha(.35f));
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
            legs.Clear();
            playedLegs = 0;
            for (int i = 0; i < paths.Count; i++)
            {
                var style = LegStyle.For(day.legs[i].transport, day.legs[i].estimated);
                var leg = new Drawn { Root = new GameObject($"Leg {i}"), Path = paths[i], Style = style };
                leg.Root.transform.SetParent(transform, false);
                legs.Add(leg);
                if (paths[i].Pts.Count < 2) continue;
                if (style.Glow) Look.Draw("Glow", leg.Root.transform, Meshes.Ribbon(paths[i], style.Width * 2.8f, Lift - .3f, 0, 0), Look.Flat(colour.Alpha(.16f)));
                Look.Draw("Line", leg.Root.transform, Meshes.Ribbon(paths[i], style.Width, Lift, style.DashOn, style.DashOff), Look.Flat(colour.Alpha(style.Opacity)));
                leg.Spark = Look.Draw("Spark", leg.Root.transform, Meshes.Sphere(SparkRadius, 12, 8), Look.Flat(Look.Warm.Alpha(.9f), depthTest: false)).transform;
            }
            for (int i = 0; i < pins.Count; i++)
            {
                pins[i].Root.gameObject.SetActive(stops[i].HasValue);
                if (stops[i].HasValue) pins[i].Root.position = stops[i].Value;
            }
        }

        /// <summary>Each frame: which stop is current, where the guide's light is, what is being talked about.</summary>
        public void Show(int currentStop, bool dwelling, float t, Vector3? guide, Vector3? target)
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

            // A leg already travelled is dimmed, once, and its light put out. On the others a light runs the way the leg goes.
            for (; playedLegs < Mathf.Min(currentStop, legs.Count); playedLegs++)
                foreach (var r in legs[playedLegs].Root.GetComponentsInChildren<Renderer>()) { if (r.name == "Line") r.sharedMaterial = played; else r.enabled = false; }
            for (int i = playedLegs; i < legs.Count; i++)
            {
                var leg = legs[i];
                if (leg.Spark == null) continue;
                float s = Time.time * leg.Style.PulseMps % (leg.Path.Length + SparkRest);
                leg.Spark.gameObject.SetActive(s <= leg.Path.Length);
                leg.Spark.position = leg.Path.At(s) + Vector3.up * (Lift + 1);
            }
        }
    }
}

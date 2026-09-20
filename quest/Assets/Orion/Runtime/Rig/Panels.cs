using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.Text.RegularExpressions;
using CesiumForUnity;
using TMPro;
using UnityEngine;

namespace Orion
{
    /// <summary>What the guide is saying, low enough to leave the view ahead clear: a panel of dark glass, a small
    /// eyebrow saying where in the day this is, the place in the serif, the guide's words in the serif under it, and a
    /// line of amber along the bottom for how far through the day it is.</summary>
    public class Captions : MonoBehaviour
    {
        const float W = .95f, H = .3f, Pad = .045f, Front = -.006f;
        TextMeshPro header, title, line, target;
        Transform progress;

        public static Captions Make(Transform rig)
        {
            var c = new GameObject("Captions").AddComponent<Captions>();
            c.transform.SetParent(rig, false);
            c.transform.localPosition = new Vector3(0, .98f, 1.05f);
            c.transform.localRotation = Quaternion.Euler(31.5f, 0, 0);
            Look.Panel("Glass", c.transform, W, H, .022f);
            c.header = TopLeft(Look.Text("Header", c.transform, Face.Sans, .0148f, Look.Hint, TextAlignmentOptions.TopLeft, new Vector2(W - 2 * Pad, .02f)), .122f);
            c.header.characterSpacing = 14;
            c.title = TopLeft(Look.Text("Title", c.transform, Face.Display, .04f, Look.Soft, TextAlignmentOptions.TopLeft, new Vector2(W - 2 * Pad, .052f)), .1f);
            c.line = TopLeft(Look.Text("Line", c.transform, Face.Display, .0262f, Look.Soft, TextAlignmentOptions.TopLeft, new Vector2(W - 2 * Pad, .17f)), .04f);
            c.line.lineSpacing = 18;
            c.target = Look.Text("Target", c.transform, Face.Sans, .013f, Look.Amber, TextAlignmentOptions.TopRight, new Vector2(.4f, .02f));
            c.target.rectTransform.pivot = new Vector2(1, 1);
            c.target.transform.localPosition = new Vector3(W / 2 - Pad, .122f, Front);
            c.target.characterSpacing = 6;

            var track = Look.Draw("Track", c.transform, Meshes.Quad(W - 2 * Pad, .003f), Look.Flat(Look.Track), 2);
            track.transform.localPosition = new Vector3(0, -H / 2 + .02f, Front);
            c.progress = Look.Draw("Progress", track.transform, Meshes.Quad(1, .003f), Look.Flat(Look.Amber), 3).transform;
            c.Progress = 0;
            return c;
        }

        static TextMeshPro TopLeft(TextMeshPro t, float y)
        {
            t.rectTransform.pivot = new Vector2(0, 1);
            t.transform.localPosition = new Vector3(-W / 2 + Pad, y, Front);
            return t;
        }

        public void Show(string header, string title, string line, string target)
        {
            this.header.text = header; this.title.text = title; this.line.text = line;
            this.target.text = string.IsNullOrEmpty(target) ? "" : target.ToUpperInvariant();
        }

        /// <summary>How far through the day the flight is, 0 to 1.</summary>
        public float Progress
        {
            set
            {
                float full = W - 2 * Pad, p = Mathf.Clamp01(value);
                progress.localScale = new Vector3(full * p, 1, 1);
                progress.localPosition = new Vector3(-full / 2 + full * p / 2, 0, -.0005f);
            }
        }
    }

    /// <summary>Buttons you point at and squeeze: pills of dark glass, the one that matters in amber. They sit at your
    /// lap, tilted up to meet you.</summary>
    public class Console : MonoBehaviour
    {
        const float ButtonH = .05f, Gap = .012f, Front = -.006f;

        class Button { public Pointable Hit; public Material Border; public TextMeshPro Label; public bool Primary; }

        readonly List<Button> buttons = new List<Button>();
        TextMeshPro stats;

        public static Console Make(Transform rig)
        {
            var c = new GameObject("Console").AddComponent<Console>();
            c.transform.SetParent(rig, false);
            c.transform.localPosition = new Vector3(0, .76f, .3f);
            c.transform.localRotation = Quaternion.Euler(43, 0, 0);
            var hint = Look.Text("Hint", c.transform, Face.Sans, .0125f, Look.Hint, TextAlignmentOptions.Center, new Vector2(.8f, .02f));
            hint.text = "A or X pauses  ·  flick a thumbstick to turn  ·  hold B or Y to leave";
            hint.characterSpacing = 4;
            hint.transform.localPosition = new Vector3(0, -.075f, 0);
            c.stats = Look.Text("Stats", c.transform, Face.Sans, .011f, Look.Hint.Alpha(.7f), TextAlignmentOptions.Center, new Vector2(.8f, .02f));
            c.stats.transform.localPosition = new Vector3(0, -.098f, 0);
            return c;
        }

        /// <summary>Lay out the two rows of buttons. Done again whenever a label changes.</summary>
        public void Set(bool playing, bool smooth, string day, Action onPrev, Action onPlay, Action onNext, Action onSmooth, Action onDay, Action onLeave)
        {
            foreach (var b in buttons) Destroy(b.Hit.gameObject);
            buttons.Clear();
            Row(.05f, ("‹  Prev", onPrev, .13f, false), (playing ? "Pause" : "Play", onPlay, .13f, true), ("Next  ›", onNext, .13f, false));
            if (day == null) Row(-.02f, (smooth ? "Ride: smooth" : "Ride: blinks", onSmooth, .2f, false), ("Leave", onLeave, .16f, false));
            else Row(-.02f, (smooth ? "Ride: smooth" : "Ride: blinks", onSmooth, .2f, false), ($"{day}  ›", onDay, .34f, false), ("Leave", onLeave, .16f, false));
        }

        public void ShowStats(string text) => stats.text = text;

        void Row(float y, params (string label, Action onClick, float width, bool primary)[] row)
        {
            float total = Gap * (row.Length - 1);
            foreach (var r in row) total += r.width;
            float x = -total / 2;
            foreach (var (label, onClick, width, primary) in row)
            {
                GameObject go;
                Material border = null;
                if (primary) go = Look.Draw(label, transform, Meshes.RoundedRect(width, ButtonH, ButtonH / 2), Look.Flat(Look.Amber));
                else { go = Look.Panel(label, transform, width, ButtonH, ButtonH / 2, .82f); border = go.GetComponent<Renderer>().sharedMaterial; }
                go.transform.localPosition = new Vector3(x + width / 2, y, 0);
                var text = Look.Text("Label", go.transform, primary ? Face.SansBold : Face.Sans, .0165f, primary ? Look.Ink : Look.Soft, TextAlignmentOptions.Center, new Vector2(width, ButtonH), order: 3);
                text.text = label;
                text.characterSpacing = 4;
                text.transform.localPosition = new Vector3(0, 0, Front);
                buttons.Add(new Button { Hit = Pointable.On(go, new Vector3(width, ButtonH, .02f), onClick), Border = border, Label = text, Primary = primary });
                x += width + Gap;
            }
        }

        void Update()
        {
            foreach (var b in buttons)
            {
                if (b.Primary) continue;
                b.Border.color = (b.Hit.Hot ? Look.LineHot : Look.Line).Alpha(.9f);          // as the desktop's buttons answer a pointer: the border warms, the words turn amber
                b.Label.color = b.Hit.Hot ? Look.Amber : Look.Soft;
            }
        }
    }

    /// <summary>Google's and the data providers' attribution, which has to stay in view. Cesium shows its credits on a
    /// screen overlay, which a headset never sees, and keeps the data providers behind a link nobody can click here. So
    /// its credits are read, not shown: the logo, the credits and the providers, on a strip under the captions. Cesium
    /// keeps them internal, so they are read by name (and kept from being stripped by Assets/Orion/link.xml).</summary>
    public class Credits : MonoBehaviour
    {
        const float W = .95f, H = .052f, Pad = .045f, LogoH = .02f, Front = -.004f;
        const BindingFlags Any = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;

        TextMeshPro text;
        Renderer logo;
        string shown = "";
        float next;

        public static void Make(Transform rig)
        {
            var c = new GameObject("Credits").AddComponent<Credits>();
            c.transform.SetParent(rig, false);
            c.transform.localPosition = new Vector3(0, .823f, .954f);          // hung from the caption panel's lower edge, in its plane
            c.transform.localRotation = Quaternion.Euler(31.5f, 0, 0);
            Look.Panel("Glass", c.transform, W, H, .016f, .7f);
            c.logo = Look.Draw("Logo", c.transform, Meshes.Quad(1, 1), new Material(Look.ShaderNamed("OrionTexture"))).GetComponent<Renderer>();
            c.logo.enabled = false;
            c.text = Look.Text("Text", c.transform, Face.Sans, .0125f, Look.Hint, TextAlignmentOptions.Left, new Vector2(W - 2 * Pad, H - .01f));
            c.text.overflowMode = TextOverflowModes.Ellipsis;
        }

        static object Get(object of, string property) => of.GetType().GetProperty(property, Any).GetValue(of);

        void Update()
        {
            if (Time.unscaledTime < next) return;
            next = Time.unscaledTime + 1;

            // Asked for afresh each time: Cesium replaces its default credit system when a tileset is made.
            var system = CesiumCreditSystem.GetDefaultCreditSystem();
            var images = (List<Texture2D>)Get(system, "images");
            Texture2D mark = null;
            var words = new List<string>();
            foreach (string list in new[] { "onScreenCredits", "popupCredits" })
                foreach (object credit in (IEnumerable)Get(system, list))
                    foreach (object part in (IEnumerable)Get(credit, "components"))
                    {
                        int image = (int)Get(part, "imageId");
                        string said = Regex.Replace((string)Get(part, "text") ?? "", "<.*?>", "").Trim();
                        if (image >= 0 && image < images.Count && images[image] != null) mark ??= images[image];
                        else if (said.Length > 1 && !words.Contains(said)) words.Add(said);
                    }

            string all = string.Join("  ·  ", words);
            if (all == shown && mark == logo.sharedMaterial.mainTexture) return;
            shown = all;
            float logoW = mark ? LogoH * mark.width / mark.height : 0;
            logo.enabled = mark;
            if (mark)
            {
                logo.sharedMaterial.mainTexture = mark;
                logo.transform.localScale = new Vector3(logoW, LogoH, 1);
                logo.transform.localPosition = new Vector3(-W / 2 + Pad + logoW / 2, 0, Front);
            }
            float left = -W / 2 + Pad + (mark ? logoW + .015f : 0);
            text.rectTransform.sizeDelta = new Vector2(W / 2 - Pad - left, H - .01f);
            text.transform.localPosition = new Vector3((left + W / 2 - Pad) / 2, 0, Front);
            text.text = all;
        }

        /// <summary>What the strip is showing, for the smoke run to report.</summary>
        public string Shown => $"{(logo.enabled ? "[logo] " : "")}{shown}";
    }
}

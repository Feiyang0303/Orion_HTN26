using System;
using System.Collections.Generic;
using CesiumForUnity;
using TMPro;
using UnityEngine;
using UnityEngine.UIElements;

namespace Orion
{
    /// <summary>What the guide is saying, low enough to leave the view ahead clear.</summary>
    public class Captions : MonoBehaviour
    {
        const float W = .95f, H = .3f, Pad = .04f, Front = -.008f;
        TextMeshPro header, title, line, target;

        public static Captions Make(Transform rig)
        {
            var c = new GameObject("Captions").AddComponent<Captions>();
            c.transform.SetParent(rig, false);
            c.transform.localPosition = new Vector3(0, .98f, 1.05f);
            c.transform.localRotation = Quaternion.Euler(31.5f, 0, 0);
            Look.Draw("Back", c.transform, Meshes.Quad(W, H), Look.Flat(Look.Panel.Alpha(.78f)));
            Look.Draw("Rule", c.transform, Meshes.Quad(W, .004f), Look.Flat(Look.Amber)).transform.localPosition = new Vector3(0, H / 2, Front);
            c.header = TopLeft(Look.Text("Header", c.transform, .017f, Look.Amber, TextAlignmentOptions.TopLeft, new Vector2(W - 2 * Pad, .025f)), .125f);
            c.header.characterSpacing = 8;
            c.title = TopLeft(Look.Text("Title", c.transform, .036f, Look.Cream, TextAlignmentOptions.TopLeft, new Vector2(W - 2 * Pad, .05f)), .1f);
            c.line = TopLeft(Look.Text("Line", c.transform, .0225f, Look.Body, TextAlignmentOptions.TopLeft, new Vector2(W - 2 * Pad, .185f)), .048f);
            c.line.lineSpacing = 35;
            c.target = Look.Text("Target", c.transform, .014f, Look.Amber, TextAlignmentOptions.BottomRight, new Vector2(W - 2 * Pad, .02f));
            c.target.rectTransform.pivot = new Vector2(1, 0);
            c.target.transform.localPosition = new Vector3(W / 2 - Pad, -.135f, Front);
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
            this.target.text = string.IsNullOrEmpty(target) ? "" : $"› {target}";
        }
    }

    /// <summary>Buttons you point at and squeeze. They sit at your lap, tilted up to meet you.</summary>
    public class Console : MonoBehaviour
    {
        const float ButtonH = .05f, Gap = .012f, Front = -.008f;

        class Button { public Pointable Hit; public Material Back; public bool Primary; }

        readonly List<Button> buttons = new List<Button>();
        TextMeshPro stats;

        public static Console Make(Transform rig)
        {
            var c = new GameObject("Console").AddComponent<Console>();
            c.transform.SetParent(rig, false);
            c.transform.localPosition = new Vector3(0, .76f, .3f);
            c.transform.localRotation = Quaternion.Euler(43, 0, 0);
            var hint = Look.Text("Hint", c.transform, .014f, Look.Hint, TextAlignmentOptions.Center, new Vector2(.8f, .02f));
            hint.text = "A or X pauses the guide  ·  hold B or Y to leave";
            hint.transform.localPosition = new Vector3(0, -.075f, 0);
            c.stats = Look.Text("Stats", c.transform, .014f, Look.Amber, TextAlignmentOptions.Center, new Vector2(.8f, .02f));
            c.stats.transform.localPosition = new Vector3(0, -.1f, 0);
            return c;
        }

        /// <summary>Lay out the two rows of buttons. Done again whenever a label changes.</summary>
        public void Set(bool playing, bool smooth, string day, Action onPrev, Action onPlay, Action onNext, Action onSmooth, Action onDay, Action onLeave)
        {
            foreach (var b in buttons) Destroy(b.Hit.gameObject);
            buttons.Clear();
            Row(.05f, ("‹ Prev", onPrev, .13f, false), (playing ? "Pause" : "Play", onPlay, .13f, true), ("Next ›", onNext, .13f, false));
            if (day == null) Row(-.02f, (smooth ? "Ride: smooth" : "Ride: blinks", onSmooth, .2f, false), ("Leave", onLeave, .16f, false));
            else Row(-.02f, (smooth ? "Ride: smooth" : "Ride: blinks", onSmooth, .2f, false), ($"{day} ›", onDay, .34f, false), ("Leave", onLeave, .16f, false));
        }

        public void ShowStats(string text) => stats.text = text;

        void Row(float y, params (string label, Action onClick, float width, bool primary)[] row)
        {
            float total = Gap * (row.Length - 1);
            foreach (var r in row) total += r.width;
            float x = -total / 2;
            foreach (var (label, onClick, width, primary) in row)
            {
                var back = Look.Flat(primary ? Look.Amber : Look.Button.Alpha(.94f));
                var go = Look.Draw(label, transform, Meshes.Quad(width, ButtonH), back);
                go.transform.localPosition = new Vector3(x + width / 2, y, 0);
                var text = Look.Text("Label", go.transform, .0175f, primary ? Look.Ink : Look.Cream, TextAlignmentOptions.Center, new Vector2(width, ButtonH));
                text.text = label;
                text.transform.localPosition = new Vector3(0, 0, Front);
                buttons.Add(new Button { Hit = Pointable.On(go, new Vector3(width, ButtonH, .02f), onClick), Back = back, Primary = primary });
                x += width + Gap;
            }
        }

        void Update()
        {
            foreach (var b in buttons) if (!b.Primary) b.Back.color = (b.Hit.Hot ? Look.ButtonHot : Look.Button).Alpha(.94f);
        }
    }

    /// <summary>Google's and the data providers' attribution, which has to stay in view. Cesium draws its
    /// credits as a screen overlay, and a headset has no screen: so its overlay is drawn into a texture
    /// instead, and the texture shown on a strip under the captions.</summary>
    public static class Credits
    {
        const int Px = 1024, PxHigh = 96;
        const float W = .95f;

        public static void Make(Transform rig)
        {
            var overlay = CesiumCreditSystem.GetDefaultCreditSystem().GetComponent<UIDocument>();
            var texture = new RenderTexture(Px, PxHigh, 0) { name = "Credits" };
            var settings = UnityEngine.Object.Instantiate(overlay.panelSettings);
            settings.targetTexture = texture;
            settings.clearColor = true;
            settings.colorClearValue = Color.clear;
            overlay.panelSettings = settings;

            var strip = Look.Draw("Credits", rig, Meshes.Quad(W, W * PxHigh / Px), new Material(Look.Shader("OrionTexture")) { mainTexture = texture });
            strip.transform.localPosition = new Vector3(0, .83f, .98f);
            strip.transform.localRotation = Quaternion.Euler(31.5f, 0, 0);
        }
    }
}

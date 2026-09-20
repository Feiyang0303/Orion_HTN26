using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.Rendering;

namespace Orion
{
    /// <summary>The typefaces of Orion: a serif for the moments that deserve one, a clean sans for everything else.</summary>
    public enum Face { Sans, SansBold, Display, DisplayItalic }

    /// <summary>Orion's design language, as the flight view on the desktop has it: a dark, warm ground, one amber accent,
    /// ink at three strengths, glass panels with a hairline border, and the few kinds of thing drawn in them.</summary>
    public static class Look
    {
        public static readonly Color Background = Hex("#07060a"), Amber = Hex("#f0b45e"), Cream = Hex("#f4e7c6");
        public static readonly Color Ink = Hex("#14100c"), Warm = Hex("#fff3d6"), Soft = Hex("#e3d2ac"), Hint = Hex("#9a8763");
        public static readonly Color Glass = Hex("#0a0806"), Line = Hex("#3a3024"), LineHot = Hex("#9a6b3f"), Track = Hex("#1d1710"), Floor = Hex("#0d0a08");
        /// <summary>One hue per day of a trip, as everywhere else in Orion.</summary>
        public static readonly Color[] Days = { Hex("#f0b45e"), Hex("#6fd6ff"), Hex("#c89bff"), Hex("#7fe3a6"), Hex("#ff8fa3"), Hex("#ffe066"), Hex("#8fb8ff") };
        public static readonly Color Haze = new Color(.30f, .17f, .08f);          // the sky's colour at the horizon, so the city fades into it

        /// <summary>The layer everything the person can point at lives on; the city is on the default one.</summary>
        public const int PointableLayer = 5;

        static readonly string[] FontFiles = { "DMSans-Medium", "DMSans-SemiBold", "IMFellEnglish-Regular", "IMFellEnglish-Italic" };
        static readonly TMP_FontAsset[] fonts = new TMP_FontAsset[4];

        public static Color Hex(string hex) { ColorUtility.TryParseHtmlString(hex, out var c); return c; }

        public static Color Alpha(this Color c, float a) => new Color(c.r, c.g, c.b, a);

        public static Shader ShaderNamed(string name) => Resources.Load<Shader>($"Shaders/{name}");

        /// <summary>A typeface, made from its font file the first time it is asked for; its glyphs are drawn as they are needed.</summary>
        public static TMP_FontAsset Font(Face face)
        {
            ref var font = ref fonts[(int)face];
            if (font == null)
            {
                font = TMP_FontAsset.CreateFontAsset(Resources.Load<Font>($"Fonts/{FontFiles[(int)face]}"), 96, 9, UnityEngine.TextCore.LowLevel.GlyphRenderMode.SDFAA, 1024, 1024);
                font.name = FontFiles[(int)face];
            }
            return font;
        }

        /// <summary>`onTop`: drawn over the city whatever stands in front of it, as a label on a screen would be.</summary>
        public static Material Flat(Color colour, bool depthTest = true, bool depthWrite = false, int queue = 3000)
        {
            var m = new Material(ShaderNamed("OrionFlat")) { color = colour, renderQueue = queue };
            m.SetFloat("_ZTest", (float)(depthTest ? CompareFunction.LessEqual : CompareFunction.Always));
            m.SetFloat("_ZWrite", depthWrite ? 1 : 0);
            return m;
        }

        public static GameObject Draw(string name, Transform parent, Mesh mesh, Material material, int order = 0)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = material;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            r.sortingOrder = order;
            return go;
        }

        public static TextMeshPro Text(string name, Transform parent, Face face, float size, Color colour, TextAlignmentOptions align, Vector2 box, bool onTop = false, int order = 1)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var t = go.AddComponent<TextMeshPro>();
            t.font = Font(face);
            t.fontSize = size * 10;                     // TextMeshPro's world text is sized in tenths of a unit
            t.color = colour;
            t.alignment = align;
            t.rectTransform.sizeDelta = box;
            t.textWrappingMode = TextWrappingModes.Normal;
            t.overflowMode = TextOverflowModes.Truncate;
            t.sortingOrder = order;
            if (onTop) t.fontMaterial.SetFloat("unity_GUIZTestMode", (float)CompareFunction.Always);
            return t;
        }

        /// <summary>A panel of dark glass with a hairline border, corners rounded.</summary>
        public static GameObject Panel(string name, Transform parent, float width, float height, float radius, float opacity = .8f, bool onTop = false, int order = 0, float Hairline = .0012f)
        {
            var go = Draw(name, parent, Meshes.RoundedRect(width + 2 * Hairline, height + 2 * Hairline, radius + Hairline), Flat(Line.Alpha(.9f), !onTop), order);
            Draw("Fill", go.transform, Meshes.RoundedRect(width, height, radius), Flat(Glass.Alpha(opacity), !onTop), order + 1).transform.localPosition = Vector3.back * (Hairline * .4f);
            return go;
        }
    }

    public static class Meshes
    {
        /// <summary>A flat ring in the xz plane, facing up.</summary>
        public static Mesh Ring(float inner, float outer, int segments)
        {
            var v = new List<Vector3>(); var tris = new List<int>();
            for (int i = 0; i <= segments; i++)
            {
                float a = i * 2 * Mathf.PI / segments;
                var d = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                v.Add(d * inner); v.Add(d * outer);
                if (i < segments) { int k = i * 2; tris.AddRange(new[] { k, k + 2, k + 1, k + 1, k + 2, k + 3 }); }
            }
            return Build(v, tris);
        }

        public static Mesh Sphere(float radius, int around = 12, int up = 8)
        {
            var v = new List<Vector3>(); var tris = new List<int>();
            AddSphere(v, tris, Vector3.zero, radius, around, up);
            return Build(v, tris);
        }

        /// <summary>A flat band along a path, lying on it face up: solid, or in dashes `on` metres long with `off` between.</summary>
        public static Mesh Ribbon(Flight.RoutePath path, float width, float lift, float on, float off)
        {
            const float Step = 4;                       // a band bends with the street this often
            var v = new List<Vector3>(); var tris = new List<int>();
            float period = on > 0 ? on + off : path.Length + 1, length = on > 0 ? on : path.Length;
            for (float from = 0; from < path.Length; from += period)
            {
                float to = Mathf.Min(path.Length, from + length);
                int first = v.Count;
                for (float s = from; ; s = Mathf.Min(to, s + Step))
                {
                    Vector3 at = path.At(s) + Vector3.up * lift, side = Vector3.Cross(Vector3.up, path.Heading(s, 2, 2, Vector3.forward)) * (width / 2);
                    v.Add(at - side); v.Add(at + side);
                    if (s >= to) break;
                }
                for (int k = first; k + 3 < v.Count; k += 2) tris.AddRange(new[] { k, k + 1, k + 2, k + 1, k + 3, k + 2 });
            }
            return Build(v, tris);
        }

        static void AddSphere(List<Vector3> v, List<int> tris, Vector3 c, float r, int around, int up)
        {
            int b = v.Count;
            for (int j = 0; j <= up; j++)
                for (int i = 0; i <= around; i++)
                {
                    float phi = j * Mathf.PI / up, th = i * 2 * Mathf.PI / around;
                    v.Add(c + new Vector3(Mathf.Sin(phi) * Mathf.Cos(th), Mathf.Cos(phi), Mathf.Sin(phi) * Mathf.Sin(th)) * r);
                }
            for (int j = 0; j < up; j++)
                for (int i = 0; i < around; i++)
                {
                    int k = b + j * (around + 1) + i, n = k + around + 1;
                    tris.AddRange(new[] { k, k + 1, n, k + 1, n + 1, n });
                }
        }

        /// <summary>An open cone standing on the origin: the beam's shaft.</summary>
        public static Mesh Shaft(float bottomRadius, float topRadius, float height, int sides = 10)
        {
            var v = new List<Vector3>(); var tris = new List<int>();
            for (int s = 0; s <= sides; s++)
            {
                float a = s * 2 * Mathf.PI / sides;
                var d = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                v.Add(d * bottomRadius); v.Add(d * topRadius + Vector3.up * height);
                if (s < sides) { int k = s * 2; tris.AddRange(new[] { k, k + 1, k + 2, k + 1, k + 3, k + 2 }); }
            }
            return Build(v, tris);
        }

        /// <summary>A rectangle with rounded corners in the xy plane, facing -z. A radius of half the height makes a pill;
        /// equal width and height and that radius, a disc.</summary>
        public static Mesh RoundedRect(float width, float height, float radius, int perCorner = 8)
        {
            radius = Mathf.Min(radius, Mathf.Min(width, height) / 2);
            var v = new List<Vector3> { Vector3.zero }; var tris = new List<int>();
            for (int c = 0; c < 4; c++)
            {
                var centre = new Vector2((c == 0 || c == 3 ? 1 : -1) * (width / 2 - radius), (c < 2 ? 1 : -1) * (height / 2 - radius));
                for (int i = 0; i <= perCorner; i++)
                {
                    float a = (c + i / (float)perCorner) * Mathf.PI / 2;
                    v.Add(centre + new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * radius);
                }
            }
            for (int i = 1; i < v.Count; i++) tris.AddRange(new[] { 0, i, i % (v.Count - 1) + 1 });
            return Build(v, tris);
        }

        /// <summary>A rectangle in the xy plane, facing -z (towards someone looking down +z at it).</summary>
        public static Mesh Quad(float width, float height)
        {
            float w = width / 2, h = height / 2;
            var m = new Mesh
            {
                vertices = new[] { new Vector3(-w, -h), new Vector3(-w, h), new Vector3(w, h), new Vector3(w, -h) },
                uv = new[] { new Vector2(0, 0), new Vector2(0, 1), new Vector2(1, 1), new Vector2(1, 0) },
                triangles = new[] { 0, 1, 2, 0, 2, 3 },
            };
            m.RecalculateBounds();
            return m;
        }

        static Mesh Build(List<Vector3> v, List<int> tris)
        {
            var m = new Mesh { indexFormat = v.Count > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            m.SetVertices(v); m.SetTriangles(tris, 0); m.RecalculateBounds();
            return m;
        }
    }
}

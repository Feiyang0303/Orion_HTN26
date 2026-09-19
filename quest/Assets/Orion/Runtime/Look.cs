using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.Rendering;

namespace Orion
{
    /// <summary>The dark and amber "flight" language: its colours, and the few kinds of thing drawn in them.</summary>
    public static class Look
    {
        public static readonly Color Background = Hex("#07060a"), Amber = Hex("#f0b45e"), Cream = Hex("#f4e7c6");
        public static readonly Color Ink = Hex("#1a1208"), Warm = Hex("#fff3d6"), Body = Hex("#d9ccb0"), Hint = Hex("#9a8763");
        public static readonly Color Panel = Hex("#0c0a08"), Button = Hex("#1a1510"), ButtonHot = Hex("#3a2f22"), Floor = Hex("#0d0a08");
        public static readonly Color Haze = new Color(.30f, .17f, .08f);          // the sky's colour at the horizon, so the city fades into it

        /// <summary>The layer everything the person can point at lives on; the city is on the default one.</summary>
        public const int PointableLayer = 5;

        public static Color Hex(string hex) { ColorUtility.TryParseHtmlString(hex, out var c); return c; }

        public static Color Alpha(this Color c, float a) => new Color(c.r, c.g, c.b, a);

        public static Shader Shader(string name) => Resources.Load<Shader>($"Shaders/{name}");

        public static Material Flat(Color colour, bool depthTest = true, bool depthWrite = false, int queue = 3000)
        {
            var m = new Material(Shader("OrionFlat")) { color = colour, renderQueue = queue };
            m.SetFloat("_ZTest", (float)(depthTest ? CompareFunction.LessEqual : CompareFunction.Always));
            m.SetFloat("_ZWrite", depthWrite ? 1 : 0);
            return m;
        }

        public static GameObject Draw(string name, Transform parent, Mesh mesh, Material material)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = material;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            return go;
        }

        public static TextMeshPro Text(string name, Transform parent, float size, Color colour, TextAlignmentOptions align, Vector2 box)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var t = go.AddComponent<TextMeshPro>();
            t.fontSize = size * 10;                     // TextMeshPro's world text is sized in tenths of a unit
            t.color = colour;
            t.alignment = align;
            t.rectTransform.sizeDelta = box;
            t.textWrappingMode = TextWrappingModes.Normal;
            t.overflowMode = TextOverflowModes.Truncate;
            return t;
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

        /// <summary>One sphere at each point, as a single mesh: a line of beads is one draw call.</summary>
        public static Mesh Beads(IReadOnlyList<Vector3> at, float radius)
        {
            var v = new List<Vector3>(); var tris = new List<int>();
            foreach (var p in at) AddSphere(v, tris, p, radius, 8, 5);
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

        /// <summary>A tube along a line of points.</summary>
        public static Mesh Tube(IReadOnlyList<Vector3> line, float radius, int sides = 6)
        {
            var v = new List<Vector3>(); var tris = new List<int>();
            for (int i = 0; i < line.Count; i++)
            {
                Vector3 dir = (line[Mathf.Min(i + 1, line.Count - 1)] - line[Mathf.Max(i - 1, 0)]).normalized;
                Vector3 side = Vector3.Cross(Vector3.up, dir).normalized, top = Vector3.Cross(dir, side);
                for (int s = 0; s <= sides; s++)
                {
                    float a = s * 2 * Mathf.PI / sides;
                    v.Add(line[i] + (side * Mathf.Cos(a) + top * Mathf.Sin(a)) * radius);
                }
                if (i == 0) continue;
                for (int s = 0; s < sides; s++)
                {
                    int k = (i - 1) * (sides + 1) + s, n = k + sides + 1;
                    tris.AddRange(new[] { k, n, k + 1, k + 1, n, n + 1 });
                }
            }
            return Build(v, tris);
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

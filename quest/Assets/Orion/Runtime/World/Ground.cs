using System.Collections.Generic;
using CesiumForUnity;
using Orion.Flight;
using Unity.Mathematics;
using UnityEngine;

namespace Orion.World
{
    /* Putting real lon/lat on the real ground.
     *
     * x and z come from Cesium's georeference, the exact transform the tiles went through.
     * Height is a downward ray onto the tiles' physics meshes. Rays are drained a few per frame
     * from a queue that never restarts, and re-queued as finer tiles arrive, because the surface
     * refines under the anchors. A point no ray has landed on yet sits at the height of the
     * nearest thing that has been found: the ellipsoid itself can be a long way below a city. */

    public class Ground
    {
        public readonly struct Placed
        {
            public readonly Vector3 Pos; public readonly bool Grounded;
            public Placed(Vector3 pos, bool grounded) { Pos = pos; Grounded = grounded; }
        }

        const int RaysPerFrame = 4;
        const float RayStartHeight = 1500, RayRange = 5000, RecheckSec = 2.5f;

        readonly CesiumGeoreference georeference;
        readonly Cesium3DTileset tileset;
        readonly int mask;
        readonly Dictionary<string, Placed> cells = new Dictionary<string, Placed>();
        readonly Queue<Anchor> queue = new Queue<Anchor>();
        List<Anchor> anchors = new List<Anchor>();
        float lastFull = -RecheckSec, lastProgress = -1, knownGround;

        public Ground(CesiumGeoreference georeference, Cesium3DTileset tileset)
        {
            this.georeference = georeference;
            this.tileset = tileset;
            mask = 1 << tileset.gameObject.layer;
        }

        public bool TryGet(string key, out Placed placed) => cells.TryGetValue(key, out placed);

        /// <summary>Replace the set of anchors and forget the last day's ground.</summary>
        public void SetAnchors(List<Anchor> next) { anchors = next; cells.Clear(); knownGround = 0; Requeue(); }

        /// <summary>Re-check everything, ungrounded points first.</summary>
        void Requeue()
        {
            queue.Clear();
            foreach (var a in anchors) if (!IsGrounded(a)) queue.Enqueue(a);
            foreach (var a in anchors) if (IsGrounded(a)) queue.Enqueue(a);
        }

        bool IsGrounded(Anchor a) => cells.TryGetValue(a.Key, out var c) && c.Grounded;

        public Vector3 ToWorld(double lat, double lon)
        {
            double3 ecef = georeference.ellipsoid.LongitudeLatitudeHeightToCenteredFixed(new double3(lon, lat, 0));
            double3 p = georeference.TransformEarthCenteredEarthFixedPositionToUnity(ecef);
            return georeference.transform.TransformPoint(new Vector3((float)p.x, (float)p.y, (float)p.z));
        }

        /// <summary>Cast up to a few rays. Returns true if any cell meaningfully changed.</summary>
        public bool Step(float now)
        {
            // Nothing is trusted for long: tiles refine under the anchors. They are re-verified whenever
            // more tiles have arrived (at most every RecheckSec, since a ray against photogrammetry is not
            // cheap), and a stale one corrects itself. When nothing is arriving, only the unlanded are retried.
            if (queue.Count == 0)
            {
                float progress = tileset.ComputeLoadProgress();
                if (progress != lastProgress && now - lastFull > RecheckSec) { lastFull = now; lastProgress = progress; Requeue(); }
                else foreach (var a in anchors) if (!IsGrounded(a)) queue.Enqueue(a);
            }
            bool changed = false;
            for (int n = 0; queue.Count > 0 && n < RaysPerFrame; n++)
            {
                var a = queue.Dequeue();
                Vector3 p = ToWorld(a.Lat, a.Lon);
                bool had = cells.TryGetValue(a.Key, out var prev);
                Placed next;
                if (Physics.Raycast(new Vector3(p.x, p.y + RayStartHeight, p.z), Vector3.down, out var hit, RayRange, mask))
                {
                    next = new Placed(new Vector3(p.x, hit.point.y, p.z), true);
                    knownGround = hit.point.y;
                }
                else next = had && prev.Grounded ? prev : new Placed(new Vector3(p.x, p.y + knownGround, p.z), false);
                cells[a.Key] = next;
                if (!had || prev.Grounded != next.Grounded || (prev.Pos - next.Pos).sqrMagnitude > .25f) changed = true;
            }
            return changed;
        }

        /// <summary>Roughly how tall whatever stands at `at` is: the highest surface in a small grid over it,
        /// against the lowest surface in a ring around it. Null until enough tiles are loaded to say.</summary>
        public float? Measure(Vector3 at)
        {
            float? Top(float x, float z) => Physics.Raycast(new Vector3(x, at.y + 800, z), Vector3.down, out var hit, RayRange, mask) ? hit.point.y : (float?)null;
            float roof = float.MinValue, street = float.MaxValue;
            int roofs = 0, streets = 0;
            for (int dx = -20; dx <= 20; dx += 20)
                for (int dz = -20; dz <= 20; dz += 20)
                    if (Top(at.x + dx, at.z + dz) is float v) { roof = Mathf.Max(roof, v); roofs++; }
            for (int k = 0; k < 8; k++)
            {
                float a = k * Mathf.PI / 4;
                if (Top(at.x + Mathf.Cos(a) * 110, at.z + Mathf.Sin(a) * 110) is float v) { street = Mathf.Min(street, v); streets++; }
            }
            if (roofs < 5 || streets < 4) return null;
            return Mathf.Clamp(roof - street, 0, 250);
        }

        /// <summary>Is there open air between two points? False if a tile surface is in the way.</summary>
        public bool LineOfSight(Vector3 from, Vector3 to, float margin = 12)
        {
            Vector3 dir = to - from;
            float dist = dir.magnitude;
            return dist < margin || !Physics.Raycast(from, dir / dist, dist - margin, mask);
        }
    }
}

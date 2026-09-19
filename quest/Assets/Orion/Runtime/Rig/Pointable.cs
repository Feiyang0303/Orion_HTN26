using System;
using UnityEngine;

namespace Orion
{
    /// <summary>Something the person can point a controller at and squeeze the trigger on.</summary>
    public class Pointable : MonoBehaviour
    {
        Action onClick;

        /// <summary>Whether a controller is pointing at it this frame.</summary>
        public bool Hot { get; private set; }
        int hotFrame = -1;

        public static Pointable On(GameObject go, Vector3 boxSize, Action onClick)
        {
            go.AddComponent<BoxCollider>().size = boxSize;
            return Make(go, onClick);
        }

        public static Pointable On(GameObject go, float radius, Action onClick)
        {
            go.AddComponent<SphereCollider>().radius = radius;
            return Make(go, onClick);
        }

        static Pointable Make(GameObject go, Action onClick)
        {
            go.layer = Look.PointableLayer;
            var p = go.AddComponent<Pointable>();
            p.onClick = onClick;
            return p;
        }

        public void Point() { hotFrame = Time.frameCount; Hot = true; }
        public void Click() => onClick();

        void LateUpdate() { if (hotFrame != Time.frameCount) Hot = false; }
    }
}

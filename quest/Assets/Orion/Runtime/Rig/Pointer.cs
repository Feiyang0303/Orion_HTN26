using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR;

namespace Orion
{
    /// <summary>A controller: a short ray of light from the hand, and the trigger that chooses what it lands on.
    /// Also reads the buttons that need no aiming.</summary>
    public class Pointer : MonoBehaviour
    {
        const float Reach = 6000, Shown = 1.5f;

        InputDevice device;
        XRNode node;
        LineRenderer line;
        bool wasTrigger;

        /// <summary>A or X, and B or Y, as they are this frame.</summary>
        public bool Primary { get; private set; }
        public bool Secondary { get; private set; }
        /// <summary>The thumbstick, pushed fully left (-1) or right (1), or neither (0).</summary>
        public int Flick { get; private set; }

        public static Pointer Make(Transform rig, XRNode node)
        {
            var go = new GameObject($"Pointer {node}");
            go.transform.SetParent(rig, false);
            var p = go.AddComponent<Pointer>();
            p.node = node;
            p.line = go.AddComponent<LineRenderer>();
            p.line.useWorldSpace = false;
            p.line.positionCount = 2;
            p.line.SetPositions(new[] { Vector3.zero, Vector3.forward * Shown });
            p.line.startWidth = .004f; p.line.endWidth = .001f;
            p.line.sharedMaterial = Look.Flat(Look.Amber.Alpha(.7f));
            p.line.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            return p;
        }

        void Update()
        {
            if (!device.isValid) device = InputDevices.GetDeviceAtXRNode(node);
            bool tracked = device.TryGetFeatureValue(CommonUsages.devicePosition, out var pos) & device.TryGetFeatureValue(CommonUsages.deviceRotation, out var rot);
            line.enabled = tracked;
            Primary = device.TryGetFeatureValue(CommonUsages.primaryButton, out bool a) && a;
            Secondary = device.TryGetFeatureValue(CommonUsages.secondaryButton, out bool b) && b;
            Flick = device.TryGetFeatureValue(CommonUsages.primary2DAxis, out Vector2 stick) && Mathf.Abs(stick.x) > .7f ? (int)Mathf.Sign(stick.x) : 0;
            if (!tracked) return;
            transform.localPosition = pos; transform.localRotation = rot;

            bool trigger = device.TryGetFeatureValue(CommonUsages.triggerButton, out bool t) && t;
            if (Physics.Raycast(transform.position, transform.forward, out var hit, Reach, 1 << Look.PointableLayer) && hit.collider.TryGetComponent<Pointable>(out var target))
            {
                target.Point();
                if (trigger && !wasTrigger) target.Click();
            }
            wasTrigger = trigger;
        }
    }
}

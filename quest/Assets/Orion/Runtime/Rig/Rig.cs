using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.XR;
using UnityEngine.XR;

namespace Orion
{
    /* The person's own space, carried through the city. Its origin is the floor under them. Only
     * its position and its yaw are ever set: the horizon belongs to the person's own head.
     *
     * It holds a ring of light to stand on, which stays put under the person while everything
     * else moves (something in view that does not move is a comfort in itself), the veil, and
     * the panels. */

    public class Rig : MonoBehaviour
    {
        /// <summary>Where a head is taken to be above the floor of the person's space.</summary>
        public const float HeadHeight = 1.6f;
        /// <summary>How far the city is drawn, and fetched. Beyond it is haze: a headset cannot afford the tiles all the way to the horizon.</summary>
        public const float Far = 4500;
        const float Foveation = .66f;                          // 0 none, 1 the most the headset offers

        public Camera Head { get; private set; }
        public Veil Veil { get; private set; }
        public Captions Captions { get; private set; }
        public Console Console { get; private set; }
        public Pointer[] Hands { get; private set; }

        public static Rig Make()
        {
            var rig = new GameObject("Rig").AddComponent<Rig>();

            var head = new GameObject("Head") { tag = "MainCamera" };
            head.transform.SetParent(rig.transform, false);
            rig.Head = head.AddComponent<Camera>();
            rig.Head.nearClipPlane = .2f; rig.Head.farClipPlane = Far;
            rig.Head.clearFlags = CameraClearFlags.Skybox;
            rig.Head.backgroundColor = Look.Background;
            head.AddComponent<AudioListener>();
            var pose = head.AddComponent<TrackedPoseDriver>();
            pose.positionInput = new InputActionProperty(new InputAction(binding: "<XRHMD>/centerEyePosition"));
            pose.rotationInput = new InputActionProperty(new InputAction(binding: "<XRHMD>/centerEyeRotation"));
            pose.positionInput.action.Enable(); pose.rotationInput.action.Enable();

            rig.Veil = Veil.Make(head.transform);
            rig.Hands = new[] { Pointer.Make(rig.transform, XRNode.LeftHand), Pointer.Make(rig.transform, XRNode.RightHand) };
            rig.Captions = Captions.Make(rig.transform);
            rig.Console = Console.Make(rig.transform);
            Credits.Make(rig.transform);

            Look.Draw("Floor", rig.transform, Meshes.Ring(0, .9f, 64), Look.Flat(Look.Floor.Alpha(.5f)));
            Look.Draw("Ring", rig.transform, Meshes.Ring(.9f, .908f, 96), Look.Flat(Look.Amber.Alpha(.5f))).transform.localPosition = Vector3.up * .002f;
            Look.Draw("Outer ring", rig.transform, Meshes.Ring(1.25f, 1.258f, 96), Look.Flat(Look.Amber.Alpha(.25f))).transform.localPosition = Vector3.up * .002f;
            return rig;
        }

        void Start()
        {
            var subsystems = new List<XRInputSubsystem>();
            SubsystemManager.GetSubsystems(subsystems);
            foreach (var s in subsystems) s.TrySetTrackingOriginMode(TrackingOriginModeFlags.Floor);

            // Fixed foveated rendering: the edges of each eye's view, which the lenses blur anyway, are shaded more coarsely.
            var displays = new List<XRDisplaySubsystem>();
            SubsystemManager.GetSubsystems(displays);
            foreach (var d in displays) d.foveatedRenderingLevel = Foveation;
        }

        /// <summary>Put the person's head at `eye`, facing `yaw` (radians). Position and yaw, nothing else.</summary>
        public void Carry(Vector3 eye, float yaw)
        {
            transform.SetPositionAndRotation(eye - Vector3.up * HeadHeight, Quaternion.Euler(0, yaw * Mathf.Rad2Deg, 0));
        }

        /// <summary>Where a head is taken to be, whatever the person's own is doing: what the tile loader is aimed from.</summary>
        public Vector3 NominalHead => transform.position + Vector3.up * HeadHeight;
    }
}

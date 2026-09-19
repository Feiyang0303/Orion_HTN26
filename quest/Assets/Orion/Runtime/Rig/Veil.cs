using UnityEngine;

namespace Orion
{
    /// <summary>The blink (the whole view to black and back) and the vignette (the edges of the view closed
    /// in while the person is being moved, which takes away the streaming periphery that does most of
    /// the harm). Drawn by Orion/Veil over each eye's whole view.</summary>
    public class Veil : MonoBehaviour
    {
        const float Open = 1.6f, Closed = .62f;            // tan of the clear half-angle: wide open, and about 32° at full speed
        static readonly int FadeId = Shader.PropertyToID("_Fade"), InnerId = Shader.PropertyToID("_Inner");

        Material material;
        float eased;

        /// <summary>0 clear, 1 black.</summary>
        public float Fade = 1;
        /// <summary>0 at rest, 1 at full tilt.</summary>
        public float Vignette;

        public static Veil Make(Transform head)
        {
            var mesh = Meshes.Quad(2, 2);
            mesh.bounds = new Bounds(Vector3.zero, Vector3.one * 1e6f);          // it has no place in the world, so it is never out of view
            var veil = Look.Draw("Veil", head, mesh, new Material(Look.ShaderNamed("OrionVeil"))).AddComponent<Veil>();
            veil.material = veil.GetComponent<Renderer>().sharedMaterial;
            return veil;
        }

        void LateUpdate()
        {
            eased += (Vignette - eased) * (1 - Mathf.Exp(-Mathf.Min(Time.deltaTime, .05f) * 4));     // it closes and opens over about half a second
            material.SetFloat(FadeId, Fade);
            material.SetFloat(InnerId, Mathf.Lerp(Open, Closed, eased));
        }
    }
}

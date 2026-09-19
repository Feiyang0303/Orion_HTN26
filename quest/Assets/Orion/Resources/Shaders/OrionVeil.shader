// What is drawn over everything: the blink (the whole view to black and back) and the vignette
// (the edges of the view closed in while the person is being moved). A quad written straight into
// clip space, so each eye draws it over its own whole view, locked to the head with no lag. The
// vignette is measured as an angle from where each eye is actually pointing (a headset's lenses
// are off-centre in their views, by a different amount in each eye), so the two eyes see the same
// ring and do not fight over its edge.
Shader "Orion/Veil"
{
    Properties
    {
        _Fade ("Fade", Range(0,1)) = 1
        _Inner ("Tan of the clear half-angle", Float) = 1.6
    }
    SubShader
    {
        Tags { "Queue" = "Overlay+100" "RenderType" = "Transparent" "RenderPipeline" = "UniversalPipeline" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZTest Always ZWrite Off Cull Off
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "UnityCG.cginc"

            float _Fade, _Inner;
            struct appdata { float4 vertex : POSITION; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct v2f { float4 pos : SV_POSITION; float2 ray : TEXCOORD0; UNITY_VERTEX_OUTPUT_STEREO };

            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.pos = float4(v.vertex.xy, UNITY_NEAR_CLIP_VALUE, 1);
                float4x4 p = UNITY_MATRIX_P;
                o.ray = float2((v.vertex.x + p[0][2]) / p[0][0], (v.vertex.y + p[1][2]) / p[1][1]);
                return o;
            }
            fixed4 frag (v2f i) : SV_Target
            {
                float edge = smoothstep(_Inner, _Inner + .4, length(i.ray));
                return fixed4(0, 0, 0, max(_Fade, edge));
            }
            ENDCG
        }
    }
}

// The city: photogrammetry, which has its lighting in its photographs, so it is drawn as it is and then
// hazed with distance, so that its far edge fades into the sky instead of ending. The haze is Orion's own
// (_OrionHaze, _OrionHazeRange, set once by City) and is measured from the eye in every direction, so it does
// not shift as a head turns. It stands in for Cesium's own unlit material (which has no haze, and carries
// overlays, vertex colours and texture transforms that Google's tiles do not use), and takes the properties
// Cesium sets on a tile's material. There are hundreds of tiles in view, each with a material of its own: the
// per-material values are in a UnityPerMaterial buffer so that the SRP Batcher can draw them without a state
// change apiece, which on a headset's CPU is the difference between holding the frame rate and not.
Shader "Orion/Tiles"
{
    Properties
    {
        _baseColorTexture ("Base colour", 2D) = "white" {}
        _baseColorFactor ("Base colour factor", Color) = (1,1,1,1)
    }
    SubShader
    {
        Tags { "Queue" = "Geometry" "RenderType" = "Opaque" "RenderPipeline" = "UniversalPipeline" }
        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            TEXTURE2D(_baseColorTexture); SAMPLER(sampler_baseColorTexture);
            CBUFFER_START(UnityPerMaterial)
                float4 _baseColorTexture_ST;
                half4 _baseColorFactor;
            CBUFFER_END
            half4 _OrionHaze;
            float4 _OrionHazeRange;      // x: where the haze starts, y: where nothing else is left, metres

            struct Attributes { float4 positionOS : POSITION; float2 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct Varyings { float4 positionCS : SV_POSITION; float2 uv : TEXCOORD0; float away : TEXCOORD1; UNITY_VERTEX_OUTPUT_STEREO };

            Varyings vert (Attributes v)
            {
                Varyings o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                float3 positionWS = TransformObjectToWorld(v.positionOS.xyz);
                o.positionCS = TransformWorldToHClip(positionWS);
                o.uv = TRANSFORM_TEX(v.uv, _baseColorTexture);
                o.away = distance(positionWS, GetCameraPositionWS());
                return o;
            }
            half4 frag (Varyings i) : SV_Target
            {
                half3 c = SAMPLE_TEXTURE2D(_baseColorTexture, sampler_baseColorTexture, i.uv).rgb * _baseColorFactor.rgb;
                half haze = saturate((i.away - _OrionHazeRange.x) / (_OrionHazeRange.y - _OrionHazeRange.x));
                return half4(lerp(c, _OrionHaze.rgb, haze * haze * (3 - 2 * haze)), 1);
            }
            ENDHLSL
        }
    }
}

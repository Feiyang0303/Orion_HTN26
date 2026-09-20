// The city: photogrammetry, which has its lighting in its photographs, so it is drawn as it is and then
// hazed with distance, so that its far edge fades into the sky instead of ending. The haze is Orion's own
// (_OrionHaze, _OrionHazeRange, set once by City) and is measured from the eye in every direction, so it does not
// shift as a head turns. It stands in for Cesium's
// own unlit material (which has no haze, and carries overlays, vertex colours and texture transforms that
// Google's tiles do not use), and takes the properties Cesium sets on a tile's material.
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
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "UnityCG.cginc"

            sampler2D _baseColorTexture;
            float4 _baseColorTexture_ST;
            fixed4 _baseColorFactor;
            fixed4 _OrionHaze;
            float4 _OrionHazeRange;      // x: where the haze starts, y: where nothing else is left, metres

            struct appdata { float4 vertex : POSITION; float2 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct v2f { float4 pos : SV_POSITION; float2 uv : TEXCOORD0; float away : TEXCOORD1; UNITY_VERTEX_OUTPUT_STEREO };

            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = TRANSFORM_TEX(v.uv, _baseColorTexture);
                o.away = length(UnityObjectToViewPos(v.vertex));
                return o;
            }
            fixed4 frag (v2f i) : SV_Target
            {
                fixed4 c = tex2D(_baseColorTexture, i.uv) * _baseColorFactor;
                float haze = saturate((i.away - _OrionHazeRange.x) / (_OrionHazeRange.y - _OrionHazeRange.x));
                return fixed4(lerp(c.rgb, _OrionHaze.rgb, haze * haze * (3 - 2 * haze)), 1);
            }
            ENDCG
        }
    }
}

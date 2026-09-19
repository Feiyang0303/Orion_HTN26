// A dusk sky. The tiles end at the horizon, and the dark beyond them should be a sky and not a
// void; its colour at the horizon is the haze the city fades into.
Shader "Orion/Sky"
{
    SubShader
    {
        Tags { "Queue" = "Background" "RenderType" = "Background" "PreviewType" = "Skybox" }
        Cull Off ZWrite Off
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            struct appdata { float4 vertex : POSITION; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct v2f { float4 pos : SV_POSITION; float3 dir : TEXCOORD0; UNITY_VERTEX_OUTPUT_STEREO };

            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.pos = UnityObjectToClipPos(v.vertex);
                o.dir = v.vertex.xyz;
                return o;
            }
            fixed4 frag (v2f i) : SV_Target
            {
                float h = normalize(i.dir).y;
                float3 glow = lerp(float3(.30, .17, .08), float3(.10, .07, .07), smoothstep(0., .22, h));
                float3 c = lerp(glow, float3(.027, .024, .04), smoothstep(.12, .7, h));
                return fixed4(GammaToLinearSpace(lerp(float3(.05, .04, .035), c, smoothstep(-.12, 0., h))), 1);      // the colours are display values; the project renders in linear
            }
            ENDCG
        }
    }
}

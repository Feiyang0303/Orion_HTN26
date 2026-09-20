// One stretch of a leg, drawn as light laid along the street, as the desktop flight draws it.
//
// It is a ribbon, not a line: flat on the ground, as wide as the street it follows (and never narrower to the
// eye than a line would be, so it still reads from two kilometres off), soft at its edges, with light flowing
// slowly along it the way the leg is travelled. When the flight is on a leg the ribbon itself says where: it
// burns brightest just behind the traveller and cools to an ember where they have already been, so the way
// ahead is the bright part. Footsteps and long dashes are brighter marks on a ribbon that stays whole between
// them; only a guess is truly broken.
//
// The mesh carries, for every vertex, which way is sideways (NORMAL), which edge it is (uv.x, -1 or 1) and how
// far along the whole leg it is in metres (uv.y); the width is given here.
Shader "Orion/Route"
{
    Properties
    {
        _Colour ("Colour", Color) = (1,1,1,1)
        _Warm ("Warm", Color) = (1,.95,.84,1)
        _WidthM ("Width on the ground, metres", Float) = 5
        _MinWidth ("Least width, as a fraction of distance", Float) = .0057
        _Lift ("Lift", Float) = 3
        _Opacity ("Opacity", Float) = .95
        _Soft ("Edge softness", Float) = .3
        _FlowMps ("Flow, m/s", Float) = 9
        _DashOn ("Mark, metres", Float) = 0
        _DashOff ("Gap, metres", Float) = 0
        _Between ("Brightness between marks", Float) = .42
        _Head ("Traveller, metres along (-1: not on this leg)", Float) = -1
        _Trail ("Wake length, metres", Float) = 70
        [Enum(UnityEngine.Rendering.CompareFunction)] _ZTest ("Depth test", Float) = 4
    }
    SubShader
    {
        Tags { "Queue" = "Transparent" "RenderType" = "Transparent" "RenderPipeline" = "UniversalPipeline" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off Cull Off ZTest [_ZTest]
        Offset -2, -2
        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _Colour, _Warm;
                float _WidthM, _MinWidth, _Lift, _Opacity, _Soft, _FlowMps, _DashOn, _DashOff, _Between, _Head, _Trail, _ZTest;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; float3 side : NORMAL; float2 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct Varyings { float4 positionCS : SV_POSITION; float2 edgeAlong : TEXCOORD0; UNITY_VERTEX_OUTPUT_STEREO };

            Varyings vert (Attributes v)
            {
                Varyings o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                float3 at = TransformObjectToWorld(v.positionOS.xyz);
                // From far off the city under it is a coarser model than the one its heights were read from, and stands
                // metres off it, so the ribbon rides a little higher the farther away it is seen from.
                float away = distance(at, GetCameraPositionWS());
                at.y += _Lift + away * .006;
                float halfWidth = max(_WidthM, _MinWidth * away) * .5;
                at += TransformObjectToWorldDir(v.side) * (v.uv.x * halfWidth);
                o.positionCS = TransformWorldToHClip(at);
                o.edgeAlong = v.uv;
                return o;
            }

            half4 frag (Varyings i) : SV_Target
            {
                float across = abs(i.edgeAlong.x), along = i.edgeAlong.y;
                float body = 1 - smoothstep(1 - _Soft, 1, across);
                float core = 1 - smoothstep(0, .45, across);

                // Light moving along it, in the direction of travel.
                float ph = frac((along - _Time.y * _FlowMps) / 140);
                float flow = smoothstep(0, .5, ph) * (1 - smoothstep(.5, 1, ph));

                // Footsteps and long dashes; from far enough off that they would shimmer, an even tone instead.
                float marks = 1;
                if (_DashOn > 0)
                {
                    float period = _DashOn + _DashOff, m = fmod(along, period);
                    float mark = smoothstep(0, 1, m) * (1 - smoothstep(_DashOn - 1, _DashOn, m));
                    marks = lerp(_Between, 1, lerp(mark, _DashOn / period, saturate(fwidth(along) / period * 2.5)));
                }

                // Where the flight is on this leg, if it is: a wake of light just behind the traveller, cooling to an ember
                // over the ground already covered. Ahead of them the ribbon is as bright as it ever is.
                float behind = _Head - along;
                float travelled = _Head >= 0 && behind > 0 ? 1 : 0;
                float wake = travelled * exp(-behind / _Trail);
                float ember = lerp(1, .38, travelled * smoothstep(0, _Trail * 2.5, behind));

                half3 c = _Colour.rgb * (.78 + .3 * flow) + _Warm.rgb * (core * .22 + wake * .9);
                float a = (_Opacity * body * marks * (.78 + .22 * flow)) * ember + wake * body * .6;
                return half4(c, saturate(a));
            }
            ENDHLSL
        }
    }
}

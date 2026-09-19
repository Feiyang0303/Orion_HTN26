using System;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEditor.XR.Management;
using UnityEditor.XR.Management.Metadata;
using UnityEditor.XR.OpenXR.Features;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.XR.Management;
using UnityEngine.XR.OpenXR;
using UnityEngine.XR.OpenXR.Features;
using UnityEngine.XR.OpenXR.Features.Interactions;
using UnityEngine.XR.OpenXR.Features.MetaQuestSupport;

namespace Orion.Editor
{
    /* The project, from the command line. Nothing here is clicked through a menu:
     *
     *   Unity -batchmode       -projectPath quest -buildTarget Android -executeMethod Orion.Editor.Build.ImportText
     *   Unity -batchmode -quit -projectPath quest -buildTarget Android -executeMethod Orion.Editor.Build.Setup
     *   Unity -batchmode -quit -projectPath quest -buildTarget Android -executeMethod Orion.Editor.Build.Apk
     *
     * (quest/build.sh wraps both.) Setup is safe to run again; Apk runs it first. */

    public static class Build
    {
        const string Scene = "Assets/Orion/Main.unity";
        const string Settings = "Assets/Orion/Settings";
        const string ConfigPath = "Assets/Orion/Resources/OrionConfig.json";
        const string ApkPath = "Build/orion-quest.apk";

        public static void Setup()
        {
            Pipeline();
            Player();
            Headset();
            MainScene();
            // The XR packages leave empty, numbered twins of their own folders behind on a first run.
            foreach (string stray in new[] { "Assets/XR 1", "Assets/XR/Settings 1" })
                if (AssetDatabase.IsValidFolder(stray) && Directory.GetFileSystemEntries(stray).Length == 0) AssetDatabase.DeleteAsset(stray);
            AssetDatabase.SaveAssets();
        }

        public static void Apk()
        {
            Setup();
            WriteConfig();
            Directory.CreateDirectory(Path.GetDirectoryName(ApkPath));
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions { scenes = new[] { Scene }, locationPathName = ApkPath, target = BuildTarget.Android, options = BuildOptions.None });
            if (report.summary.result != BuildResult.Succeeded) throw new Exception($"The build {report.summary.result}: {report.summary.totalErrors} errors.");
            Debug.Log($"Orion: built {ApkPath} ({report.summary.totalSize / 1e6:0} MB)");
        }

        /// <summary>The Google tiles key, from ORION_GOOGLE_TILES_KEY or else from the web app's .env beside this
        /// project (VITE_GOOGLE_MAPS_KEY), into a Resources file that git ignores. It is never logged.</summary>
        public static void WriteConfig()
        {
            string key = Environment.GetEnvironmentVariable("ORION_GOOGLE_TILES_KEY");
            if (string.IsNullOrEmpty(key))
            {
                string env = Path.GetFullPath(Path.Combine(Application.dataPath, "../../.env"));
                if (!File.Exists(env)) throw new Exception($"No Google tiles key: set ORION_GOOGLE_TILES_KEY, or put VITE_GOOGLE_MAPS_KEY in {env}.");
                var line = Regex.Match(File.ReadAllText(env), @"^\s*VITE_GOOGLE_MAPS_KEY\s*=\s*[""']?([^""'\r\n#]+)", RegexOptions.Multiline);
                if (!line.Success) throw new Exception($"{env} has no VITE_GOOGLE_MAPS_KEY.");
                key = line.Groups[1].Value.Trim();
            }
            File.WriteAllText(ConfigPath, JsonUtility.ToJson(new Config { googleTilesKey = key }, true));
            AssetDatabase.ImportAsset(ConfigPath);
        }

        /// <summary>TextMeshPro's font and shaders, which ship inside its package as something to import. The import
        /// finishes after this returns, so this is run on its own, without -quit, and closes the editor itself.</summary>
        public static void ImportText()
        {
            if (Directory.Exists("Assets/TextMesh Pro")) { EditorApplication.Exit(0); return; }
            AssetDatabase.importPackageCompleted += _ => EditorApplication.Exit(0);
            AssetDatabase.importPackageFailed += (_, error) => { Debug.LogError($"TextMeshPro's resources would not import: {error}"); EditorApplication.Exit(1); };
            AssetDatabase.ImportPackage("Packages/com.unity.ugui/Package Resources/TMP Essential Resources.unitypackage", false);
        }

        /// <summary>A folder the asset database knows about: one made behind its back gets a second, numbered twin.</summary>
        static void Folder(string parent, string name)
        {
            if (!AssetDatabase.IsValidFolder($"{parent}/{name}")) AssetDatabase.CreateFolder(parent, name);
        }

        /// <summary>A render pipeline a mobile GPU can hold 72 Hz with: no HDR, no shadows, no depth or opaque
        /// copies, no post-processing. The city's lighting is in its photographs.</summary>
        static void Pipeline()
        {
            Folder("Assets/Orion", "Settings");
            string rendererPath = $"{Settings}/OrionRenderer.asset", pipelinePath = $"{Settings}/OrionPipeline.asset";
            var pipeline = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(pipelinePath);
            if (pipeline == null)
            {
                var renderer = ScriptableObject.CreateInstance<UniversalRendererData>();
                AssetDatabase.CreateAsset(renderer, rendererPath);
                ResourceReloader.ReloadAllNullIn(renderer, UniversalRenderPipelineAsset.packagePath);
                renderer.postProcessData = null;
                pipeline = UniversalRenderPipelineAsset.Create(renderer);
                AssetDatabase.CreateAsset(pipeline, pipelinePath);
            }
            pipeline.supportsHDR = false;
            pipeline.msaaSampleCount = 4;
            pipeline.supportsCameraDepthTexture = false;
            pipeline.supportsCameraOpaqueTexture = false;
            pipeline.shadowDistance = 0;
            pipeline.renderScale = 1;
            EditorUtility.SetDirty(pipeline);
            GraphicsSettings.defaultRenderPipeline = pipeline;
            for (int i = 0; i < QualitySettings.names.Length; i++) { QualitySettings.SetQualityLevel(i, false); QualitySettings.renderPipeline = pipeline; }
        }

        static void Player()
        {
            PlayerSettings.companyName = "Orion";
            PlayerSettings.productName = "Orion";
            PlayerSettings.SetApplicationIdentifier(UnityEditor.Build.NamedBuildTarget.Android, "com.orion.quest");
            PlayerSettings.SetScriptingBackend(UnityEditor.Build.NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel32;
            PlayerSettings.Android.forceInternetPermission = true;
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.Android, false);
            PlayerSettings.SetGraphicsAPIs(BuildTarget.Android, new[] { GraphicsDeviceType.Vulkan });
            PlayerSettings.colorSpace = ColorSpace.Linear;
            PlayerSettings.SetMobileMTRendering(UnityEditor.Build.NamedBuildTarget.Android, true);
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.LandscapeLeft;
            EditorUserBuildSettings.androidBuildSystem = AndroidBuildSystem.Gradle;
        }

        /// <summary>OpenXR on Android with Meta Quest support, Touch controllers, one pass for both eyes
        /// (multiview) and foveated rendering.</summary>
        static void Headset()
        {
            const BuildTargetGroup group = BuildTargetGroup.Android;
            if (!EditorBuildSettings.TryGetConfigObject(XRGeneralSettings.settingsKey, out XRGeneralSettingsPerBuildTarget perTarget))
            {
                Folder("Assets", "XR");
                perTarget = ScriptableObject.CreateInstance<XRGeneralSettingsPerBuildTarget>();
                AssetDatabase.CreateAsset(perTarget, "Assets/XR/XRGeneralSettingsPerBuildTarget.asset");
                EditorBuildSettings.AddConfigObject(XRGeneralSettings.settingsKey, perTarget, true);
            }
            if (!perTarget.HasSettingsForBuildTarget(group)) perTarget.CreateDefaultSettingsForBuildTarget(group);
            if (!perTarget.HasManagerSettingsForBuildTarget(group)) perTarget.CreateDefaultManagerSettingsForBuildTarget(group);
            var manager = perTarget.ManagerSettingsForBuildTarget(group);
            if (!manager.activeLoaders.Any(l => l is OpenXRLoader) && !XRPackageMetadataStore.AssignLoader(manager, typeof(OpenXRLoader).FullName, group))
                throw new Exception("The OpenXR loader could not be assigned for Android.");
            EditorUtility.SetDirty(perTarget);

            FeatureHelpers.RefreshFeatures(group);
            var openxr = OpenXRSettings.GetSettingsForBuildTargetGroup(group);
            openxr.renderMode = OpenXRSettings.RenderMode.SinglePassInstanced;
            foreach (var feature in openxr.GetFeatures())
                if (feature is MetaQuestFeature || feature is OculusTouchControllerProfile || feature is FoveatedRenderingFeature) feature.enabled = true;
            if (!openxr.GetFeatures().Any(f => f is MetaQuestFeature && f.enabled)) throw new Exception("OpenXR's Meta Quest Support feature was not found.");
            EditorUtility.SetDirty(openxr);
        }

        /// <summary>The scene is empty: App builds everything when it loads.</summary>
        static void MainScene()
        {
            if (!File.Exists(Scene)) EditorSceneManager.SaveScene(EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single), Scene);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(Scene, true) };
        }
    }
}

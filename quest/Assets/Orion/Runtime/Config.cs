using System;
using UnityEngine;

namespace Orion
{
    /// <summary>What the build was given: written to Resources/OrionConfig.json by the build script from the
    /// web app's .env, and kept out of git.</summary>
    [Serializable]
    public class Config
    {
        public string googleTilesKey;
        public string apiBase = "https://orion-coral.vercel.app";

        public static Config Load()
        {
            var asset = Resources.Load<TextAsset>("OrionConfig");
            if (asset == null) throw new InvalidOperationException("Resources/OrionConfig.json is missing: build with Orion.Editor.Build, which writes it from the web app's .env.");
            var config = JsonUtility.FromJson<Config>(asset.text);
            if (string.IsNullOrEmpty(config.googleTilesKey)) throw new InvalidOperationException("OrionConfig.json has no googleTilesKey.");
            return config;
        }
    }
}

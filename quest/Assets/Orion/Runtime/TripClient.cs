using System;
using System.Collections;
using Orion.Flight;
using UnityEngine;
using UnityEngine.Networking;

namespace Orion
{
    /// <summary>The web app's API: the trip last sent to VR, and the guide's clips.</summary>
    public class TripClient
    {
        readonly string apiBase;
        public TripClient(string apiBase) { this.apiBase = apiBase.TrimEnd('/'); }

        /// <summary>The trip last sent to VR from the web app. `onNone` if nothing has been sent yet.</summary>
        public IEnumerator Current(Action<Trip> onTrip, Action onNone, Action<string> onError)
        {
            using var current = UnityWebRequest.Get($"{apiBase}/api/vr/current");
            yield return current.SendWebRequest();
            if (current.responseCode == 404) { onNone(); yield break; }
            if (current.result != UnityWebRequest.Result.Success) { onError(current.error); yield break; }
            string id = JsonUtility.FromJson<CurrentTrip>(current.downloadHandler.text).id;

            using var get = UnityWebRequest.Get($"{apiBase}/api/trips/get?id={UnityWebRequest.EscapeURL(id)}");
            yield return get.SendWebRequest();
            if (get.result != UnityWebRequest.Result.Success) { onError(get.error); yield break; }
            onTrip(JsonUtility.FromJson<TripEnvelope>(get.downloadHandler.text).trip);
        }

        /// <summary>One of the guide's clips. `audioUrl` is a path on the API.</summary>
        public IEnumerator Clip(string audioUrl, Action<AudioClip> onClip)
        {
            using var req = UnityWebRequestMultimedia.GetAudioClip(apiBase + audioUrl, AudioType.MPEG);
            yield return req.SendWebRequest();
            if (req.result == UnityWebRequest.Result.Success) onClip(DownloadHandlerAudioClip.GetContent(req));
            else Debug.LogWarning($"Orion: a clip would not load ({req.error}); its caption still shows for its length.");
        }
    }
}

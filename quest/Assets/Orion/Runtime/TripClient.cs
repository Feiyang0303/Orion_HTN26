using System;
using System.Collections;
using System.Text;
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

        /// <summary>Which trip was last sent to VR from the web app (its VR button): its id, or null if none has been yet.
        /// `onError` if the server could not be asked.</summary>
        public IEnumerator CurrentId(Action<string> onId, Action<string> onError)
        {
            using var current = UnityWebRequest.Get($"{apiBase}/api/vr/current");
            current.timeout = 15;
            yield return current.SendWebRequest();
            if (current.responseCode == 404) onId(null);
            else if (current.result != UnityWebRequest.Result.Success) onError(current.error);
            else onId(JsonUtility.FromJson<CurrentTrip>(current.downloadHandler.text).id);
        }

        public IEnumerator Trip(string id, Action<Trip> onTrip, Action<string> onError)
        {
            using var get = UnityWebRequest.Get($"{apiBase}/api/trips/get?id={UnityWebRequest.EscapeURL(id)}");
            get.timeout = 30;
            yield return get.SendWebRequest();
            if (get.result != UnityWebRequest.Result.Success) onError(get.error);
            else onTrip(JsonUtility.FromJson<TripEnvelope>(get.downloadHandler.text).trip);
        }

        [Serializable] class Line { public string text; }

        /// <summary>A clip the trip already has. `audioUrl` is a path on the API. Null if it cannot be had.</summary>
        public IEnumerator Clip(string audioUrl, Action<byte[]> onBytes)
        {
            using var req = UnityWebRequest.Get(apiBase + audioUrl);
            req.timeout = 20;
            yield return req.SendWebRequest();
            onBytes(req.result == UnityWebRequest.Result.Success ? req.downloadHandler.data : null);
        }

        /// <summary>A line spoken in the guide's voice (POST /api/tts, as the web app does when a day is about to fly): an mp3, or null.</summary>
        public IEnumerator Speak(string text, Action<byte[]> onBytes)
        {
            using var req = new UnityWebRequest($"{apiBase}/api/tts", "POST")
            {
                uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(JsonUtility.ToJson(new Line { text = text }))),
                downloadHandler = new DownloadHandlerBuffer(),
                timeout = 30,
            };
            req.SetRequestHeader("content-type", "application/json");
            yield return req.SendWebRequest();
            bool spoken = req.result == UnityWebRequest.Result.Success && (req.GetResponseHeader("content-type") ?? "").StartsWith("audio/");
            if (!spoken) Debug.LogWarning($"Orion: a line would not be spoken ({req.responseCode} {req.error}); its caption still shows for its length.");
            onBytes(spoken ? req.downloadHandler.data : null);
        }
    }
}

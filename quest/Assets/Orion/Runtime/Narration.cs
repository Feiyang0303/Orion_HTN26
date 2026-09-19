using System.Collections.Generic;
using Orion.Flight;
using UnityEngine;

namespace Orion
{
    /// <summary>The guide's voice: one clip per beat, started where the clock says it should be. Clips are
    /// fetched a stop ahead, so they are there when their beat comes. A beat with no clip is a caption
    /// that shows for its length.</summary>
    public class Narration : MonoBehaviour
    {
        readonly Dictionary<string, AudioClip> clips = new Dictionary<string, AudioClip>();
        readonly HashSet<string> asked = new HashSet<string>();
        TripClient client;
        AudioSource voice;
        BeatSlot speaking;

        public static Narration Make(Transform head, TripClient client)
        {
            var n = head.gameObject.AddComponent<Narration>();
            n.client = client;
            n.voice = head.gameObject.AddComponent<AudioSource>();
            n.voice.spatialBlend = 0; n.voice.playOnAwake = false;
            return n;
        }

        /// <summary>Have the clips of these stops to hand.</summary>
        public void Fetch(Day day, int fromStop, int toStop)
        {
            for (int i = Mathf.Max(0, fromStop); i <= Mathf.Min(day.stops.Length - 1, toStop); i++)
                foreach (var beat in day.stops[i].beats)
                {
                    string url = beat.audioUrl;
                    if (!string.IsNullOrEmpty(url) && asked.Add(url)) StartCoroutine(client.Clip(url, clip => clips[url] = clip));
                }
        }

        /// <summary>Each frame: the beat the clock is in (or null), the clock, and whether it is running.</summary>
        public void Tick(BeatSlot beat, float t, bool playing)
        {
            if (beat != speaking) { speaking = beat; voice.Stop(); voice.clip = null; }
            if (beat == null || string.IsNullOrEmpty(beat.Beat.audioUrl) || !clips.TryGetValue(beat.Beat.audioUrl, out var clip)) return;
            if (!playing) { if (voice.isPlaying) voice.Pause(); return; }
            float at = t - beat.T0;
            if (voice.clip != clip) { voice.clip = clip; if (at < clip.length - .05f) { voice.time = Mathf.Max(0, at); voice.Play(); } }
            else if (!voice.isPlaying && voice.time > 0 && voice.time < clip.length - .05f) voice.UnPause();
        }
    }
}

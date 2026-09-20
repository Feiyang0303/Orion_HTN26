using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using Orion.Flight;
using UnityEngine;
using UnityEngine.Networking;

namespace Orion
{
    /* The guide's voice: one clip per beat, started where the clock says it should be.
     *
     * Before a day flies, every beat is given its clip: the one the trip already has, or, as the web app does when a
     * day is about to fly, the line spoken for it now. A beat is then exactly as long as its clip, which is what the
     * timeline is built from. Every clip is kept on the headset under the words it says, so a line is only ever paid
     * for once; and what may be asked for in a day is bounded (DailyBudget.Voice). A beat that cannot be voiced is a
     * caption that shows for the length the plan guessed. */

    public class Narration : MonoBehaviour
    {
        const int AtOnce = 4;

        readonly Dictionary<Beat, AudioClip> clips = new Dictionary<Beat, AudioClip>();
        TripClient client;
        AudioSource voice;
        BeatSlot speaking;
        string folder;

        public static Narration Make(Transform head, TripClient client)
        {
            var n = head.gameObject.AddComponent<Narration>();
            n.client = client;
            n.voice = head.gameObject.AddComponent<AudioSource>();
            n.voice.spatialBlend = 0; n.voice.playOnAwake = false;
            n.folder = Path.Combine(Application.persistentDataPath, "voice");
            Directory.CreateDirectory(n.folder);
            return n;
        }

        /// <summary>Give every beat of the day its clip and its true length, then say so.</summary>
        public IEnumerator Voice(Day day, Action done)
        {
            var waiting = new Queue<Beat>(day.Spoken());
            int running = 0, total = waiting.Count;
            while (waiting.Count > 0 || running > 0)
            {
                while (running < AtOnce && waiting.Count > 0) { running++; StartCoroutine(One(waiting.Dequeue(), () => running--)); }
                yield return null;
            }
            Debug.Log($"[orion] voiced {clips.Count} of {total} lines; {DailyBudget.Voice.SpentToday}/{DailyBudget.Voice.PerDay} characters asked for today");
            done();
        }

        IEnumerator One(Beat beat, Action finished)
        {
            bool has = !string.IsNullOrEmpty(beat.audioUrl);
            string file = Path.Combine(folder, Name(has ? beat.audioUrl : beat.text) + ".mp3");
            if (!File.Exists(file))
            {
                byte[] bytes = null;
                if (has) yield return client.Clip(beat.audioUrl, b => bytes = b);
                else if (DailyBudget.Voice.TrySpend(beat.text.Length)) yield return client.Speak(beat.text, b => bytes = b);
                if (bytes != null) File.WriteAllBytes(file, bytes);
            }
            if (File.Exists(file))
            {
                using var load = UnityWebRequestMultimedia.GetAudioClip("file://" + file, AudioType.MPEG);
                yield return load.SendWebRequest();
                var clip = load.result == UnityWebRequest.Result.Success ? DownloadHandlerAudioClip.GetContent(load) : null;
                if (clip != null && clip.length > .1f) { clips[beat] = clip; beat.durationSec = clip.length; }
                else File.Delete(file);                     // not a clip after all: ask again another time
            }
            finished();
        }

        static string Name(string of)
        {
            using var sha = SHA1.Create();
            var s = new StringBuilder();
            foreach (byte b in sha.ComputeHash(Encoding.UTF8.GetBytes(of))) s.Append(b.ToString("x2"));
            return s.ToString();
        }

        /// <summary>Each frame: the beat the clock is in (or null), the clock, and whether it is running.</summary>
        public void Tick(BeatSlot beat, float t, bool playing)
        {
            if (beat != speaking) { speaking = beat; voice.Stop(); voice.clip = null; }
            if (beat == null || !clips.TryGetValue(beat.Beat, out var clip)) return;
            if (!playing) { if (voice.isPlaying) voice.Pause(); return; }
            float at = t - beat.T0;
            if (voice.clip != clip) { voice.clip = clip; if (at < clip.length - .05f) { voice.time = Mathf.Max(0, at); voice.Play(); } }
            else if (!voice.isPlaying && voice.time > 0 && voice.time < clip.length - .05f) voice.UnPause();
        }
    }
}

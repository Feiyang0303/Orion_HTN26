using System;
using UnityEngine;

namespace Orion
{
    /* Two things this app asks for cost its owner money: a load of Google's tileset (a "root request", billed, and
     * refused for everyone using the key once the day's quota is gone) and a line of speech from ElevenLabs (billed
     * by the character). A normal run makes one of the first and, the first time a trip is flown, a few hundred of
     * the second. So this device keeps count by the day (Pacific, Google's own) and past a generous day's worth it
     * will not ask again until tomorrow: a relaunch loop, a crash loop or a bug can cost a bounded amount and no more.
     * The real limits belong on the accounts themselves. */

    public class DailyBudget
    {
        public static readonly DailyBudget Tiles = new DailyBudget("tiles", 40);          // loads of Google's tileset
        public static readonly DailyBudget Voice = new DailyBudget("voice", 15000);       // characters of speech

        public readonly int PerDay;
        readonly string dayKey, countKey;

        DailyBudget(string name, int perDay) { PerDay = perDay; dayKey = $"orion.{name}.day"; countKey = $"orion.{name}.count"; }

        static string Today => DateTime.UtcNow.AddHours(-8).ToString("yyyy-MM-dd");

        public int SpentToday => PlayerPrefs.GetString(dayKey) == Today ? PlayerPrefs.GetInt(countKey) : 0;

        /// <summary>Take `amount` from today's allowance. False, and nothing taken, if it is not there.</summary>
        public bool TrySpend(int amount = 1)
        {
            int spent = SpentToday;
            if (spent + amount > PerDay) return false;
            PlayerPrefs.SetString(dayKey, Today);
            PlayerPrefs.SetInt(countKey, spent + amount);
            PlayerPrefs.Save();                  // before the request is made, so a crash straight after still counts
            return true;
        }
    }
}

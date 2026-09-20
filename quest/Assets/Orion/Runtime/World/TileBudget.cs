using System;
using UnityEngine;

namespace Orion.World
{
    /* Google bills each load of its tileset (a "root request"), and refuses them all, for everyone using the key, once
     * the day's quota is gone. A normal run makes one. So this device keeps count, by Google's own day (Pacific), and
     * past a generous day's worth it will not ask again until tomorrow: a relaunch loop, a crash loop or a bug can
     * cost a few dozen requests and no more. The real limit belongs on the key itself, in Google Cloud. */

    public static class TileBudget
    {
        public const int PerDay = 40;
        const string DayKey = "orion.tiles.day", CountKey = "orion.tiles.count";

        static string Today => DateTime.UtcNow.AddHours(-8).ToString("yyyy-MM-dd");

        public static int SpentToday => PlayerPrefs.GetString(DayKey) == Today ? PlayerPrefs.GetInt(CountKey) : 0;

        /// <summary>Take one load from today's allowance. False if there is none left.</summary>
        public static bool TrySpend()
        {
            int spent = SpentToday;
            if (spent >= PerDay) return false;
            PlayerPrefs.SetString(DayKey, Today);
            PlayerPrefs.SetInt(CountKey, spent + 1);
            PlayerPrefs.Save();                  // before the request is made, so a crash straight after still counts
            return true;
        }
    }
}

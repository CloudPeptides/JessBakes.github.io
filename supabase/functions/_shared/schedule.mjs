/* ==========================================
   DST-SAFE WEEKLY SCHEDULE MATH

   Determines, given a UTC instant and the admin-configured weekly
   send settings, whether "now" falls inside the send window for
   that configured weekday/local-time/timezone -- and what campaign
   key that occurrence maps to.

   DST safety comes from delegating all local-time math to
   Intl.DateTimeFormat with an explicit `timeZone` option, which
   reads the real IANA tz database (including its Europe/Berlin
   CET/CEST transition dates) built into the JS engine. No manual
   UTC-offset arithmetic is done anywhere in this file, so there is
   no hand-rolled DST rule to get wrong. This works identically in
   Deno (the Edge Function runtime) and Node (this repo's test
   runner) -- both ship a full ICU build.
   ========================================== */

const WEEKDAY_INDEX = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
    Thursday: 4, Friday: 5, Saturday: 6
};

/** Breaks a UTC Date into its local wall-clock parts in the given
 * IANA timezone: { year, month, day, hour, minute, weekday (0-6,
 * Sunday=0), isoDate ("YYYY-MM-DD") }. */
export function zonedParts(date, timeZone) {
    const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "long",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    });

    const parts = {};
    for (const { type, value } of fmt.formatToParts(date)) {
        parts[type] = value;
    }

    // Midnight is sometimes rendered "24" by some ICU builds under
    // hour12:false -- normalize to 0 so minute-of-day math below
    // never goes out of range.
    const hour = parts.hour === "24" ? 0 : Number(parts.hour);

    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour,
        minute: Number(parts.minute),
        weekday: WEEKDAY_INDEX[parts.weekday],
        isoDate: `${parts.year}-${parts.month}-${parts.day}`
    };
}

/** Parses "HH:MM" (24h, as stored in email_settings.weekly_local_time)
 * into minutes-since-midnight. Returns null for anything malformed
 * rather than throwing, so a bad admin-entered value degrades to
 * "never due" instead of crashing the scheduler. */
export function parseLocalTimeToMinutes(hhmm) {
    const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || "").trim());
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * @param {Date} nowUtc
 * @param {{weekly_weekday:number, weekly_local_time:string, weekly_timezone:string}} settings
 * @param {number} windowMinutes how long after the target time the
 *   occurrence is still considered "due" -- gives a cron-style
 *   poller (which won't fire at the exact minute) room to catch it.
 * @returns {{due:boolean, campaignKey:string|null, isoDate:string}}
 */
export function isWeeklySendDue(nowUtc, settings, windowMinutes = 30) {
    const tz = settings.weekly_timezone || "Europe/Berlin";
    const parts = zonedParts(nowUtc, tz);
    const targetMinutes = parseLocalTimeToMinutes(settings.weekly_local_time);

    if (targetMinutes === null) {
        return { due: false, campaignKey: null, isoDate: parts.isoDate };
    }

    if (parts.weekday !== Number(settings.weekly_weekday)) {
        return { due: false, campaignKey: null, isoDate: parts.isoDate };
    }

    const nowMinutes = parts.hour * 60 + parts.minute;
    const due = nowMinutes >= targetMinutes && nowMinutes < targetMinutes + windowMinutes;

    return {
        due,
        campaignKey: due ? `weekly_menu:${parts.isoDate}` : null,
        isoDate: parts.isoDate
    };
}

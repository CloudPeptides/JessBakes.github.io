/* ==========================================
   RECIPIENT BATCHING + PROVIDER QUOTA CHECK

   Pure functions -- no DB/network access.
   ========================================== */

/** Splits a flat list into batches of at most `size`. Never mutates
 * the input. */
export function chunk(list, size) {
    const items = Array.isArray(list) ? list : [];
    const n = Math.max(1, Number(size) || 1);
    const batches = [];
    for (let i = 0; i < items.length; i += n) {
        batches.push(items.slice(i, i + n));
    }
    return batches;
}

/**
 * Compares the number of recipients a send would reach against the
 * admin-configured daily/monthly provider limits (email_settings.
 * daily_send_limit / monthly_send_limit -- both nullable, meaning
 * "no configured limit / don't warn").
 *
 * @param {number} recipientCount
 * @param {{dailyLimit?: number|null, monthlyLimit?: number|null, sentToday?: number, sentThisMonth?: number}} quota
 * @returns {{exceedsDaily:boolean, exceedsMonthly:boolean, warn:boolean}}
 */
export function checkQuota(recipientCount, quota = {}) {
    const { dailyLimit, monthlyLimit, sentToday = 0, sentThisMonth = 0 } = quota;

    const exceedsDaily = Number.isFinite(dailyLimit) && dailyLimit !== null
        ? (sentToday + recipientCount) > dailyLimit
        : false;

    const exceedsMonthly = Number.isFinite(monthlyLimit) && monthlyLimit !== null
        ? (sentThisMonth + recipientCount) > monthlyLimit
        : false;

    return { exceedsDaily, exceedsMonthly, warn: exceedsDaily || exceedsMonthly };
}

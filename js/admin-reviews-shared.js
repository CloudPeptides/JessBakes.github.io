/* ==========================================
   ADMIN REVIEWS — shared query (BUG-10, Phase 5)
   ==========================================

   The one piece of `js/admin-dashboard.js` and `js/admin-reviews.js` that
   was genuinely, exactly duplicated: the query for pending (not yet
   approved) reviews, oldest first. Everything downstream of that query
   already differs on purpose (the Dashboard renders a small read-only
   count + 3-card preview; the Reviews page renders the full list with
   Approve/Delete actions) and is deliberately left alone -- forcing those
   into one shared render function would combine genuinely unlike
   behavior into a single abstraction.

   UMD-exported (window.AdminReviewsShared in the browser, module.exports
   under Node) so tests/admin-reviews-shared.test.js can verify the exact
   query shape without a real Supabase client or network call.
   ========================================== */

(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.AdminReviewsShared = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    /**
     * Fetches every review not yet approved, oldest first. Returns
     * whatever the Supabase client's query resolves to ({ data, error }),
     * unchanged -- callers handle the error/empty/success cases
     * themselves, since that handling is exactly where the Dashboard and
     * Reviews page legitimately differ.
     */
    async function fetchPendingReviews(supabaseClient) {
        return supabaseClient
            .from("reviews")
            .select("*")
            .eq("approved", false)
            .order("created_at", { ascending: true });
    }

    return { fetchPendingReviews };
});

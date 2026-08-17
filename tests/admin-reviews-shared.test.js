"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const AdminReviewsShared = require("../js/admin-reviews-shared.js");

/**
 * BUG-10 regression tests (docs/bakery-rebuild/03-bug-register.md): the
 * pending-reviews query was duplicated verbatim in js/admin-dashboard.js
 * and js/admin-reviews.js. fetchPendingReviews() is now the one place
 * that query is built; these tests verify its exact shape using a fake
 * Supabase client (a chainable stub recording every call) rather than a
 * real network call.
 */

function createFakeSupabaseClient(resolvedValue) {
    const calls = [];

    const builder = {
        from(table) { calls.push(["from", table]); return this; },
        select(cols) { calls.push(["select", cols]); return this; },
        eq(col, val) { calls.push(["eq", col, val]); return this; },
        order(col, opts) { calls.push(["order", col, opts]); return Promise.resolve(resolvedValue); }
    };

    return { calls, client: { from: builder.from.bind(builder) } };
}

test("1. fetchPendingReviews queries the reviews table filtered to approved:false, oldest first", async () => {
    const { calls, client } = createFakeSupabaseClient({ data: [], error: null });

    await AdminReviewsShared.fetchPendingReviews(client);

    assert.deepEqual(calls, [
        ["from", "reviews"],
        ["select", "*"],
        ["eq", "approved", false],
        ["order", "created_at", { ascending: true }]
    ]);
});

test("2. fetchPendingReviews resolves to exactly whatever the client returns (data), unchanged", async () => {
    const fakeReviews = [{ id: "1", name: "Sam", rating: 5, review: "Great!" }];
    const { client } = createFakeSupabaseClient({ data: fakeReviews, error: null });

    const result = await AdminReviewsShared.fetchPendingReviews(client);

    assert.deepEqual(result.data, fakeReviews);
    assert.equal(result.error, null);
});

test("3. fetchPendingReviews resolves to exactly whatever the client returns (error), unchanged -- callers handle their own error UI", async () => {
    const fakeError = { message: "network down" };
    const { client } = createFakeSupabaseClient({ data: null, error: fakeError });

    const result = await AdminReviewsShared.fetchPendingReviews(client);

    assert.equal(result.data, null);
    assert.deepEqual(result.error, fakeError);
});

test("4. both admin-dashboard.js and admin-reviews.js call the exact same shared function (source-level check, not just behavior)", () => {
    const fs = require("node:fs");
    const dashboardSrc = fs.readFileSync(require("node:path").join(__dirname, "..", "js", "admin-dashboard.js"), "utf8");
    const reviewsSrc = fs.readFileSync(require("node:path").join(__dirname, "..", "js", "admin-reviews.js"), "utf8");

    assert.ok(dashboardSrc.includes("AdminReviewsShared.fetchPendingReviews("), "admin-dashboard.js should call the shared query");
    assert.ok(reviewsSrc.includes("AdminReviewsShared.fetchPendingReviews("), "admin-reviews.js should call the shared query");

    // The query itself should no longer be duplicated inline in either file.
    assert.ok(!dashboardSrc.includes('.eq("approved", false)'), "admin-dashboard.js should no longer inline the query");
    assert.ok(!reviewsSrc.includes('.eq("approved", false)'), "admin-reviews.js should no longer inline the query");
});

test("5. admin/dashboard.html and admin/reviews.html both load the shared module before their own page script", () => {
    const fs = require("node:fs");
    const path = require("node:path");

    for (const [page, ownScript] of [["dashboard.html", "admin-dashboard.js"], ["reviews.html", "admin-reviews.js"]]) {
        const html = fs.readFileSync(path.join(__dirname, "..", "admin", page), "utf8");
        const sharedIndex = html.indexOf("admin-reviews-shared.js");
        const ownIndex = html.indexOf(ownScript);

        assert.ok(sharedIndex !== -1, `${page} should load admin-reviews-shared.js`);
        assert.ok(ownIndex !== -1, `${page} should load ${ownScript}`);
        assert.ok(sharedIndex < ownIndex, `${page} should load the shared module before ${ownScript}`);
    }
});

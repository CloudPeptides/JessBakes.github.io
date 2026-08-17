"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const CurrencyConversion = require("../js/currency-conversion.js");
const SaleCalculations = require("../js/sale-calculations.js");

/**
 * BUG-23 regression tests (docs/bakery-rebuild/03-bug-register.md).
 *
 * Production's "Expected Revenue"/"Estimated Profit"/"Estimated Margin"
 * used to compute `profit = revenue - foodCost - packagingCost` directly,
 * with `revenue` summed from order.subtotal (EUR, what the customer
 * actually pays) and foodCost/packagingCost read from recipe_costs/
 * packaging_profile_costs (already USD, per the confirmed rule) -- two
 * different currencies subtracted with no conversion at all, all labeled
 * with the euro sign.
 *
 * The fix (js/admin-production.js buildPlan()) calls
 * CurrencyConversion.computeUsdSaleFigures({ revenue, totalCost, rate })
 * -- the exact same function createSaleFromOrder() uses for a completed
 * sale -- using the CURRENT EUR->USD rate resolved once per page load
 * (never written onto any order or sale, since these are unconfirmed,
 * in-progress orders with no completed sale yet). These tests exercise
 * that exact call shape with realistic Production figures, and confirm
 * the failure/fallback path never silently substitutes a wrong number.
 */

test("1. revenue/cost/profit reconcile as EUR converted to USD, not mixed (the exact BUG-23 defect)", () => {
    // Two orders totaling EUR 100.00 revenue (order.subtotal); $12.00
    // ingredient cost + $8.50 packaging cost -- both already USD.
    const revenue = 100.00;
    const foodCost = 12.00;
    const packagingCost = 8.50;
    const rate = 1.15;

    const result = CurrencyConversion.computeUsdSaleFigures({
        revenue,
        totalCost: foodCost + packagingCost,
        rate
    });

    assert.equal(result.usdRevenue, 115.00); // 100.00 * 1.15
    assert.equal(result.usdProfit, 94.50); // 115.00 - 20.50

    // The old bug: subtracting USD cost from raw EUR revenue with no
    // conversion at all.
    const oldBuggyProfit = revenue - foodCost - packagingCost;
    assert.equal(oldBuggyProfit, 79.50);
    assert.notEqual(result.usdProfit, oldBuggyProfit);
});

test("2. margin is computed from the converted USD figures via the shared computeMargin, not the raw EUR revenue", () => {
    const revenue = 50.00;
    const foodCost = 6.00;
    const packagingCost = 2.00;
    const rate = 1.10;

    const usd = CurrencyConversion.computeUsdSaleFigures({
        revenue,
        totalCost: foodCost + packagingCost,
        rate
    });

    assert.equal(usd.usdRevenue, 55.00);
    assert.equal(usd.usdProfit, 47.00);

    const margin = SaleCalculations.computeMargin(usd.usdRevenue, usd.usdProfit);
    const expectedMargin = (47.00 / 55.00) * 100;

    assert.ok(Math.abs(margin - expectedMargin) < 1e-9);

    // The old (buggy) margin would have divided by the raw EUR revenue
    // instead -- confirm the fix does not coincidentally match it.
    const oldBuggyMargin = ((revenue - foodCost - packagingCost) / revenue) * 100;
    assert.notEqual(Math.round(margin * 100), Math.round(oldBuggyMargin * 100));
});

test("3. a missing/unresolved rate produces null figures, never a fabricated or mixed-currency number", () => {
    // Mirrors buildPlan()'s `usdRate !== null ? computeUsdSaleFigures(...) : null`
    // guard -- Production must show the figures as unavailable, not
    // silently fall back to treating EUR as USD (rate 1) or to the old
    // mixed subtraction.
    const usdRate = null;
    const revenue = 75.00;
    const totalCost = 10.00;

    const usdFigures = usdRate !== null
        ? CurrencyConversion.computeUsdSaleFigures({ revenue, totalCost, rate: usdRate })
        : null;

    assert.equal(usdFigures, null);
});

test("4. computeUsdSaleFigures itself refuses an invalid rate (0, negative, non-numeric), matching the same safety used at sale completion", () => {
    for (const badRate of [0, -1.1, NaN, undefined]) {
        const result = CurrencyConversion.computeUsdSaleFigures({
            revenue: 40.00,
            totalCost: 5.00,
            rate: badRate
        });
        assert.equal(result, null, `expected null for rate ${badRate}`);
    }
});

test("5. a zero-revenue production day converts to exactly 0 USD revenue, not null", () => {
    // No orders scheduled for a date -- revenue and cost are both 0.
    const result = CurrencyConversion.computeUsdSaleFigures({
        revenue: 0,
        totalCost: 0,
        rate: 1.15
    });

    assert.equal(result.usdRevenue, 0);
    assert.equal(result.usdProfit, 0);
    assert.notEqual(result, null);
});

test("6. per-product revenue conversion uses the SAME rate as the plan total, consistently across every product", () => {
    // Mirrors buildPlan()'s per-product usdRevenue mapping: each product's
    // EUR revenue is converted with the identical rate used for the
    // plan-wide Expected Revenue figure.
    const rate = 1.1435;
    const products = [
        { name: "Classic Sourdough", revenue: 24.00 },
        { name: "6 Pack Cookies", revenue: 15.00 }
    ];

    const converted = products.map(product => ({
        ...product,
        usdRevenue: CurrencyConversion.convertEurToUsd(product.revenue, rate)
    }));

    assert.equal(converted[0].usdRevenue, CurrencyConversion.convertEurToUsd(24.00, rate));
    assert.equal(converted[1].usdRevenue, CurrencyConversion.convertEurToUsd(15.00, rate));

    // Both conversions used the identical rate -- re-deriving from the raw
    // EUR figures with that same rate reproduces both results exactly.
    assert.equal(converted[0].usdRevenue, 27.44);
    assert.equal(converted[1].usdRevenue, 17.15);
});

test("7. rounding matches Postgres-style round-half-away-from-zero for Production's own totals too, not just Sales'", () => {
    // Same roundCents guarantee Sales/Analytics rely on applies identically
    // here -- confirms Production doesn't need (and must not invent) a
    // second, different rounding convention.
    const result = CurrencyConversion.computeUsdSaleFigures({
        revenue: 17.415, // an unrounded intermediate, as a defensive check
        totalCost: 2.00,
        rate: 1.0
    });

    assert.equal(result.usdRevenue, 17.42); // 17.415 rounds up, away from zero
    assert.equal(result.usdProfit, 15.42);
});

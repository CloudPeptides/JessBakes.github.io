/* ==========================================
   TESTS — js/sale-calculations.js

   Run with: node --test tests/
   (Node's built-in test runner — no external dependencies.)
   ========================================== */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    buildReferenceData,
    buildSaleFromOrder,
    summarizeLines,
    computeMargin,
    computeSaleFromOrder
} = require("../js/sale-calculations.js");

/* ==========================================
   FIXTURES
   ========================================== */

const menuItems = [
    // Standard products
    { id: "boule-1", name: "Classic Boule", recipe_id: 1, packaging_profile_id: 2, recipe_units_used: 1, product_type: "standard" },
    { id: "cookie-1", name: "Brown Butter Cookie", recipe_id: 2, packaging_profile_id: 3, recipe_units_used: 1, product_type: "standard" },
    { id: "cookie-2", name: "Peanut Butter Cookie", recipe_id: 3, packaging_profile_id: 3, recipe_units_used: 1, product_type: "standard" },

    // Builder (Mix & Match) box — its own row, resolvable via builder_group
    { id: "box-6", name: "6 Mix & Match Cookies", recipe_id: null, packaging_profile_id: 4, product_type: "builder", builder_group: "cookie-box" },
    { id: "box-12", name: "12 Mix & Match Cookies", recipe_id: null, packaging_profile_id: 5, product_type: "builder", builder_group: "cookie-box" }
];

const recipeCosts = [
    { id: 1, cost_per_yield_item: 3.50 },
    { id: 2, cost_per_yield_item: 0.40 },
    { id: 3, cost_per_yield_item: 0.55 }
];

const packagingCosts = [
    { id: 2, packaging_cost: 0.34 },
    { id: 3, packaging_cost: 0.22 },
    { id: 4, packaging_cost: 0.34 },
    { id: 5, packaging_cost: 1.79 }
];

const referenceData = buildReferenceData(menuItems, recipeCosts, packagingCosts);

function standardOrderItem(overrides) {
    return Object.assign({
        menu_item_id: "boule-1",
        item_name: "Classic Boule",
        quantity: 1,
        price_at_purchase: 10,
        line_total: 10,
        builder_details: null
    }, overrides);
}

function builderOrderItem(overrides) {
    return Object.assign({
        menu_item_id: null,
        item_name: "6 Mix & Match Cookies",
        quantity: 1,
        price_at_purchase: 15,
        line_total: 15,
        builder_details: {
            builder_group: "cookie-box",
            selections: [
                { id: "cookie-1", name: "Brown Butter Cookie", quantity: 3 },
                { id: "cookie-2", name: "Peanut Butter Cookie", quantity: 3 }
            ]
        }
    }, overrides);
}

/* ==========================================
   1. Standard single-product order
   ========================================== */

test("1. standard single-product order — cost and profit computed normally", () => {
    const lines = buildSaleFromOrder([standardOrderItem()], referenceData);

    assert.equal(lines.length, 1);
    assert.equal(lines[0].source, "standard");
    assert.equal(lines[0].line_revenue, 10);

    // food cost 3.50 + packaging 0.34 = 3.84 per unit, qty 1
    assert.equal(lines[0].food_cost, 3.50);
    assert.equal(lines[0].packaging_cost, 0.34);
    assert.equal(lines[0].total_cost, 3.84);
    assert.equal(lines[0].line_profit, 10 - 3.84);

    const totals = summarizeLines(lines);
    assert.equal(totals.revenue, 10);
    assert.equal(Math.round(totals.totalCost * 100) / 100, 3.84);
    assert.equal(Math.round(totals.profit * 100) / 100, 6.16);
});

/* ==========================================
   2. A Mix & Match box by itself
   ========================================== */

test("2. Mix & Match box by itself — parent owns full revenue, children own cost/quantity", () => {
    const lines = buildSaleFromOrder([builderOrderItem()], referenceData);

    // 1 parent + 2 children
    assert.equal(lines.length, 3);

    const parent = lines.find(l => l.source === "builder-parent");
    const children = lines.filter(l => l.source === "builder-child");

    assert.ok(parent, "parent line must exist");
    assert.equal(parent.line_revenue, 15);
    assert.equal(parent.food_cost, 0);
    assert.equal(parent.packaging_cost, 0);
    assert.equal(parent.menu_item_id, "box-6", "parent should resolve its own menu_items row via item_name");

    assert.equal(children.length, 2);
    children.forEach(child => {
        assert.equal(child.line_revenue, 0, "children must never carry revenue");
        assert.equal(child.quantity, 3);
    });

    const totals = summarizeLines(lines);
    assert.equal(totals.revenue, 15, "box price counted exactly once");
});

/* ==========================================
   3. Standard products + a Mix & Match box in the same order
   ========================================== */

test("3. order with standard products and a Mix & Match box", () => {
    const orderItems = [standardOrderItem(), builderOrderItem()];
    const lines = buildSaleFromOrder(orderItems, referenceData);
    const totals = summarizeLines(lines);

    assert.equal(totals.revenue, 10 + 15);
    assert.equal(lines.filter(l => l.source === "standard").length, 1);
    assert.equal(lines.filter(l => l.source === "builder-parent").length, 1);
    assert.equal(lines.filter(l => l.source === "builder-child").length, 2);
});

/* ==========================================
   4. Multiple Mix & Match boxes
   ========================================== */

test("4. multiple Mix & Match boxes in one order — each gets its own parent line", () => {
    const box6 = builderOrderItem({ item_name: "6 Mix & Match Cookies", price_at_purchase: 15, line_total: 15 });
    const box12 = builderOrderItem({
        item_name: "12 Mix & Match Cookies",
        price_at_purchase: 28,
        line_total: 28,
        builder_details: {
            builder_group: "cookie-box",
            selections: [
                { id: "cookie-1", name: "Brown Butter Cookie", quantity: 6 },
                { id: "cookie-2", name: "Peanut Butter Cookie", quantity: 6 }
            ]
        }
    });

    const lines = buildSaleFromOrder([box6, box12], referenceData);
    const parents = lines.filter(l => l.source === "builder-parent");

    assert.equal(parents.length, 2, "two boxes must produce two parent lines");
    assert.equal(parents[0].line_revenue, 15);
    assert.equal(parents[1].line_revenue, 28);

    const totals = summarizeLines(lines);
    assert.equal(totals.revenue, 15 + 28, "revenue must equal the sum of both boxes, not one, not quadrupled");
});

/* ==========================================
   5. Box selections with different production costs
   ========================================== */

test("5. box selections with different production costs are each costed correctly", () => {
    const lines = buildSaleFromOrder([builderOrderItem()], referenceData);
    const children = lines.filter(l => l.source === "builder-child");

    const cookie1 = children.find(l => l.menu_item_id === "cookie-1");
    const cookie2 = children.find(l => l.menu_item_id === "cookie-2");

    // cookie-1: recipe 0.40 + packaging 0.22 = 0.62/unit
    assert.equal(cookie1.total_cost, 0.62);
    // cookie-2: recipe 0.55 + packaging 0.22 = 0.77/unit
    assert.equal(cookie2.total_cost, 0.77);
    assert.notEqual(cookie1.total_cost, cookie2.total_cost, "different products must keep their own distinct costs");
});

/* ==========================================
   6. Missing or malformed selection data
   ========================================== */

test("6. missing or malformed selection data is skipped, never throws, revenue preserved", () => {
    const malformed = builderOrderItem({
        builder_details: {
            builder_group: "cookie-box",
            selections: [
                { id: "cookie-1", name: "Brown Butter Cookie", quantity: 3 }, // valid
                { id: null, name: "No ID", quantity: 2 },                     // missing id
                { id: "does-not-exist", name: "Unknown", quantity: 1 },       // unresolvable id
                { id: "cookie-2", name: "Zero qty", quantity: 0 },            // non-positive quantity
                { id: "cookie-2", name: "Negative qty", quantity: -5 },       // negative quantity
                null,                                                        // null entry entirely
                undefined                                                    // undefined entry entirely
            ]
        }
    });

    assert.doesNotThrow(() => buildSaleFromOrder([malformed], referenceData));

    const lines = buildSaleFromOrder([malformed], referenceData);
    const parent = lines.find(l => l.source === "builder-parent");
    const children = lines.filter(l => l.source === "builder-child");

    assert.equal(parent.line_revenue, 15, "malformed sibling selections must not affect the parent's revenue");
    assert.equal(children.length, 1, "only the one valid selection should produce a child line");
    assert.equal(children[0].menu_item_id, "cookie-1");

    // Also: an order item with builder_details present but selections
    // missing/empty must not throw and must fall back to a standard-style
    // single line rather than silently dropping the revenue.
    const emptySelections = builderOrderItem({ builder_details: { builder_group: "cookie-box", selections: [] } });
    assert.doesNotThrow(() => buildSaleFromOrder([emptySelections], referenceData));
    const emptyLines = buildSaleFromOrder([emptySelections], referenceData);
    assert.equal(emptyLines.length, 1);
    assert.equal(emptyLines[0].line_revenue, 15);

    const noBuilderDetailsField = builderOrderItem({ builder_details: undefined });
    assert.doesNotThrow(() => buildSaleFromOrder([noBuilderDetailsField], referenceData));
});

/* ==========================================
   7. Zero revenue without division-by-zero or NaN
   ========================================== */

test("7. zero revenue never produces NaN or Infinity", () => {
    assert.equal(computeMargin(0, 0), 0);
    assert.equal(computeMargin(0, -5), 0);
    assert.equal(Number.isFinite(computeMargin(0, 0)), true);

    const totals = summarizeLines([]);
    assert.equal(totals.revenue, 0);
    assert.equal(totals.profit, 0);
    assert.equal(totals.margin, 0);
    assert.equal(Number.isNaN(totals.margin), false);

    // A real line with zero revenue (e.g. a fully-malformed builder line)
    const zeroRevenueLines = buildSaleFromOrder(
        [builderOrderItem({ builder_details: { builder_group: "cookie-box", selections: [{ id: "does-not-exist", quantity: 1 }] } })],
        referenceData
    );
    const zeroTotals = summarizeLines(zeroRevenueLines);
    assert.equal(Number.isNaN(zeroTotals.margin), false);
});

/* ==========================================
   8. Revenue counted once, never once per selected child
   ========================================== */

test("8. revenue is counted exactly once per box, never once per child selection", () => {
    // A box with 5 distinct selections — a naive per-line-item summation
    // bug would multiply revenue by 5 if it were accidentally attached to
    // every child instead of the parent.
    const manySelections = builderOrderItem({
        price_at_purchase: 20,
        line_total: 20,
        builder_details: {
            builder_group: "cookie-box",
            selections: [
                { id: "cookie-1", quantity: 1 },
                { id: "cookie-2", quantity: 1 },
                { id: "cookie-1", quantity: 1 },
                { id: "cookie-2", quantity: 1 },
                { id: "cookie-1", quantity: 1 }
            ]
        }
    });

    const lines = buildSaleFromOrder([manySelections], referenceData);
    const totals = summarizeLines(lines);

    assert.equal(totals.revenue, 20, "5 selections must not turn into 5x or 6x revenue");

    const revenueBearingLines = lines.filter(l => l.line_revenue > 0);
    assert.equal(revenueBearingLines.length, 1, "exactly one line may carry revenue for this box");
});

/* ==========================================
   9. Child quantities remain available for product-level analytics
   ========================================== */

test("9. child quantities and identities remain available for per-product analytics", () => {
    const lines = buildSaleFromOrder([builderOrderItem()], referenceData);
    const children = lines.filter(l => l.source === "builder-child");

    // Each child line must still carry enough to attribute quantity sold
    // to the real product, even though it carries no revenue.
    children.forEach(child => {
        assert.ok(child.menu_item_id, "child must retain a real menu_item_id");
        assert.ok(child.item_name, "child must retain a real item_name");
        assert.ok(child.quantity > 0, "child must retain a positive quantity");
    });

    const totalChildUnits = children.reduce((sum, c) => sum + c.quantity, 0);
    assert.equal(totalChildUnits, 6, "3 + 3 selected cookies must both still be counted");
});

/* ==========================================
   Ambiguity discovered against live data: multiple builder products can
   share one builder_group (confirmed in the live database — see the
   regression report), so parent resolution must key on item_name, not
   builder_group.
   ========================================== */

test("resolves the correct box among multiple boxes that share one builder_group", () => {
    const box6 = builderOrderItem({ item_name: "6 Mix & Match Cookies", price_at_purchase: 15, line_total: 15 });
    const box12 = builderOrderItem({ item_name: "12 Mix & Match Cookies", price_at_purchase: 28, line_total: 28 });

    const lines6 = buildSaleFromOrder([box6], referenceData);
    const lines12 = buildSaleFromOrder([box12], referenceData);

    assert.equal(lines6.find(l => l.source === "builder-parent").menu_item_id, "box-6");
    assert.equal(lines12.find(l => l.source === "builder-parent").menu_item_id, "box-12");
});

/* ==========================================
   10. Sales and Analytics produce identical totals from the same input
   ========================================== */

test("10. Sales-style and Analytics-style aggregation agree exactly", () => {
    const orderItems = [
        standardOrderItem({ menu_item_id: "boule-1", quantity: 2, price_at_purchase: 10, line_total: 20 }),
        builderOrderItem()
    ];

    const { lines, totals } = computeSaleFromOrder(orderItems, menuItems, recipeCosts, packagingCosts);

    // "Sales-style": read the single aggregate the way admin-sales.js reads
    // the `sales` table's own stored columns.
    const salesStyleRevenue = totals.revenue;
    const salesStyleProfit = totals.profit;
    const salesStyleMargin = computeMargin(salesStyleRevenue, salesStyleProfit);

    // "Analytics-style": independently re-sum the individual sale_items
    // rows the way admin-analytics.js's per-product breakdown does.
    const analyticsStyleRevenue = lines.reduce((sum, l) => sum + l.line_revenue, 0);
    const analyticsStyleCost = lines.reduce((sum, l) => sum + l.total_cost * l.quantity, 0);
    const analyticsStyleProfit = analyticsStyleRevenue - analyticsStyleCost;
    const analyticsStyleMargin = computeMargin(analyticsStyleRevenue, analyticsStyleProfit);

    assert.equal(salesStyleRevenue, analyticsStyleRevenue);
    assert.equal(Math.round(salesStyleProfit * 1e8) / 1e8, Math.round(analyticsStyleProfit * 1e8) / 1e8);
    assert.equal(salesStyleMargin, analyticsStyleMargin);
});

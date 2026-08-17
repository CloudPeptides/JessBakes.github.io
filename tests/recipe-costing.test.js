"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const RecipeCosting = require("../js/recipe-costing.js");

// Mirrors the real recipe_costs view rows for the four live recipes that
// use a shared "Cream Cheese Frosting" component, per
// docs/bakery-rebuild/02-calculation-audit.md §2 (BUG-04).
const RECIPE_COST_ROWS = [
    { id: 1, name: "Cinnamon Rolls", ingredient_cost: 7.70, cost_per_yield_item: 0.64 },
    { id: 2, name: "Blueberry Rolls", ingredient_cost: 7.26, cost_per_yield_item: 0.61 },
    { id: 3, name: "Plain Bagels", ingredient_cost: 4.10, cost_per_yield_item: 0.34 }
];

test("1. buildRecipeCostsById keys every row by String(id)", () => {
    const map = RecipeCosting.buildRecipeCostsById(RECIPE_COST_ROWS);

    assert.equal(map.size, 3);
    assert.equal(map.get("1").name, "Cinnamon Rolls");
    assert.equal(map.get("2").ingredient_cost, 7.26);
});

test("2. resolveRecipeCost returns the view's whole-batch ingredient_cost, including sub-recipe components (BUG-04 fix)", () => {
    const map = RecipeCosting.buildRecipeCostsById(RECIPE_COST_ROWS);

    // This is the exact regression case from the audit: the recipe's real,
    // DB-correct cost (including its Cream Cheese Frosting sub-recipe) is
    // $7.70, not the $4.26 the old client-side, sub-recipe-blind
    // implementation would have shown.
    const cost = RecipeCosting.resolveRecipeCost(map, { id: 1 });
    assert.equal(cost, 7.70);
    assert.notEqual(cost, 4.26);
});

test("3. resolveRecipeCost works with numeric or string recipe ids interchangeably (BUG-03)", () => {
    const map = RecipeCosting.buildRecipeCostsById(RECIPE_COST_ROWS);

    assert.equal(RecipeCosting.resolveRecipeCost(map, { id: 2 }), 7.26);
    assert.equal(RecipeCosting.resolveRecipeCost(map, { id: "2" }), 7.26);
});

test("4. resolveRecipeCost returns 0, not an error, for a recipe with no matching view row", () => {
    const map = RecipeCosting.buildRecipeCostsById(RECIPE_COST_ROWS);

    assert.equal(RecipeCosting.resolveRecipeCost(map, { id: 999 }), 0);
});

test("5. resolveRecipeCost returns 0 for a null/undefined recipe rather than throwing", () => {
    const map = RecipeCosting.buildRecipeCostsById(RECIPE_COST_ROWS);

    assert.equal(RecipeCosting.resolveRecipeCost(map, null), 0);
    assert.equal(RecipeCosting.resolveRecipeCost(map, undefined), 0);
});

test("6. buildRecipeCostsById never throws on an empty or missing row list", () => {
    assert.equal(RecipeCosting.buildRecipeCostsById([]).size, 0);
    assert.equal(RecipeCosting.buildRecipeCostsById(null).size, 0);
    assert.equal(RecipeCosting.buildRecipeCostsById(undefined).size, 0);
});

test("7. a recipe with no ingredients (ingredient_cost null/0 in the view) resolves to 0, not NaN", () => {
    const map = RecipeCosting.buildRecipeCostsById([
        { id: 4, name: "Empty Draft Recipe", ingredient_cost: null, cost_per_yield_item: null }
    ]);

    const cost = RecipeCosting.resolveRecipeCost(map, { id: 4 });
    assert.equal(cost, 0);
    assert.equal(Number.isNaN(cost), false);
});

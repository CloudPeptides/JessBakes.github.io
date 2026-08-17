/* ==========================================
   RECIPE COSTING (shared, pure)
   ==========================================

   Single source of truth for turning the `recipe_costs` Postgres view's
   rows into a lookup and reading a recipe's cost from it.

   -------------------------------------------------------------------------
   BUG-04 / BUG-05 fix
   -------------------------------------------------------------------------
   The Inventory tab used to compute a recipe's cost itself, client-side —
   summing only recipe_ingredients (silently ignoring sub-recipe
   recipe_components, BUG-04) using a unit converter that only understood
   mass, not volume or count (BUG-05). That duplicate implementation
   understated every recipe that uses a shared component by 29-47% on live
   data.

   `recipe_costs` is a Postgres view that already does this correctly and
   recursively (with cycle protection) and already converts mass, volume,
   and count units — it's the same source Menu and sale creation
   (js/admin-orders.js, via js/sale-calculations.js) already rely on. This
   module just standardizes reading it, so the Inventory tab, Menu, and any
   future page all agree by construction instead of maintaining separate
   client-side copies that have to be kept in sync by hand.

   Used by js/admin-inventory.js and covered by tests/recipe-costing.test.js
   (Node's built-in test runner, no dependencies). No dependency on the DOM
   or Supabase — runs unmodified in the browser (as a normal <script> tag,
   exposing `window.RecipeCosting`) or under Node.
   ========================================== */

(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.RecipeCosting = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    /**
     * Builds a lookup from the plain array Supabase returns for
     * `select * from recipe_costs`, keyed with a consistent String()
     * coercion on the id (BUG-03: recipes.id/recipe_costs.id are bigint,
     * but coercing consistently here avoids this ever becoming a real bug
     * the way inconsistent casting elsewhere in this codebase did).
     */
    function buildRecipeCostsById(recipeCostRows) {
        return new Map(
            (recipeCostRows || []).map(row => [String(row.id), row])
        );
    }

    /**
     * Resolves a recipe's total ingredient cost (recipe_costs.ingredient_cost
     * — the whole-batch figure, including any sub-recipe components,
     * matching what the Inventory tab has always displayed) from a lookup
     * built by buildRecipeCostsById. Returns 0 for a recipe with no
     * matching row (e.g. one with no ingredients yet) rather than throwing.
     */
    function resolveRecipeCost(recipeCostsById, recipe) {
        if (!recipe) return 0;

        const row = recipeCostsById instanceof Map
            ? recipeCostsById.get(String(recipe.id))
            : (recipeCostsById || {})[String(recipe.id)];

        return row ? Number(row.ingredient_cost || 0) : 0;
    }

    return {
        buildRecipeCostsById,
        resolveRecipeCost
    };
});

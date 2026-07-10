document.addEventListener("DOMContentLoaded", async () => {

    await requireAuth();

});

/*==================================================
    INVENTORY
==================================================*/

let ingredients = [];
let categories = [];
let suppliers = [];
let recipes = [];


/*==================================================
    PAGE INITIALIZATION
==================================================*/

document.addEventListener("DOMContentLoaded", async () => {
    await requireAuth();

    setupLogout();

    buildInventoryModals();

    await loadInventory();
});


/*==================================================
    DATA LOADING
==================================================*/

async function loadInventory() {
    await Promise.all([
        loadCategories(),
        loadSuppliers(),
        loadIngredients(),
        loadRecipes()
    ]);

    updateInventoryOverview();
    renderLowStockAlerts();
    renderIngredients();
    renderRecipes();
    renderRecipeCosting();
    renderShoppingList();
    renderSuppliers();
}

async function loadCategories() {
    const { data, error } = await supabaseClient
        .from("inventory_categories")
        .select("*")
        .order("sort_order", { ascending: true });

    if (error) {
        console.error(error);
        categories = [];
        return;
    }

    categories = data || [];
}

async function loadSuppliers() {
    const { data, error } = await supabaseClient
        .from("suppliers")
        .select("*")
        .order("name", { ascending: true });

    if (error) {
        console.error(error);
        suppliers = [];
        return;
    }

    suppliers = data || [];
}

async function loadIngredients() {

    const { data, error } = await supabaseClient
        .from("ingredients")
        .select("*")
        .order("name");

    console.log("DATA:", data);
    console.log("ERROR:", error);

    if (error) {
        console.error(error);
        return;
    }

    ingredients = data || [];

    renderIngredients();
}

async function loadRecipes() {
    const { data, error } = await supabaseClient
        .from("recipes")
        .select(`
            *,
            recipe_ingredients(
                *,
                ingredients(*)
            )
        `)
        .order("name", { ascending: true });

    if (error) {
        console.error(error);
        recipes = [];
        return;
    }

    recipes = data || [];
}


/*==================================================
    OVERVIEW
==================================================*/

function updateInventoryOverview() {
    const lowStock = ingredients.filter(isLowStock);

    const inventoryValue = ingredients.reduce((sum, ingredient) => {
        const value =
            Number(ingredient.quantity_on_hand || 0) /
            Number(ingredient.purchase_size || 1) *
            Number(ingredient.purchase_price || 0);

        return sum + value;
    }, 0);

    setText("ingredientCount", ingredients.length);
    setText("lowStockCount", lowStock.length);
    setText("inventoryValue", usd(inventoryValue));
    setText("recipeCount", recipes.length);
}


/*==================================================
    PANTRY RENDERING
==================================================*/

function renderLowStockAlerts() {
    const container = document.getElementById("lowStockAlerts");

    if (!container) return;

    const lowStock = ingredients.filter(isLowStock);

    if (!lowStock.length) {
        container.innerHTML = "<p>Everything is stocked.</p>";
        return;
    }

    container.innerHTML = lowStock.map(ingredient => `
        <div class="inventory-alert-row">
            <div>
                <strong>${escapeHtml(ingredient.name)}</strong>
                <small>
                    ${formatQuantity(ingredient.quantity_on_hand)}
                    ${escapeHtml(ingredient.purchase_unit)}
                    remaining
                </small>
            </div>

            <span>
                Minimum:
                ${formatQuantity(ingredient.minimum_quantity)}
                ${escapeHtml(ingredient.purchase_unit)}
            </span>
        </div>
    `).join("");
}

function renderIngredients() {
    const container = document.getElementById("ingredientsTable");

    if (!container) return;

    const search =
        document.getElementById("inventorySearch")?.value
            .toLowerCase()
            .trim() || "";

    const filtered = ingredients.filter(ingredient => {
        return ingredient.name.toLowerCase().includes(search);
    });

    if (!filtered.length) {
        container.innerHTML = "<p>No ingredients found.</p>";
        return;
    }

    container.innerHTML = `
        <div class="inventory-list">
            ${filtered.map(renderIngredientCard).join("")}
        </div>
    `;
}

function renderIngredientCard(ingredient) {
    return `
        <article class="inventory-card ${isLowStock(ingredient) ? "is-low-stock" : ""}">
            <div>
                <h3>${escapeHtml(ingredient.name)}</h3>

                <p>
                    ${formatQuantity(ingredient.quantity_on_hand)}
                    ${escapeHtml(ingredient.purchase_unit)}
                    on hand
                </p>

                <small>
                    ${escapeHtml(categories.find(c => c.id === ingredient.category_id)?.name || "Uncategorized")}
                    ${
                        suppliers.find(s => s.id === ingredient.supplier_id)?.name
                            ? ` • ${escapeHtml(ingredient.suppliers.name)}`
                            : ""
                    }
                </small>
            </div>

            <div>
                <strong>
                    ${usd(ingredient.purchase_price)}
                    /
                    ${formatQuantity(ingredient.purchase_size)}
                    ${escapeHtml(ingredient.purchase_unit)}
                </strong>

                <small>
                    Minimum:
                    ${formatQuantity(ingredient.minimum_quantity)}
                    ${escapeHtml(ingredient.purchase_unit)}
                </small>
            </div>

            <div class="inventory-actions">
                <button class="primary-btn" onclick="openRestockModal('${ingredient.id}')">
                    + Stock
                </button>

                <button class="edit-option-btn" onclick="openIngredientModal('${ingredient.id}')">
                    Edit
                </button>

                <button class="delete-btn" onclick="deleteIngredient('${ingredient.id}', '${escapeJs(ingredient.name)}')">
                    Delete
                </button>
            </div>
        </article>
    `;
}


/*==================================================
    INGREDIENT MODAL
==================================================*/

function buildInventoryModals() {
    if (!document.getElementById("ingredientModal")) {
        document.body.appendChild(buildIngredientModal());
    }

    if (!document.getElementById("restockModal")) {
        document.body.appendChild(buildRestockModal());
    }

    if (!document.getElementById("recipeModal")) {
        document.body.appendChild(buildRecipeModal());
    }
}

function buildIngredientModal() {
    const modal = document.createElement("div");

    modal.id = "ingredientModal";
    modal.className = "modal-overlay";
    modal.style.display = "none";

    modal.innerHTML = `
        <div class="modal-card">
            <div class="modal-header">
                <h2 id="ingredientModalTitle">Add Ingredient</h2>

                <button class="modal-close" onclick="closeIngredientModal()">
                    ✕
                </button>
            </div>

            <div class="modal-body">
                <input type="hidden" id="ingredientId">

                <label>Name</label>
                <input id="ingredientName" type="text">

                <label>Category</label>
                <select id="ingredientCategory"></select>

                <label>Supplier</label>
                <select id="ingredientSupplier"></select>

                <label>Purchase Unit</label>
                <input id="purchaseUnit" type="text" placeholder="lb, oz, each">

                <label>Recipe Unit</label>
                <input id="recipeUnit" type="text" placeholder="g, each">

                <label>Purchase Size</label>
                <input id="purchaseSize" type="number" step="0.01">

                <label>Purchase Price $</label>
                <input id="purchasePrice" type="number" step="0.01">

                <label>Quantity On Hand</label>
                <input id="quantityOnHand" type="number" step="0.01">

                <label>Minimum Quantity</label>
                <input id="minimumQuantity" type="number" step="0.01">

                <label>Notes</label>
                <textarea id="ingredientNotes" rows="3"></textarea>
            </div>

            <div class="modal-footer">
                <button class="secondary-btn" onclick="closeIngredientModal()">
                    Cancel
                </button>

                <button class="primary-btn" onclick="saveIngredient()">
                    Save Ingredient
                </button>
            </div>
        </div>
    `;

    return modal;
}

function openIngredientModal(id = null) {
    populateIngredientSelects();

    const ingredient = id
        ? ingredients.find(item => String(item.id) === String(id))
        : null;

    document.getElementById("ingredientModalTitle").textContent =
        ingredient ? "Edit Ingredient" : "Add Ingredient";

    document.getElementById("ingredientId").value =
        ingredient ? ingredient.id : "";

    document.getElementById("ingredientName").value =
        ingredient ? ingredient.name : "";

    document.getElementById("ingredientCategory").value =
        ingredient ? ingredient.category_id || "" : "";

    document.getElementById("ingredientSupplier").value =
        ingredient ? ingredient.supplier_id || "" : "";

    document.getElementById("purchaseUnit").value =
        ingredient ? ingredient.purchase_unit : "";

    document.getElementById("recipeUnit").value =
        ingredient ? ingredient.recipe_unit : "";

    document.getElementById("purchaseSize").value =
        ingredient ? ingredient.purchase_size : "";

    document.getElementById("purchasePrice").value =
        ingredient ? ingredient.purchase_price : "";

    document.getElementById("quantityOnHand").value =
        ingredient ? ingredient.quantity_on_hand : "";

    document.getElementById("minimumQuantity").value =
        ingredient ? ingredient.minimum_quantity : "";

    document.getElementById("ingredientNotes").value =
        ingredient ? ingredient.notes || "" : "";

    document.getElementById("ingredientModal").style.display = "flex";
}

function closeIngredientModal() {
    document.getElementById("ingredientModal").style.display = "none";
}

function populateIngredientSelects() {
    const categorySelect = document.getElementById("ingredientCategory");
    const supplierSelect = document.getElementById("ingredientSupplier");

    categorySelect.innerHTML = `
        <option value="">Uncategorized</option>
        ${categories.map(category => `
            <option value="${category.id}">
                ${escapeHtml(category.name)}
            </option>
        `).join("")}
    `;

    supplierSelect.innerHTML = `
        <option value="">No supplier</option>
        ${suppliers.map(supplier => `
            <option value="${supplier.id}">
                ${escapeHtml(supplier.name)}
            </option>
        `).join("")}
    `;
}

async function saveIngredient() {
    const id = document.getElementById("ingredientId").value;

    const payload = {
        name: document.getElementById("ingredientName").value.trim(),
        category_id: valueOrNull(document.getElementById("ingredientCategory").value),
        supplier_id: valueOrNull(document.getElementById("ingredientSupplier").value),
        purchase_unit: document.getElementById("purchaseUnit").value.trim(),
        recipe_unit: document.getElementById("recipeUnit").value.trim(),
        purchase_size: Number(document.getElementById("purchaseSize").value),
        purchase_price: Number(document.getElementById("purchasePrice").value),
        quantity_on_hand: Number(document.getElementById("quantityOnHand").value || 0),
        minimum_quantity: Number(document.getElementById("minimumQuantity").value || 0),
        notes: document.getElementById("ingredientNotes").value.trim()
    };

    if (!payload.name) {
        alert("Please enter an ingredient name.");
        return;
    }

    if (!payload.purchase_unit || !payload.recipe_unit) {
        alert("Please enter purchase and recipe units.");
        return;
    }

    const query = id
        ? supabaseClient.from("ingredients").update(payload).eq("id", id)
        : supabaseClient.from("ingredients").insert(payload);

    const { error } = await query;

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    closeIngredientModal();
    await loadInventory();
}

async function deleteIngredient(id, name) {
    if (!confirm(`Delete "${name}" from inventory?`)) return;

    const { error } = await supabaseClient
        .from("ingredients")
        .delete()
        .eq("id", id);

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    await loadInventory();
}


/*==================================================
    RESTOCK
==================================================*/

function buildRestockModal() {
    const modal = document.createElement("div");

    modal.id = "restockModal";
    modal.className = "modal-overlay";
    modal.style.display = "none";

    modal.innerHTML = `
        <div class="modal-card">
            <div class="modal-header">
                <h2>Restock Ingredient</h2>

                <button class="modal-close" onclick="closeRestockModal()">
                    ✕
                </button>
            </div>

            <div class="modal-body">
                <input type="hidden" id="restockIngredientId">

                <p id="restockIngredientName"></p>

                <label>Quantity Added</label>
                <input id="restockQuantity" type="number" step="0.01">

                <label>Total Cost $</label>
                <input id="restockCost" type="number" step="0.01">

                <label>Supplier</label>
                <select id="restockSupplier"></select>

                <label>Notes</label>
                <textarea id="restockNotes" rows="3"></textarea>
            </div>

            <div class="modal-footer">
                <button class="secondary-btn" onclick="closeRestockModal()">
                    Cancel
                </button>

                <button class="primary-btn" onclick="saveRestock()">
                    Save Restock
                </button>
            </div>
        </div>
    `;

    return modal;
}

function openRestockModal(id) {
    const ingredient = ingredients.find(item => String(item.id) === String(id));

    if (!ingredient) return;

    document.getElementById("restockIngredientId").value = ingredient.id;
    document.getElementById("restockIngredientName").textContent =
        `${ingredient.name} (${ingredient.purchase_unit})`;

    document.getElementById("restockQuantity").value = "";
    document.getElementById("restockCost").value = "";
    document.getElementById("restockNotes").value = "";

    const supplierSelect = document.getElementById("restockSupplier");

    supplierSelect.innerHTML = `
        <option value="">No supplier</option>
        ${suppliers.map(supplier => `
            <option value="${supplier.id}">
                ${escapeHtml(supplier.name)}
            </option>
        `).join("")}
    `;

    supplierSelect.value = ingredient.supplier_id || "";

    document.getElementById("restockModal").style.display = "flex";
}

function closeRestockModal() {
    document.getElementById("restockModal").style.display = "none";
}

async function saveRestock() {
    const id = document.getElementById("restockIngredientId").value;
    const quantity = Number(document.getElementById("restockQuantity").value);
    const totalCost = Number(document.getElementById("restockCost").value);
    const supplierId = valueOrNull(document.getElementById("restockSupplier").value);
    const notes = document.getElementById("restockNotes").value.trim();

    const ingredient = ingredients.find(item => String(item.id) === String(id));

    if (!ingredient) return;

    if (!quantity || quantity <= 0) {
        alert("Please enter the quantity added.");
        return;
    }

    if (!totalCost || totalCost < 0) {
        alert("Please enter the total cost.");
        return;
    }

    const newQuantity =
        Number(ingredient.quantity_on_hand || 0) + quantity;

    const updatedPurchasePrice =
        totalCost / (quantity / Number(ingredient.purchase_size || 1));

    const { error: purchaseError } = await supabaseClient
        .from("purchases")
        .insert({
            ingredient_id: ingredient.id,
            supplier_id: supplierId,
            quantity,
            total_cost: totalCost,
            notes
        });

    if (purchaseError) {
        console.error(purchaseError);
        alert(purchaseError.message);
        return;
    }

    const { error: updateError } = await supabaseClient
        .from("ingredients")
        .update({
            quantity_on_hand: newQuantity,
            purchase_price: updatedPurchasePrice,
            supplier_id: supplierId || ingredient.supplier_id
        })
        .eq("id", ingredient.id);

    if (updateError) {
        console.error(updateError);
        alert(updateError.message);
        return;
    }

    closeRestockModal();
    await loadInventory();
}


/*==================================================
    RECIPES
==================================================*/

function renderRecipes() {
    const container = document.getElementById("recipesList");

    if (!container) return;

    if (!recipes.length) {
        container.innerHTML = "<p>No recipes yet.</p>";
        return;
    }

    container.innerHTML = recipes.map(recipe => `
        <article class="inventory-card">
            <div>
                <h3>${escapeHtml(recipe.name)}</h3>
                <p>${escapeHtml(recipe.category || "Recipe")}</p>
                <small>
                    Yield:
                    ${formatQuantity(recipe.yield_quantity)}
                    ${escapeHtml(recipe.yield_unit)}
                </small>
            </div>

            <div>
                <strong>${usd(getRecipeCost(recipe))}</strong>
                <small>Estimated ingredient cost</small>
            </div>

            <div class="inventory-actions">
                <button class="edit-option-btn" onclick="openRecipeModal('${recipe.id}')">
                    Edit
                </button>

                <button class="edit-option-btn" onclick="duplicateRecipe('${recipe.id}')">
                    Duplicate
                </button>

                <button class="delete-btn" onclick="deleteRecipe('${recipe.id}', '${escapeJs(recipe.name)}')">
                    Delete
                </button>
            </div>
        </article>
    `).join("");
}

function renderRecipeCosting() {
    const container = document.getElementById("recipeCosting");

    if (!container) return;

    if (!recipes.length) {
        container.innerHTML = "<p>No recipes yet.</p>";
        return;
    }

    container.innerHTML = recipes.map(recipe => `
        <div class="recipe-cost-row">
            <strong>${escapeHtml(recipe.name)}</strong>
            <span>${usd(getRecipeCost(recipe))}</span>
        </div>
    `).join("");
}

function buildRecipeModal() {
    const modal = document.createElement("div");

    modal.id = "recipeModal";
    modal.className = "modal-overlay";
    modal.style.display = "none";

    modal.innerHTML = `
        <div class="modal-card large-modal">
            <div class="modal-header">
                <h2 id="recipeModalTitle">Add Recipe</h2>

                <button class="modal-close" onclick="closeRecipeModal()">
                    ✕
                </button>
            </div>

            <div class="modal-body">
                <input type="hidden" id="recipeId">

                <label>Recipe Name</label>
                <input id="recipeName" type="text">

                <label>Category</label>
                <input id="recipeCategory" type="text" placeholder="Bread, Cookie, Dessert">

                <label>Yield Quantity</label>
                <input id="recipeYieldQuantity" type="number" step="0.01" value="1">

                <label>Yield Unit</label>
                <input id="recipeYieldUnit" type="text" value="item">

                <label>Notes</label>
                <textarea id="recipeNotes" rows="3"></textarea>

                <hr>

                <h3>Ingredients</h3>

                <div id="recipeIngredientRows"></div>

                <button class="secondary-btn" type="button" onclick="addRecipeIngredientRow()">
                    + Add Ingredient
                </button>
            </div>

            <div class="modal-footer">
                <button class="secondary-btn" onclick="closeRecipeModal()">
                    Cancel
                </button>

                <button class="primary-btn" onclick="saveRecipe()">
                    Save Recipe
                </button>
            </div>
        </div>
    `;

    return modal;
}

function openRecipeModal(id = null) {
    const recipe = id
        ? recipes.find(item => String(item.id) === String(id))
        : null;

    document.getElementById("recipeModalTitle").textContent =
        recipe ? "Edit Recipe" : "Add Recipe";

    document.getElementById("recipeId").value =
        recipe ? recipe.id : "";

    document.getElementById("recipeName").value =
        recipe ? recipe.name : "";

    document.getElementById("recipeCategory").value =
        recipe ? recipe.category || "" : "";

    document.getElementById("recipeYieldQuantity").value =
        recipe ? recipe.yield_quantity || 1 : 1;

    document.getElementById("recipeYieldUnit").value =
        recipe ? recipe.yield_unit || "item" : "item";

    document.getElementById("recipeNotes").value =
        recipe ? recipe.notes || "" : "";

    const rows = document.getElementById("recipeIngredientRows");
    rows.innerHTML = "";

    if (recipe?.recipe_ingredients?.length) {
        recipe.recipe_ingredients.forEach(item => {
            addRecipeIngredientRow(item.ingredient_id, item.quantity);
        });
    } else {
        addRecipeIngredientRow();
    }

    document.getElementById("recipeModal").style.display = "flex";
}

function closeRecipeModal() {
    document.getElementById("recipeModal").style.display = "none";
}

function addRecipeIngredientRow(ingredientId = "", quantity = "") {
    const container = document.getElementById("recipeIngredientRows");

    const row = document.createElement("div");

    row.className = "recipe-ingredient-row";

    row.innerHTML = `
        <select class="recipeIngredientSelect">
            <option value="">Choose Ingredient</option>
            ${ingredients.map(ingredient => `
                <option value="${ingredient.id}">
                    ${escapeHtml(ingredient.name)}
                </option>
            `).join("")}
        </select>

        <input
            class="recipeIngredientQuantity"
            type="number"
            step="0.01"
            placeholder="Quantity">

        <button class="delete-btn" type="button" onclick="this.parentElement.remove()">
            Remove
        </button>
    `;

    container.appendChild(row);

    row.querySelector(".recipeIngredientSelect").value = ingredientId;
    row.querySelector(".recipeIngredientQuantity").value = quantity;
}

async function saveRecipe() {
    const id = document.getElementById("recipeId").value;

    const payload = {
        name: document.getElementById("recipeName").value.trim(),
        category: document.getElementById("recipeCategory").value.trim(),
        yield_quantity: Number(document.getElementById("recipeYieldQuantity").value || 1),
        yield_unit: document.getElementById("recipeYieldUnit").value.trim(),
        notes: document.getElementById("recipeNotes").value.trim()
    };

    if (!payload.name) {
        alert("Please enter a recipe name.");
        return;
    }

    const query = id
        ? supabaseClient.from("recipes").update(payload).eq("id", id).select().single()
        : supabaseClient.from("recipes").insert(payload).select().single();

    const { data: savedRecipe, error } = await query;

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    const recipeId = savedRecipe.id;

    await supabaseClient
        .from("recipe_ingredients")
        .delete()
        .eq("recipe_id", recipeId);

    const ingredientRows = [
        ...document.querySelectorAll(".recipe-ingredient-row")
    ];

    const recipeIngredients = ingredientRows
        .map(row => ({
            recipe_id: recipeId,
            ingredient_id: valueOrNull(row.querySelector(".recipeIngredientSelect").value),
            quantity: Number(row.querySelector(".recipeIngredientQuantity").value)
        }))
        .filter(item => item.ingredient_id && item.quantity > 0);

    if (recipeIngredients.length) {
        const { error: ingredientError } = await supabaseClient
            .from("recipe_ingredients")
            .insert(recipeIngredients);

        if (ingredientError) {
            console.error(ingredientError);
            alert(ingredientError.message);
            return;
        }
    }

    closeRecipeModal();
    await loadInventory();
}

async function deleteRecipe(id, name) {
    if (!confirm(`Delete "${name}"?`)) return;

    const { error } = await supabaseClient
        .from("recipes")
        .delete()
        .eq("id", id);

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    await loadInventory();
}

async function duplicateRecipe(id) {
    const recipe = recipes.find(item => String(item.id) === String(id));

    if (!recipe) return;

    const { data: newRecipe, error } = await supabaseClient
        .from("recipes")
        .insert({
            name: `${recipe.name} Copy`,
            category: recipe.category,
            yield_quantity: recipe.yield_quantity,
            yield_unit: recipe.yield_unit,
            notes: recipe.notes
        })
        .select()
        .single();

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    const copiedIngredients =
        (recipe.recipe_ingredients || []).map(item => ({
            recipe_id: newRecipe.id,
            ingredient_id: item.ingredient_id,
            quantity: item.quantity
        }));

    if (copiedIngredients.length) {
        const { error: copyError } = await supabaseClient
            .from("recipe_ingredients")
            .insert(copiedIngredients);

        if (copyError) {
            console.error(copyError);
            alert(copyError.message);
            return;
        }
    }

    await loadInventory();
}


/*==================================================
    SHOPPING
==================================================*/

function renderShoppingList() {
    const container = document.getElementById("shoppingListContainer");

    if (!container) return;

    const needed = ingredients.filter(isLowStock);

    if (!needed.length) {
        container.innerHTML = "<p>No shopping needed right now.</p>";
        return;
    }

    container.innerHTML = needed.map(ingredient => {
        const neededQuantity =
            Number(ingredient.minimum_quantity || 0) -
            Number(ingredient.quantity_on_hand || 0);

        return `
            <div class="shopping-row">
                <label>
                    <input type="checkbox">
                    ${escapeHtml(ingredient.name)}
                </label>

                <strong>
                    Buy at least
                    ${formatQuantity(Math.abs(neededQuantity))}
                    ${escapeHtml(ingredient.purchase_unit)}
                </strong>
            </div>
        `;
    }).join("");
}

function printShoppingList() {
    window.print();
}


/*==================================================
    SUPPLIERS
==================================================*/

function renderSuppliers() {
    const container = document.getElementById("suppliersList");

    if (!container) return;

    if (!suppliers.length) {
        container.innerHTML = "<p>No suppliers yet.</p>";
        return;
    }

    container.innerHTML = suppliers.map(supplier => `
        <div class="supplier-row">
            <strong>${escapeHtml(supplier.name)}</strong>
            <span>
                ${
                    ingredients.filter(item => item.supplier_id === supplier.id).length
                }
                item(s)
            </span>
        </div>
    `).join("");
}


/*==================================================
    COSTING
==================================================*/

function getRecipeCost(recipe) {
    if (!recipe.recipe_ingredients?.length) return 0;

    return recipe.recipe_ingredients.reduce((sum, item) => {
        return sum + getIngredientCost(item.ingredients, item.quantity);
    }, 0);
}

function getIngredientCost(ingredient, recipeQuantity) {
    if (!ingredient) return 0;

    const purchaseSizeInRecipeUnits =
        convertUnit(
            ingredient.purchase_size,
            ingredient.purchase_unit,
            ingredient.recipe_unit
        );

    if (!purchaseSizeInRecipeUnits) return 0;

    const costPerRecipeUnit =
        Number(ingredient.purchase_price || 0) /
        purchaseSizeInRecipeUnits;

    return costPerRecipeUnit * Number(recipeQuantity || 0);
}

function convertUnit(quantity, fromUnit, toUnit) {
    const from = String(fromUnit || "").toLowerCase();
    const to = String(toUnit || "").toLowerCase();
    const amount = Number(quantity || 0);

    if (from === to) return amount;

    const grams = {
        g: 1,
        gram: 1,
        grams: 1,
        kg: 1000,
        lb: 453.592,
        lbs: 453.592,
        oz: 28.3495
    };

    if (grams[from] && grams[to]) {
        return amount * grams[from] / grams[to];
    }

    return null;
}


/*==================================================
    TABS
==================================================*/

function showInventoryTab(tab, button) {
    document
        .querySelectorAll(".inventory-tab-panel")
        .forEach(panel => {
            panel.style.display = "none";
        });

    document.getElementById(`tab-${tab}`).style.display = "block";

    document
        .querySelectorAll(".inventory-tabs .filter-btn")
        .forEach(btn => {
            btn.classList.remove("active");
        });

    button.classList.add("active");
}


/*==================================================
    HELPERS
==================================================*/

function isLowStock(ingredient) {
    return Number(ingredient.quantity_on_hand || 0) <=
        Number(ingredient.minimum_quantity || 0);
}

function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}

function usd(value) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD"
    }).format(Number(value || 0));
}

function formatQuantity(value) {
    return Number(value || 0)
        .toFixed(2)
        .replace(/\.00$/, "")
        .replace(/0$/, "");
}

function valueOrNull(value) {
    return value === "" ? null : value;
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function escapeJs(value) {
    return String(value || "")
        .replaceAll("\\", "\\\\")
        .replaceAll("'", "\\'")
        .replaceAll('"', "&quot;")
        .replaceAll("\n", " ");
}


/*==================================================
    GLOBAL EXPORTS
==================================================*/

window.showInventoryTab = showInventoryTab;

window.openIngredientModal = openIngredientModal;
window.closeIngredientModal = closeIngredientModal;
window.saveIngredient = saveIngredient;
window.deleteIngredient = deleteIngredient;

window.openRestockModal = openRestockModal;
window.closeRestockModal = closeRestockModal;
window.saveRestock = saveRestock;

window.openRecipeModal = openRecipeModal;
window.closeRecipeModal = closeRecipeModal;
window.addRecipeIngredientRow = addRecipeIngredientRow;
window.saveRecipe = saveRecipe;
window.deleteRecipe = deleteRecipe;
window.duplicateRecipe = duplicateRecipe;

window.printShoppingList = printShoppingList;

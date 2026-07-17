/* ==========================================
   MENU CONFIGURATION
========================================== */

const MENU_CATEGORY_NAMES = {
    bread: "Sourdough Bread",
    cookie: "Sourdough Cookies",
    dessert: "Desserts",
    seasonal: "Seasonal Specials"
};

const BUILDER_SIZE = 4;

let menuItems = [];

/*
Each builder keeps its own selections.

Example:
{
    "builder-product-uuid": {
        "classic-roll-uuid": 2,
        "strawberry-roll-uuid": 1,
        "blueberry-roll-uuid": 1
    }
}
*/
let builderSelections = {};


/* ==========================================
   INITIALIZE
========================================== */

document.addEventListener("DOMContentLoaded", () => {
    loadMenu();
});


/* ==========================================
   LOAD MENU
========================================== */

async function loadMenu() {
    const container = document.getElementById("menuContainer");

    if (!container) {
        console.error("Menu container was not found.");
        return;
    }

    container.innerHTML = "<p>Loading menu...</p>";

    const { data, error } = await supabaseClient
        .from("menu_items")
        .select("*")
        .eq("available", true)
        .order("category", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

    if (error) {
        console.error(error);

        container.innerHTML = `
            <article class="notice-card">
                <h2>Unable to load menu.</h2>
                <p>Please try again later.</p>
            </article>
        `;

        return;
    }

    menuItems = data || [];

    renderMenu();

    if (typeof initializeCart === "function") {
        initializeCart(menuItems, renderMenu);
    }
}


/* ==========================================
   RENDER MENU
========================================== */

function renderMenu() {
    const container = document.getElementById("menuContainer");

    if (!container) return;

    if (!menuItems.length) {
        container.innerHTML = `
            <article class="notice-card">
                <h2>Menu Coming Soon</h2>
                <p>Fresh bakes will appear here soon.</p>
            </article>
        `;

        return;
    }

    let html = "";

    Object.keys(MENU_CATEGORY_NAMES).forEach(category => {
        const categoryItems = menuItems.filter(
            item => item.category === category
        );

        if (!categoryItems.length) return;

        html += `
            <div class="menu-section">

                <div class="menu-section-title">
                    <h2>${MENU_CATEGORY_NAMES[category]}</h2>
                </div>

                <div class="menu-grid ${category === "cookie" ? "two" : ""}">
                    ${categoryItems.map(renderMenuCard).join("")}
                </div>

            </div>
        `;
    });

    container.innerHTML = html;

    updateAllBuilderUIs();
}


/* ==========================================
   PRODUCT CARD ROUTER
========================================== */

function renderMenuCard(item) {
    if (item.product_type === "builder") {
        return renderBuilderCard(item);
    }

    return renderStandardMenuCard(item);
}


/* ==========================================
   STANDARD PRODUCT CARD
========================================== */

function renderStandardMenuCard(item) {
    const quantity =
        typeof getCartQuantity === "function"
            ? getCartQuantity(item.id)
            : 0;

    return `
        <article class="menu-item ${item.category === "cookie" ? "full" : ""}">

            <div class="menu-item-top">

                <h3>
                    ${escapeHtml(item.name)}

                    ${
                        item.featured
                            ? `<span class="featured-badge">★ Featured</span>`
                            : ""
                    }
                </h3>

                <span class="price">
                    €${formatPrice(item.price)}
                </span>

            </div>

            <p class="menu-description">
                ${escapeHtml(item.description || "").replace(/\n/g, "<br>")}
            </p>

            <div class="menu-order-actions">

                ${
                    quantity > 0
                        ? `
                            <button
                                type="button"
                                onclick="changeCartQuantity('${item.id}', -1)">
                                −
                            </button>

                            <span>${quantity}</span>

                            <button
                                type="button"
                                onclick="changeCartQuantity('${item.id}', 1)">
                                +
                            </button>
                        `
                        : `
                            <button
                                type="button"
                                class="add-cart-btn"
                                onclick="changeCartQuantity('${item.id}', 1)">
                                Add to Cart
                            </button>
                        `
                }

            </div>

        </article>
    `;
}


/* ==========================================
   BUILDER PRODUCT CARD
========================================== */

function renderBuilderCard(builderProduct) {
    const options = getBuilderOptions(builderProduct);

    if (!options.length) {
        return `
            <article class="menu-item mix-match-builder">

                <div class="menu-item-top">

                    <h3>
                        ${escapeHtml(builderProduct.name)}

                        ${
                            builderProduct.featured
                                ? `<span class="featured-badge">★ Featured</span>`
                                : ""
                        }
                    </h3>

                    <span class="price">
                        €${formatPrice(builderProduct.price)}
                    </span>

                </div>

                <p class="menu-description">
                    ${escapeHtml(builderProduct.description || "").replace(/\n/g, "<br>")}
                </p>

                <p class="builder-empty-message">
                    No available options are currently assigned to this box.
                </p>

            </article>
        `;
    }

    const selections = getBuilderSelections(builderProduct.id);
    const total = getBuilderTotal(builderProduct.id);

    return `
        <article
            class="menu-item mix-match-builder"
            data-builder-id="${builderProduct.id}">

            <div class="menu-item-top">

                <h3>
                    ${escapeHtml(builderProduct.name)}

                    ${
                        builderProduct.featured
                            ? `<span class="featured-badge">★ Featured</span>`
                            : ""
                    }
                </h3>

                <span class="price">
                    €${formatPrice(builderProduct.price)}
                </span>

            </div>

            <p class="menu-description">
                ${escapeHtml(builderProduct.description || "").replace(/\n/g, "<br>")}
            </p>

            <div
                id="builderCounter-${builderProduct.id}"
                class="builder-counter">

                ${getBuilderCounterText(total)}

            </div>

            <div class="builder-options">

                ${options.map(option => {
                    const quantity = selections[option.id] || 0;

                    return `
                        <div class="builder-option">

                            <span class="builder-option-name">
                                ${escapeHtml(option.name)}
                            </span>

                            <div class="builder-controls">

                                <button
                                    type="button"
                                    aria-label="Remove one ${escapeHtml(option.name)}"
                                    onclick="changeBuilderSelection(
                                        '${builderProduct.id}',
                                        '${option.id}',
                                        -1
                                    )">
                                    −
                                </button>

                                <span
                                    id="builderQty-${builderProduct.id}-${option.id}"
                                    class="builder-option-quantity">

                                    ${quantity}

                                </span>

                                <button
                                    type="button"
                                    aria-label="Add one ${escapeHtml(option.name)}"
                                    onclick="changeBuilderSelection(
                                        '${builderProduct.id}',
                                        '${option.id}',
                                        1
                                    )">
                                    +
                                </button>

                                <button
                                    type="button"
                                    class="builder-fill-btn"
                                    onclick="fillBuilderFlavor(
                                        '${builderProduct.id}',
                                        '${option.id}'
                                    )">

                                    Fill All

                                </button>

                            </div>

                        </div>
                    `;
                }).join("")}

            </div>

            <button
                id="builderAddButton-${builderProduct.id}"
                type="button"
                class="primary-btn builder-add-button"
                ${total === BUILDER_SIZE ? "" : "disabled"}
                onclick="addCurrentBuilderToCart('${builderProduct.id}')">

                Add Box to Cart

            </button>

        </article>
    `;
}


/* ==========================================
   BUILDER DATA
========================================== */

function getBuilderProduct(builderId) {
    return menuItems.find(item =>
        item.id === builderId &&
        item.product_type === "builder"
    );
}

function getBuilderOptions(builderProduct) {
    if (!builderProduct || !builderProduct.builder_group) {
        return [];
    }

    return menuItems.filter(item =>
        item.product_type !== "builder" &&
        item.builder_group === builderProduct.builder_group
    );
}

function getBuilderSelections(builderId) {
    if (!builderSelections[builderId]) {
        builderSelections[builderId] = {};
    }

    return builderSelections[builderId];
}

function getBuilderTotal(builderId) {
    const selections = getBuilderSelections(builderId);

    return Object.values(selections).reduce(
        (sum, quantity) => sum + Number(quantity || 0),
        0
    );
}

function getBuilderCounterText(total) {
    if (total === BUILDER_SIZE) {
        return "✓ Ready to Add";
    }

    const remaining = BUILDER_SIZE - total;

    return `Choose ${remaining} More`;
}


/* ==========================================
   CHANGE BUILDER SELECTION
========================================== */

function changeBuilderSelection(builderId, itemId, change) {
    const builderProduct = getBuilderProduct(builderId);

    if (!builderProduct) {
        console.error("Builder product was not found:", builderId);
        return;
    }

    const validOption = getBuilderOptions(builderProduct).some(
        item => item.id === itemId
    );

    if (!validOption) {
        console.error("Builder option was not found:", itemId);
        return;
    }

    const selections = getBuilderSelections(builderId);
    const current = selections[itemId] || 0;

    if (change < 0) {
        const next = Math.max(0, current - 1);

        if (next === 0) {
            delete selections[itemId];
        } else {
            selections[itemId] = next;
        }

        updateBuilderUI(builderId);
        return;
    }

    const total = getBuilderTotal(builderId);

    /*
    When the box is already full, adding another flavor
    removes one roll from a different selected flavor.
    */
    if (total >= BUILDER_SIZE) {
        const removeId = Object.keys(selections).find(
            selectedId =>
                selectedId !== itemId &&
                selections[selectedId] > 0
        );

        if (removeId) {
            selections[removeId] -= 1;

            if (selections[removeId] <= 0) {
                delete selections[removeId];
            }
        } else {
            /*
            All four are currently the same flavor.
            Clicking + on that same flavor cannot increase it.
            */
            return;
        }
    }

    selections[itemId] = (selections[itemId] || 0) + 1;

    updateBuilderUI(builderId);
}


/* ==========================================
   FILL ALL
========================================== */

function fillBuilderFlavor(builderId, itemId) {
    const builderProduct = getBuilderProduct(builderId);

    if (!builderProduct) return;

    const validOption = getBuilderOptions(builderProduct).some(
        item => item.id === itemId
    );

    if (!validOption) return;

    builderSelections[builderId] = {
        [itemId]: BUILDER_SIZE
    };

    updateBuilderUI(builderId);
}


/* ==========================================
   UPDATE BUILDER UI
========================================== */

function updateBuilderUI(builderId) {
    const builderProduct = getBuilderProduct(builderId);

    if (!builderProduct) return;

    const selections = getBuilderSelections(builderId);
    const total = getBuilderTotal(builderId);

    const counter = document.getElementById(
        `builderCounter-${builderId}`
    );

    if (counter) {
        counter.textContent = getBuilderCounterText(total);
    }

    const addButton = document.getElementById(
        `builderAddButton-${builderId}`
    );

    if (addButton) {
        addButton.disabled = total !== BUILDER_SIZE;
    }

    getBuilderOptions(builderProduct).forEach(option => {
        const quantityElement = document.getElementById(
            `builderQty-${builderId}-${option.id}`
        );

        if (quantityElement) {
            quantityElement.textContent =
                selections[option.id] || 0;
        }
    });
}

function updateAllBuilderUIs() {
    menuItems
        .filter(item => item.product_type === "builder")
        .forEach(builderProduct => {
            updateBuilderUI(builderProduct.id);
        });
}


/* ==========================================
   ADD BUILDER TO CART
========================================== */

function addCurrentBuilderToCart(builderId) {
    const builderProduct = getBuilderProduct(builderId);

    if (!builderProduct) {
        alert("This box is no longer available.");
        return;
    }

    const total = getBuilderTotal(builderId);

    if (total !== BUILDER_SIZE) {
        alert(`Please choose exactly ${BUILDER_SIZE} items.`);
        return;
    }

    const selectionsState = getBuilderSelections(builderId);

    const selections = getBuilderOptions(builderProduct)
        .filter(item => selectionsState[item.id] > 0)
        .map(item => ({
            menu_item_id: item.id,
            name: item.name,
            quantity: selectionsState[item.id]
        }));

    if (!selections.length) {
        alert("Please select items for your box.");
        return;
    }

    if (typeof addBuilderToCart !== "function") {
        console.error("addBuilderToCart() is not available.");
        alert("The cart could not be updated. Please refresh and try again.");
        return;
    }

    addBuilderToCart({
        id: builderProduct.id,
        name: builderProduct.name,
        price: Number(builderProduct.price),
        selections
    });

    builderSelections[builderId] = {};

    updateBuilderUI(builderId);
}


/* ==========================================
   HELPERS
========================================== */

function formatPrice(price) {
    const value = Number(price);

    if (Number.isNaN(value)) {
        return "0";
    }

    return value
        .toFixed(2)
        .replace(/\.00$/, "");
}

function escapeHtml(text) {
    return String(text || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

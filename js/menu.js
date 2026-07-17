const MENU_CATEGORY_NAMES = {
    bread: "Sourdough Bread",
    cookie: "Sourdough Cookies",
    dessert: "Desserts",
    seasonal: "Seasonal Specials"
};

let menuItems = [];
let builderSelections = {};

const BUILDER_SIZE = 4;

let activeBuilderProduct = null;

document.addEventListener("DOMContentLoaded", () => {
    loadMenu();
});

async function loadMenu() {

    const container = document.getElementById("menuContainer");

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

function renderMenu() {

    const container = document.getElementById("menuContainer");

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

                    ${renderCategory(categoryItems, category)}

                </div>

            </div>

        `;

    });

    container.innerHTML = html;

}

function renderCategory(categoryItems, category) {

    if (category !== "cookie") {
        return categoryItems
            .map(renderMenuCard)
            .join("");
    }

    let html = "";

    const builderProduct = categoryItems.find(item =>
        item.product_type === "builder" &&
        item.builder_group === "cinnamon-roll"
    );

    const cinnamonRolls = categoryItems.filter(item =>
        item.product_type === "standard" &&
        item.builder_group === "cinnamon-roll"
    );

    const otherCookies = categoryItems.filter(item =>
        item.product_type === "standard" &&
        item.builder_group !== "cinnamon-roll"
    );

    html += cinnamonRolls
        .map(renderMenuCard)
        .join("");

    if (builderProduct) {

        activeBuilderProduct = builderProduct;

        html += renderCinnamonBuilder(
            builderProduct,
            cinnamonRolls
        );

    }

    html += otherCookies
        .map(renderMenuCard)
        .join("");

    return html;

}

function renderCinnamonBuilder(
    builderProduct,
    cinnamonRolls
) {

    if (!cinnamonRolls.length) {
        return "";
    }

    return `

<article class="menu-item mix-match-builder">

    <div class="menu-item-top">

        <h3>

    ${escapeHtml(builderProduct.name)}

    ${builderProduct.featured
        ? `<span class="featured-badge">★ Featured</span>`
        : ""}

</h3>

        <span class="price">

            €${formatPrice(builderProduct.price)}
        </span>

    </div>

    <p class="menu-description">

       ${escapeHtml(builderProduct.description)}

    </p>

    <div id="builderCounter" class="builder-counter">

        Choose 4 Rolls

    </div>

    <div class="builder-options">

        ${cinnamonRolls.map(item => `

            <div class="builder-option">

                <span>

                    ${escapeHtml(item.name)}

                </span>

               <div class="builder-controls">

    <button
        type="button"
        onclick="changeBuilderSelection('${item.id}',-1)">
        −
    </button>

    <span id="builderQty-${item.id}">
        0
    </span>

    <button
        type="button"
        onclick="changeBuilderSelection('${item.id}',1)">
        +
    </button>

    <button
        type="button"
        class="builder-fill-btn"
        onclick="fillBuilderFlavor('${item.id}')">

        Fill All

    </button>

</div>
            </div>

        `).join("")}

    </div>

    <button

        id="builderAddButton"

        class="primary-btn"

        disabled

        onclick="addCurrentBuilderToCart()">

        Add Box to Cart

    </button>

</article>

`;

}

function renderMenuCard(item) {

    const quantity =
        typeof getCartQuantity === "function"
            ? getCartQuantity(item.id)
            : 0;

    return `

<article class="menu-item ${item.category === "cookie" ? "full" : ""}">

    <div class="menu-item-top">

        <h3>

            ${escapeHtml(item.name)}

            ${item.featured
                ? `<span class="featured-badge">★ Featured</span>`
                : ""}

        </h3>

        <span class="price">

            €${formatPrice(item.price)}

        </span>

    </div>

    <p class="menu-description">

        ${escapeHtml(item.description || "").replace(/\n/g,"<br>")}

    </p>

    <div class="menu-order-actions">

        ${
            quantity > 0

                ? `

                    <button
                        type="button"
                        onclick="changeCartQuantity('${item.id}',-1)">

                        −

                    </button>

                    <span>${quantity}</span>

                    <button
                        type="button"
                        onclick="changeCartQuantity('${item.id}',1)">

                        +

                    </button>

                `

                : `

                    <button
                        type="button"
                        class="add-cart-btn"
                        onclick="changeCartQuantity('${item.id}',1)">

                        Add to Cart

                    </button>

                `

        }

    </div>

</article>

`;

}

function getBuilderTotal() {

    return Object.values(builderSelections)
        .reduce((sum, qty) => sum + qty, 0);

}

function updateBuilderUI() {

    const total = getBuilderTotal();

    const counter = document.getElementById("builderCounter");

    if (counter) {

        counter.textContent =
    total === BUILDER_SIZE
        ? "✓ Ready to Add"
        : `Choose ${BUILDER_SIZE - total} More`;

    }

    const addButton =
        document.getElementById("builderAddButton");

    if (addButton) {

        addButton.disabled = total !== BUILDER_SIZE;

    }

   menuItems
    .filter(item =>
        item.product_type === "standard" &&
        item.builder_group === "cinnamon-roll"
    )
    .forEach(item => {

        const qty = builderSelections[item.id] || 0;

        const span = document.getElementById(
            `builderQty-${item.id}`
        );

        if (span) {
            span.textContent = qty;
        }

    });
}

function changeBuilderSelection(itemId, change) {

    const current = builderSelections[itemId] || 0;

    if (change < 0) {

        const next = Math.max(0, current - 1);

        if (next === 0) {
            delete builderSelections[itemId];
        } else {
            builderSelections[itemId] = next;
        }

        updateBuilderUI();
        return;

    }

    let total = getBuilderTotal();

    if (total >= BUILDER_SIZE) {

        const otherSelections = Object.keys(builderSelections)
            .filter(id => id !== itemId && builderSelections[id] > 0);

        if (otherSelections.length) {

            const removeId = otherSelections[0];

            builderSelections[removeId]--;

            if (builderSelections[removeId] <= 0) {
                delete builderSelections[removeId];
            }

        } else {

            return;

        }

    }

    builderSelections[itemId] =
        (builderSelections[itemId] || 0) + 1;

    updateBuilderUI();

}

function fillBuilderFlavor(itemId) {

    builderSelections = {};

    builderSelections[itemId] = BUILDER_SIZE;

    updateBuilderUI();

}

function addCurrentBuilderToCart() {

    const total = getBuilderTotal();

    if (total !== BUILDER_SIZE) {

        alert(`Please choose exactly ${BUILDER_SIZE} cinnamon rolls.`);

        return;

    }

   const selections = menuItems

    .filter(item =>

        item.product_type === "standard" &&
        builderSelections[item.id] > 0

    )

    .map(item => ({

        menu_item_id: item.id,

        name: item.name,

        quantity: builderSelections[item.id]

    }));

        .map(item => ({

            menu_item_id: item.id,

            name: item.name,

            quantity: builderSelections[item.id]

        }));

    if (!activeBuilderProduct) {
    return;
}

addBuilderToCart({

    id: activeBuilderProduct.id,

    name: activeBuilderProduct.name,

    price: Number(activeBuilderProduct.price),

    selections

});

    builderSelections = {};

    updateBuilderUI();

}

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

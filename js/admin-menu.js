document.addEventListener("DOMContentLoaded", async () => {

    await requireAuth();

    setupLogout();

    loadMenuManager();

    loadBallotManager();

});


/* =========================
   MENU MANAGER
========================= */

let menuItems = [];

const MENU_CATEGORIES = [
    {
        key: "bread",
        label: "Bread"
    },
    {
        key: "cookie",
        label: "Cookies"
    },
    {
        key: "dessert",
        label: "Desserts"
    },
    {
        key: "seasonal",
        label: "Seasonal"
    }
];

async function loadMenuManager() {
    const container = document.getElementById("menuManager");

    if (!container) return;

    container.innerHTML = `<p>Loading menu items...</p>`;

    const { data, error } = await supabaseClient
        .from("menu_items")
        .select("*")
        .order("category", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

    if (error) {
        console.error(error);
        container.innerHTML = `
            <p>Unable to load menu items.</p>
        `;
        return;
    }

    menuItems = data || [];

    renderMenuManager();

    document.getElementById("menuItemCount").textContent =
    data.length;

    document.getElementById("availableCount").textContent =
    data.filter(item => item.available).length;
}

function renderMenuManager() {
    const container = document.getElementById("menuManager");

    if (!container) return;

    container.innerHTML = `
        <div class="menu-admin-toolbar">

            <button
                class="approve-btn"
                onclick="openMenuItemModal()">

                + Add Menu Item

            </button>

        </div>

        <div class="menu-admin-summary">

            <div>
                <strong>Total Items</strong>
                <p>${menuItems.length}</p>
            </div>

            <div>
                <strong>Available</strong>
                <p>${menuItems.filter(item => item.available).length}</p>
            </div>

            <div>
                <strong>Featured</strong>
                <p>${menuItems.filter(item => item.featured).length}</p>
            </div>

        </div>

        <div class="menu-admin-sections">

            ${MENU_CATEGORIES.map(category => {
                const items = menuItems
                    .filter(item => item.category === category.key)
                    .sort((a, b) => {
                        const orderA = Number(a.sort_order || 0);
                        const orderB = Number(b.sort_order || 0);

                        if (orderA !== orderB) {
                            return orderA - orderB;
                        }

                        return a.name.localeCompare(b.name);
                    });

                return renderMenuCategory(category, items);
            }).join("")}

        </div>
    `;
}

function renderMenuCategory(category, items) {
    return `
        <section class="menu-admin-category">

            <div class="menu-category-header">

                <div>
                    <h3>${category.label}</h3>
                    <p>${items.length} item${items.length === 1 ? "" : "s"}</p>
                </div>

                <button
                    class="add-option-btn"
                    onclick="openMenuItemModal('${category.key}')">

                    + Add

                </button>

            </div>

            ${
                !items.length
                    ? `<p class="empty-menu-category">No ${category.label.toLowerCase()} yet.</p>`
                    : items.map(item => renderMenuItemCard(item)).join("")
            }

        </section>
    `;
}

function renderMenuItemCard(item) {

    return `

        <article class="menu-admin-item ${item.available ? "" : "is-disabled"}">

            <div class="menu-admin-main">

                <div>

                    <div class="menu-item-title-row">

                        <h4>${escapeHtml(item.name)}</h4>

                        ${item.featured
                            ? `<span class="featured-pill">Featured</span>`
                            : ""}

                        ${!item.available
                            ? `<span class="disabled-pill">Hidden</span>`
                            : ""}

                    </div>

                    <p class="menu-description">

${escapeHtml(item.description || "")}

                    </p>

                    <div class="menu-item-meta">

                        <span>€${formatMenuPrice(item.price)}</span>

                        <span>Sort: ${item.sort_order || 0}</span>

                    </div>

                </div>

                <div class="menu-admin-actions">

                    <button
                        class="edit-option-btn"
                        onclick="openMenuItemModal(null,'${item.id}')">

                        Edit

                    </button>

                    <button
                        class="add-option-btn"
                        onclick="toggleFeatured('${item.id}', ${item.featured})">

                        ${item.featured ? "Unfeature" : "Feature"}

                    </button>

                    <button
                        class="edit-option-btn"
                        onclick="updateSortOrder('${item.id}',-1)">

                        ↑ Up

                    </button>

                    <button
                        class="edit-option-btn"
                        onclick="updateSortOrder('${item.id}',1)">

                        ↓ Down

                    </button>

                    <button
                        class="remove-option-btn"
                        onclick="toggleMenuAvailability('${item.id}', ${item.available})">

                        ${item.available ? "Hide" : "Show"}

                    </button>

                    <button
                        class="delete-btn"
                        onclick="deleteMenuItem('${item.id}','${escapeHtml(item.name)}')">

                        Delete

                    </button>

                </div>

            </div>

        </article>

    `;

}

/* =========================
   MENU ITEM MODAL
========================= */

function openMenuItemModal(category = null, itemId = null) {
    let modal = document.getElementById("menuItemModal");

    if (!modal) {
        modal = buildMenuItemModal();
        document.body.appendChild(modal);
    }

    const item = itemId
        ? menuItems.find(menuItem => menuItem.id === itemId)
        : null;

    document.getElementById("menuModalTitle").textContent =
        item ? "Edit Menu Item" : "Add Menu Item";

    document.getElementById("menuItemId").value = item ? item.id : "";
    document.getElementById("menuItemName").value = item ? item.name : "";
    document.getElementById("menuItemPrice").value = item ? item.price : "";
    document.getElementById("menuItemDescription").value = item ? item.description || "" : "";
    document.getElementById("menuItemCategory").value = item ? item.category : category || "bread";
    document.getElementById("menuItemSort").value = item ? item.sort_order || 0 : 0;
    document.getElementById("menuItemAvailable").checked = item ? item.available : true;
    document.getElementById("menuItemFeatured").checked = item ? item.featured : false;

    modal.style.display = "flex";
}

function buildMenuItemModal() {
    const modal = document.createElement("div");

    modal.id = "menuItemModal";
    modal.className = "modal-overlay";
    modal.style.display = "none";

    modal.innerHTML = `
        <div class="modal-card">

            <div class="modal-header">

                <h2 id="menuModalTitle">Add Menu Item</h2>

                <button
                    class="modal-close"
                    onclick="closeMenuItemModal()">

                    ✕

                </button>

            </div>

            <div class="modal-body">

                <input type="hidden" id="menuItemId">

                <label>Name</label>
                <input
                    type="text"
                    id="menuItemName"
                    placeholder="Classic Sourdough Boule">

                <label>Price €</label>
                <input
                    type="number"
                    id="menuItemPrice"
                    step="0.01"
                    min="0"
                    placeholder="10">

                <label>Description</label>
                <textarea
                    id="menuItemDescription"
                    rows="5"
                    placeholder="Short menu description"></textarea>

                <label>Category</label>
                <select id="menuItemCategory">
                    <option value="bread">Bread</option>
                    <option value="cookie">Cookie</option>
                    <option value="dessert">Dessert</option>
                    <option value="seasonal">Seasonal</option>
                </select>

                <label>Sort Order</label>
                <input
                    type="number"
                    id="menuItemSort"
                    step="1"
                    placeholder="1">

                <div class="modal-checkboxes">

                    <label>
                        <input
                            type="checkbox"
                            id="menuItemAvailable">
                        Available
                    </label>

                    <label>
                        <input
                            type="checkbox"
                            id="menuItemFeatured">
                        Featured
                    </label>

                </div>

            </div>

            <div class="modal-footer">

                <button
                    class="secondary-btn"
                    onclick="closeMenuItemModal()">

                    Cancel

                </button>

                <button
                    class="primary-btn"
                    onclick="saveMenuItem()">

                    Save Item

                </button>

            </div>

        </div>
    `;

    return modal;
}

function closeMenuItemModal() {
    const modal = document.getElementById("menuItemModal");

    if (modal) {
        modal.style.display = "none";
    }
}

async function saveMenuItem() {
    const id = document.getElementById("menuItemId").value;
    const name = document.getElementById("menuItemName").value.trim();
    const price = Number(document.getElementById("menuItemPrice").value);
    const description = document.getElementById("menuItemDescription").value.trim();
    const category = document.getElementById("menuItemCategory").value;
    const sortOrder = Number(document.getElementById("menuItemSort").value || 0);
    const available = document.getElementById("menuItemAvailable").checked;
    const featured = document.getElementById("menuItemFeatured").checked;

    if (!name) {
        alert("Please enter an item name.");
        return;
    }

    if (!price || price < 0) {
        alert("Please enter a valid price.");
        return;
    }

    const payload = {
        name,
        price,
        description,
        category,
        sort_order: sortOrder,
        available,
        featured
    };

    let error;

    if (id) {
        ({ error } = await supabaseClient
            .from("menu_items")
            .update(payload)
            .eq("id", id));
    } else {
        ({ error } = await supabaseClient
            .from("menu_items")
            .insert(payload));
    }

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    closeMenuItemModal();
    await loadMenuManager();
}

async function toggleMenuAvailability(id, currentlyAvailable) {
    const { error } = await supabaseClient
        .from("menu_items")
        .update({
            available: !currentlyAvailable
        })
        .eq("id", id);

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    await loadMenuManager();
}

/* =========================
   MENU HELPERS
========================= */

function formatMenuPrice(price) {

    const value = Number(price);

    if (Number.isNaN(value)) {

        return "0";

    }

    return value.toFixed(2).replace(/\.00$/, "");

}

function getCategoryLabel(category) {

    const found = MENU_CATEGORIES.find(c => c.key === category);

    return found ? found.label : category;

}

function sortMenuItems() {

    menuItems.sort((a, b) => {

        if (a.category !== b.category) {

            return a.category.localeCompare(b.category);

        }

        const orderA = Number(a.sort_order || 0);
        const orderB = Number(b.sort_order || 0);

        if (orderA !== orderB) {

            return orderA - orderB;

        }

        return a.name.localeCompare(b.name);

    });

}

async function refreshMenuManager() {

    await loadMenuManager();

}

/* =========================
   FEATURED
========================= */

async function toggleFeatured(itemId, currentValue) {

    const { error } = await supabaseClient
        .from("menu_items")
        .update({

            featured: !currentValue

        })
        .eq("id", itemId);

    if (error) {

        console.error(error);

        alert(error.message);

        return;

    }

    refreshMenuManager();

}

/* =========================
   DELETE ITEM
========================= */

async function deleteMenuItem(itemId, itemName) {

    const confirmed = confirm(

        `Delete "${itemName}"?\n\nThis cannot be undone.`

    );

    if (!confirmed) return;

    const { error } = await supabaseClient
        .from("menu_items")
        .delete()
        .eq("id", itemId);

    if (error) {

        console.error(error);

        alert(error.message);

        return;

    }

    refreshMenuManager();

}

/* =========================
   DUPLICATE ITEM
========================= */

async function duplicateMenuItem(itemId) {

    const item = menuItems.find(i => i.id === itemId);

    if (!item) return;

    const copy = {

        name: item.name + " Copy",

        price: item.price,

        description: item.description,

        category: item.category,

        featured: false,

        available: item.available,

        sort_order: Number(item.sort_order || 0) + 1

    };

    const { error } = await supabaseClient
        .from("menu_items")
        .insert(copy);

    if (error) {

        console.error(error);

        alert(error.message);

        return;

    }

    refreshMenuManager();

}

/* =========================
   SORT ORDER
========================= */

async function updateSortOrder(itemId, direction) {

    const item = menuItems.find(i => i.id === itemId);

    if (!item) return;

    const newOrder = Math.max(
    1,
    Number(item.sort_order || 1) + direction
);

    const { error } = await supabaseClient
        .from("menu_items")
        .update({

            sort_order: newOrder

        })
        .eq("id", itemId);

    if (error) {

        console.error(error);

        alert(error.message);

        return;

    }

    refreshMenuManager();

}

/* =========================
   MENU INITIALIZATION
========================= */

document.addEventListener("keydown", (event) => {

    if (event.key !== "Escape") return;

    closeMenuItemModal();

});

/* =========================
   UI HELPERS
========================= */

function rebuildMenuManager() {

    sortMenuItems();

    renderMenuManager();

}

/* =========================
   RELOAD
========================= */

async function reloadMenuManager() {

    await loadMenuManager();

}

/* =========================
   GLOBAL EXPORTS
========================= */

window.loadMenuManager = loadMenuManager;

window.openMenuItemModal = openMenuItemModal;

window.closeMenuItemModal = closeMenuItemModal;

window.saveMenuItem = saveMenuItem;

window.toggleMenuAvailability = toggleMenuAvailability;

window.toggleFeatured = toggleFeatured;

window.deleteMenuItem = deleteMenuItem;

window.duplicateMenuItem = duplicateMenuItem;

window.updateSortOrder = updateSortOrder;

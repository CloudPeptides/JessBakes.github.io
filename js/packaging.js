/*==================================================
    PACKAGING PAGE INITIALIZATION
==================================================*/

let packagingProfiles = [];
let packagingInventoryItems = [];
let packagingCategories = [];

document.addEventListener("DOMContentLoaded", async () => {

    await requireAuth();

    if (typeof setupLogout === "function") {
        setupLogout();
    }

    buildPackagingModal();

    document
        .getElementById("newPackagingProfile")
        ?.addEventListener("click", () => {
            openPackagingModal();
        });

    await loadPackagingPage();

});


/*==================================================
    LOAD PACKAGING DATA
==================================================*/

async function loadPackagingPage() {

    await Promise.all([
        loadPackagingInventoryItems(),
        loadPackagingProfiles()
    ]);

    renderPackagingOverview();
    renderPackagingProfiles();

}


/*==================================================
    LOAD INVENTORY ITEMS

    Only items from Packaging and Supplies
    categories are available inside profiles.
==================================================*/

async function loadPackagingInventoryItems() {

    const { data: categoryData, error: categoryError } =
        await supabaseClient
            .from("inventory_categories")
            .select("*")
            .order("sort_order", { ascending: true });

    if (categoryError) {

        console.error(
            "Unable to load inventory categories:",
            categoryError
        );

        packagingCategories = [];
        packagingInventoryItems = [];

        return;

    }

    packagingCategories = categoryData || [];

    const allowedCategoryIds =
        packagingCategories
            .filter(category =>
                ["packaging", "supplies"].includes(
                    String(category.name || "")
                        .trim()
                        .toLowerCase()
                )
            )
            .map(category => category.id);

    if (!allowedCategoryIds.length) {

        console.warn(
            'No inventory categories named "Packaging" or "Supplies" were found.'
        );

        packagingInventoryItems = [];

        return;

    }

    const { data, error } =
        await supabaseClient
            .from("ingredients")
            .select("*")
            .in("category_id", allowedCategoryIds)
            .order("name", { ascending: true });

    if (error) {

        console.error(
            "Unable to load packaging inventory items:",
            error
        );

        packagingInventoryItems = [];

        return;

    }

    packagingInventoryItems = data || [];

}


/*==================================================
    LOAD PACKAGING PROFILES
==================================================*/

async function loadPackagingProfiles() {

    const { data, error } =
        await supabaseClient
            .from("packaging_profiles")
            .select(`
                *,
                packaging_profile_items (
                    id,
                    profile_id,
                    ingredient_id,
                    quantity,
                    ingredients (
                        id,
                        name,
                        purchase_unit,
                        purchase_size,
                        purchase_price
                    )
                )
            `)
            .order("name", { ascending: true });

    if (error) {

        console.error(
            "Unable to load packaging profiles:",
            error
        );

        packagingProfiles = [];

        return;

    }

    packagingProfiles =
        (data || []).map(profile => ({

            ...profile,

            packaging_profile_items:
                Array.isArray(profile.packaging_profile_items)
                    ? profile.packaging_profile_items
                    : []

        }));

}


/*==================================================
    OVERVIEW
==================================================*/

function renderPackagingOverview() {

    const activeProfiles =
        packagingProfiles.filter(profile =>
            profile.is_active !== false
        );

    const uniqueInventoryItems =
        new Set();

    let combinedCost = 0;

    activeProfiles.forEach(profile => {

        profile.packaging_profile_items.forEach(item => {

            uniqueInventoryItems.add(
                String(item.ingredient_id)
            );

        });

        combinedCost +=
            calculateProfileCost(profile);

    });

    const averageCost =
        activeProfiles.length
            ? combinedCost / activeProfiles.length
            : 0;

    setPackagingText(
        "profileCount",
        activeProfiles.length
    );

    setPackagingText(
        "packagingItemCount",
        uniqueInventoryItems.size
    );

    setPackagingText(
        "averagePackagingCost",
        usdPackaging(averageCost)
    );

}


/*==================================================
    PROFILE CARDS
==================================================*/

function renderPackagingProfiles() {

    const container =
        document.getElementById("packagingProfiles");

    if (!container) return;

    if (!packagingProfiles.length) {

        container.innerHTML = `

            <section class="packaging-empty-state">

                <h2>No packaging profiles yet</h2>

                <p>
                    Create a profile for bread, cookie packaging,
                    or any other order type.
                </p>

                <button
                    class="primary-btn"
                    type="button"
                    onclick="openPackagingModal()">

                    + New Profile

                </button>

            </section>

        `;

        return;

    }

    container.innerHTML =
        packagingProfiles
            .map(renderPackagingProfileCard)
            .join("");

}

function renderPackagingProfileCard(profile) {

    const items =
        profile.packaging_profile_items || [];

    const cost =
        calculateProfileCost(profile);

    const itemList =
        items.length
            ? items.map(item => {

                const ingredient =
                    item.ingredients;

                const unit =
                    ingredient?.purchase_unit || "unit";

                return `

                    <li>

                        <span>
                            ${escapePackagingHtml(
                                ingredient?.name || "Deleted inventory item"
                            )}
                        </span>

                        <strong>
                            ${formatPackagingQuantity(item.quantity)}
                            ${escapePackagingHtml(unit)}
                        </strong>

                    </li>

                `;

            }).join("")
            : `

                <li class="packaging-profile-no-items">
                    No packaging items added yet.
                </li>

            `;

    return `

        <article class="packaging-profile-card">

            <div class="packaging-profile-card-header">

                <div>

                    <p class="eyebrow">
                        ${escapePackagingHtml(
                            profile.product_type || "Packaging profile"
                        )}
                    </p>

                    <h2>
                        ${escapePackagingHtml(profile.name)}
                    </h2>

                </div>

                <span class="packaging-profile-cost">
                    ${usdPackaging(cost)}
                </span>

            </div>

            ${
                profile.description
                    ? `
                        <p class="packaging-profile-description">
                            ${escapePackagingHtml(profile.description)}
                        </p>
                    `
                    : ""
            }

            <div class="packaging-profile-summary">

                <span>
                    ${items.length}
                    item${items.length === 1 ? "" : "s"}
                </span>

                <span>
                    ${usdPackaging(cost)} per use
                </span>

            </div>

            <ul class="packaging-profile-items">
                ${itemList}
            </ul>

            <div class="packaging-profile-actions">

                <button
                    class="primary-btn"
                    type="button"
                    onclick="openPackagingModal('${profile.id}')">

                    Edit

                </button>

                <button
                    class="secondary-btn"
                    type="button"
                    onclick="duplicatePackagingProfile('${profile.id}')">

                    Duplicate

                </button>

                <button
                    class="delete-btn"
                    type="button"
                    onclick="deletePackagingProfile(
                        '${profile.id}',
                        '${escapePackagingJs(profile.name)}'
                    )">

                    Delete

                </button>

            </div>

        </article>

    `;

}


/*==================================================
    COST CALCULATIONS
==================================================*/

function calculateProfileCost(profile) {

    return (profile.packaging_profile_items || [])
        .reduce((total, item) => {

            const ingredient =
                item.ingredients;

            if (!ingredient) {
                return total;
            }

            return total +
                calculatePackagingItemCost(
                    ingredient,
                    item.quantity
                );

        }, 0);

}

function calculatePackagingItemCost(
    ingredient,
    quantityUsed
) {

    const purchasePrice =
        Number(ingredient.purchase_price) || 0;

    const purchaseSize =
        Number(ingredient.purchase_size) || 0;

    const quantity =
        Number(quantityUsed) || 0;

    if (purchaseSize <= 0) {
        return 0;
    }

    return (
        purchasePrice /
        purchaseSize *
        quantity
    );

}


/*==================================================
    PACKAGING MODAL
==================================================*/

function buildPackagingModal() {

    if (
        document.getElementById(
            "packagingProfileModal"
        )
    ) {
        return;
    }

    const modal =
        document.createElement("div");

    modal.id =
        "packagingProfileModal";

    modal.className =
        "modal-overlay";

    modal.style.display =
        "none";

    modal.innerHTML = `

        <div class="modal-card packaging-modal-card">

            <div class="modal-header">

                <div>

                    <p class="eyebrow">
                        PACKAGING PROFILE
                    </p>

                    <h2 id="packagingModalTitle">
                        New Profile
                    </h2>

                </div>

                <button
                    class="modal-close"
                    type="button"
                    onclick="closePackagingModal()"
                    aria-label="Close">

                    ✕

                </button>

            </div>

            <div class="modal-body">

                <input
                    id="packagingProfileId"
                    type="hidden">

                <label for="packagingProfileName">
                    Profile Name
                </label>

                <input
                    id="packagingProfileName"
                    type="text"
                    placeholder="Bread Loaf">

                <label for="packagingProductType">
                    Product Type
                </label>

                <input
                    id="packagingProductType"
                    type="text"
                    placeholder="Bread, Cookies, Cinnamon Rolls">

                <label for="packagingProfileDescription">
                    Description
                </label>

                <textarea
                    id="packagingProfileDescription"
                    rows="3"
                    placeholder="Optional notes about this packaging setup."></textarea>

                <div class="packaging-modal-section-header">

                    <div>

                        <h3>
                            Items Used
                        </h3>

                        <p>
                            Select items already tracked in Inventory.
                        </p>

                    </div>

                    <button
                        class="secondary-btn"
                        type="button"
                        onclick="addPackagingItemRow()">

                        + Add Item

                    </button>

                </div>

                <div id="packagingItemRows"></div>

                <div class="packaging-live-total">

                    <span>
                        Estimated Packaging Cost
                    </span>

                    <strong id="packagingLiveCost">
                        $0.00
                    </strong>

                </div>

            </div>

            <div class="modal-footer">

                <button
                    class="secondary-btn"
                    type="button"
                    onclick="closePackagingModal()">

                    Cancel

                </button>

                <button
                    class="primary-btn"
                    type="button"
                    onclick="savePackagingProfile()">

                    Save Profile

                </button>

            </div>

        </div>

    `;

    document.body.appendChild(modal);

}


/*==================================================
    OPEN AND CLOSE MODAL
==================================================*/

function openPackagingModal(profileId = null) {

    const profile =
        profileId
            ? packagingProfiles.find(item =>
                String(item.id) === String(profileId)
            )
            : null;

    setPackagingValue(
        "packagingProfileId",
        profile?.id || ""
    );

    setPackagingValue(
        "packagingProfileName",
        profile?.name || ""
    );

    setPackagingValue(
        "packagingProductType",
        profile?.product_type || ""
    );

    setPackagingValue(
        "packagingProfileDescription",
        profile?.description || ""
    );

    setPackagingText(
        "packagingModalTitle",
        profile
            ? "Edit Profile"
            : "New Profile"
    );

    const rows =
        document.getElementById(
            "packagingItemRows"
        );

    rows.innerHTML = "";

    if (
        profile?.packaging_profile_items?.length
    ) {

        profile.packaging_profile_items
            .forEach(item => {

                addPackagingItemRow(
                    item.ingredient_id,
                    item.quantity
                );

            });

    } else {

        addPackagingItemRow();

    }

    updatePackagingLiveCost();

    document
        .getElementById("packagingProfileModal")
        .style.display = "flex";

}

function closePackagingModal() {

    document
        .getElementById("packagingProfileModal")
        .style.display = "none";

}


/*==================================================
    MODAL ITEM ROWS
==================================================*/

function addPackagingItemRow(
    ingredientId = "",
    quantity = 1
) {

    const container =
        document.getElementById(
            "packagingItemRows"
        );

    if (!container) return;

    const row =
        document.createElement("div");

    row.className =
        "packaging-item-editor-row";

    row.innerHTML = `

        <div class="packaging-item-editor-fields">

            <div>

                <label>
                    Inventory Item
                </label>

                <select
                    class="packagingIngredientSelect"
                    onchange="updatePackagingLiveCost()">

                    <option value="">
                        Choose an item
                    </option>

                    ${packagingInventoryItems
                        .map(item => `

                            <option value="${item.id}">

                                ${escapePackagingHtml(item.name)}

                            </option>

                        `)
                        .join("")}

                </select>

            </div>

            <div>

                <label>
                    Quantity Used
                </label>

                <input
                    class="packagingQuantityInput"
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    value="${Number(quantity) || 1}"
                    oninput="updatePackagingLiveCost()">

            </div>

        </div>

        <div class="packaging-item-editor-cost">

            <span>
                Item Cost
            </span>

            <strong class="packagingRowCost">
                $0.00
            </strong>

        </div>

        <button
            class="delete-btn"
            type="button"
            onclick="
                this.closest('.packaging-item-editor-row').remove();
                updatePackagingLiveCost();
            ">

            Remove

        </button>

    `;

    container.appendChild(row);

    row
        .querySelector(
            ".packagingIngredientSelect"
        )
        .value = String(ingredientId || "");

    updatePackagingLiveCost();

}


/*==================================================
    LIVE COST PREVIEW
==================================================*/

function updatePackagingLiveCost() {

    const rows =
        [
            ...document.querySelectorAll(
                ".packaging-item-editor-row"
            )
        ];

    let total = 0;

    rows.forEach(row => {

        const ingredientId =
            row.querySelector(
                ".packagingIngredientSelect"
            ).value;

        const quantity =
            Number(
                row.querySelector(
                    ".packagingQuantityInput"
                ).value
            ) || 0;

        const ingredient =
            packagingInventoryItems.find(item =>
                String(item.id) ===
                String(ingredientId)
            );

        const rowCost =
            ingredient
                ? calculatePackagingItemCost(
                    ingredient,
                    quantity
                )
                : 0;

        total += rowCost;

        const costElement =
            row.querySelector(
                ".packagingRowCost"
            );

        costElement.textContent =
            usdPackaging(rowCost);

    });

    setPackagingText(
        "packagingLiveCost",
        usdPackaging(total)
    );

}


/*==================================================
    SAVE PROFILE
==================================================*/

async function savePackagingProfile() {

    const id =
        document.getElementById(
            "packagingProfileId"
        ).value;

    const name =
        document.getElementById(
            "packagingProfileName"
        ).value.trim();

    const productType =
        document.getElementById(
            "packagingProductType"
        ).value.trim();

    const description =
        document.getElementById(
            "packagingProfileDescription"
        ).value.trim();

    if (!name) {

        alert(
            "Please enter a packaging profile name."
        );

        return;

    }

    const profilePayload = {

        name,

        product_type:
            productType || null,

        description:
            description || null,

        is_active: true

    };

    let savedProfile;

    if (id) {

        const { data, error } =
            await supabaseClient
                .from("packaging_profiles")
                .update(profilePayload)
                .eq("id", id)
                .select()
                .single();

        if (error) {

            console.error(error);
            alert(error.message);

            return;

        }

        savedProfile = data;

    } else {

        const { data, error } =
            await supabaseClient
                .from("packaging_profiles")
                .insert(profilePayload)
                .select()
                .single();

        if (error) {

            console.error(error);
            alert(error.message);

            return;

        }

        savedProfile = data;

    }

    const rows =
        [
            ...document.querySelectorAll(
                ".packaging-item-editor-row"
            )
        ];

    const profileItems =
        rows
            .map(row => ({

                profile_id:
                    savedProfile.id,

                ingredient_id:
                    valueOrNullPackaging(
                        row.querySelector(
                            ".packagingIngredientSelect"
                        ).value
                    ),

                quantity:
                    Number(
                        row.querySelector(
                            ".packagingQuantityInput"
                        ).value
                    )

            }))
            .filter(item =>
                item.ingredient_id &&
                item.quantity > 0
            );

    const duplicateIds =
        profileItems
            .map(item =>
                String(item.ingredient_id)
            )
            .filter(
                (item, index, values) =>
                    values.indexOf(item) !== index
            );

    if (duplicateIds.length) {

        alert(
            "Each inventory item can only be added once per profile."
        );

        return;

    }

    const { error: deleteError } =
        await supabaseClient
            .from("packaging_profile_items")
            .delete()
            .eq(
                "profile_id",
                savedProfile.id
            );

    if (deleteError) {

        console.error(deleteError);
        alert(deleteError.message);

        return;

    }

    if (profileItems.length) {

        const { error: itemError } =
            await supabaseClient
                .from("packaging_profile_items")
                .insert(profileItems);

        if (itemError) {

            console.error(itemError);
            alert(itemError.message);

            return;

        }

    }

    closePackagingModal();

    await loadPackagingPage();

}


/*==================================================
    DUPLICATE PROFILE
==================================================*/

async function duplicatePackagingProfile(id) {

    const original =
        packagingProfiles.find(profile =>
            String(profile.id) === String(id)
        );

    if (!original) return;

    const { data: copy, error } =
        await supabaseClient
            .from("packaging_profiles")
            .insert({

                name:
                    `${original.name} Copy`,

                description:
                    original.description,

                product_type:
                    original.product_type,

                is_active:
                    original.is_active !== false

            })
            .select()
            .single();

    if (error) {

        console.error(error);
        alert(error.message);

        return;

    }

    const copiedItems =
        original.packaging_profile_items
            .map(item => ({

                profile_id:
                    copy.id,

                ingredient_id:
                    item.ingredient_id,

                quantity:
                    item.quantity

            }));

    if (copiedItems.length) {

        const { error: itemError } =
            await supabaseClient
                .from("packaging_profile_items")
                .insert(copiedItems);

        if (itemError) {

            console.error(itemError);
            alert(itemError.message);

            return;

        }

    }

    await loadPackagingPage();

}


/*==================================================
    DELETE PROFILE
==================================================*/

async function deletePackagingProfile(
    id,
    name
) {

    const confirmed =
        confirm(
            `Delete the "${name}" packaging profile?`
        );

    if (!confirmed) return;

    const { error } =
        await supabaseClient
            .from("packaging_profiles")
            .delete()
            .eq("id", id);

    if (error) {

        console.error(error);
        alert(error.message);

        return;

    }

    await loadPackagingPage();

}


/*==================================================
    HELPERS
==================================================*/

function usdPackaging(value) {

    return new Intl.NumberFormat(
        "en-US",
        {
            style: "currency",
            currency: "USD"
        }
    ).format(
        Number(value) || 0
    );

}

function formatPackagingQuantity(value) {

    const number =
        Number(value) || 0;

    return Number.isInteger(number)
        ? String(number)
        : number.toFixed(4)
            .replace(/0+$/, "")
            .replace(/\.$/, "");

}

function valueOrNullPackaging(value) {

    return value === "" ||
           value === null ||
           value === undefined
        ? null
        : value;

}

function setPackagingText(id, value) {

    const element =
        document.getElementById(id);

    if (element) {
        element.textContent = value;
    }

}

function setPackagingValue(id, value) {

    const element =
        document.getElementById(id);

    if (element) {
        element.value = value;
    }

}

function escapePackagingHtml(value) {

    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

}

function escapePackagingJs(value) {

    return String(value ?? "")
        .replaceAll("\\", "\\\\")
        .replaceAll("'", "\\'")
        .replaceAll("\n", "\\n")
        .replaceAll("\r", "");

}

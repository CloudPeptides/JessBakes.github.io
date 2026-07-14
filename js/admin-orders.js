/* ==========================================
   ADMIN ORDERS
========================================== */

document.addEventListener("DOMContentLoaded", async () => {

    await requireAuth();

    setupLogout();

    await loadMenuItems();

    await loadOrderManager();

});

let menuItems = [];
let manualOrderItems = {};


/* ==========================================
   MENU ITEMS FOR MANUAL ORDERS
========================================== */

async function loadMenuItems() {

    const { data, error } = await supabaseClient
        .from("menu_items")
        .select("*")
        .eq("available", true)
        .order("category", { ascending: true })
        .order("sort_order", { ascending: true });

    if (error) {

        console.error(error);

        menuItems = [];

        return;

    }

    menuItems = data || [];

}


/* ==========================================
   ORDER MANAGER
========================================== */

async function loadOrderManager() {

    const orderContainer = document.getElementById("orderManager");

    if (!orderContainer) return;

    orderContainer.innerHTML = "<p>Loading orders...</p>";

    const { data: orders, error } = await supabaseClient
        .from("orders")
        .select(`
            *,
            order_items(*)
        `)
        .order("created_at", { ascending: false });

    if (error) {

        console.error(error);

        orderContainer.innerHTML = `
            <p>Unable to load orders.</p>
        `;

        return;

    }

    const safeOrders = orders || [];

    setText(
        "pendingCount",
        safeOrders.filter(order => order.status === "pending").length
    );

    setText(
        "confirmedCount",
        safeOrders.filter(order => order.status === "confirmed").length
    );

    setText(
        "readyCount",
        safeOrders.filter(order => order.status === "ready").length
    );

    setText(
        "completedCount",
        safeOrders.filter(order => order.status === "completed").length
    );

    renderOrderManager(safeOrders);

}


/* ==========================================
   RENDER ORDERS
========================================== */

function renderOrderManager(orders) {

    const container = document.getElementById("orderManager");

    if (!container) return;

    if (!orders.length) {

        container.innerHTML = `
            <p>No orders yet.</p>
        `;

        return;

    }

    const pending = orders.filter(order => order.status === "pending");
    const confirmed = orders.filter(order => order.status === "confirmed");
    const ready = orders.filter(order => order.status === "ready");
    const completed = orders.filter(order => order.status === "completed");
    const cancelled = orders.filter(order => order.status === "cancelled");

    container.innerHTML = `
        <div class="orders-overview">

            <div class="order-status-card">
                <strong>Pending</strong>
                <span>${pending.length}</span>
            </div>

            <div class="order-status-card">
                <strong>Confirmed</strong>
                <span>${confirmed.length}</span>
            </div>

            <div class="order-status-card">
                <strong>Ready</strong>
                <span>${ready.length}</span>
            </div>

            <div class="order-status-card">
                <strong>Completed</strong>
                <span>${completed.length}</span>
            </div>

            <div class="order-status-card">
                <strong>Cancelled</strong>
                <span>${cancelled.length}</span>
            </div>

        </div>

        ${renderOrderSection("Pending Orders", pending)}
        ${renderOrderSection("Confirmed Orders", confirmed)}
        ${renderOrderSection("Ready for Pickup", ready)}
        ${renderOrderSection("Completed", completed)}
        ${renderOrderSection("Cancelled", cancelled)}
    `;

}

function renderOrderSection(title, orders) {

    const sectionId = title
        .toLowerCase()
        .replace(/\s+/g, "-");

    return `
        <section class="order-section">

            <button
                class="order-section-header"
                onclick="toggleOrderSection('${sectionId}')">

                <div>
                    <h3>${title}</h3>

                    <small>
                        ${orders.length}
                        order${orders.length === 1 ? "" : "s"}
                    </small>
                </div>

                <span id="${sectionId}-icon">
                    ${orders.length ? "▼" : "►"}
                </span>

            </button>

            <div
                id="${sectionId}"
                style="display:${orders.length ? "block" : "none"};">

                ${
                    orders.length
                        ? orders.map(renderOrderCard).join("")
                        : `<p class="empty-orders">No orders.</p>`
                }

            </div>

        </section>
    `;

}

function toggleOrderSection(id) {

    const section = document.getElementById(id);
    const icon = document.getElementById(id + "-icon");

    if (!section || !icon) return;

    if (section.style.display === "none") {

        section.style.display = "block";
        icon.textContent = "▼";

    } else {

        section.style.display = "none";
        icon.textContent = "►";

    }

}


/* ==========================================
   ORDER CARD
========================================== */

function renderOrderCard(order) {

    const items = order.order_items || [];

    const totalItems = items.reduce(
        (sum, item) => sum + Number(item.quantity || 0),
        0
    );

    return `
        <article class="order-card">

            <div class="order-card-header">

                <div>
                    <h3>${escapeHtml(order.customer_name)}</h3>

                    <div class="customer-contact">
                        📱 ${escapeHtml(order.customer_phone)}
                    </div>

                    ${
                        order.customer_email
                            ? `
                                <div class="customer-contact">
                                    📧 ${escapeHtml(order.customer_email)}
                                </div>
                            `
                            : ""
                    }

                    <div style="margin-top:10px;">
                        <span class="order-type-badge ${
                            order.order_type === "custom"
                                ? "order-type-custom"
                                : "order-type-weekly"
                        }">
                            ${
                                order.order_type === "custom"
                                    ? "🎂 Custom Order"
                                    : "🧺 Weekly Pickup"
                            }
                        </span>
                    </div>
                </div>

                <div>
                    <span class="status-badge status-${order.status}">
                        ${capitalize(order.status)}
                    </span>
                </div>

            </div>

            <div class="order-meta">

                <div>
                    <strong>
                        ${
                            order.order_type === "custom"
                                ? "Needed By"
                                : "Pickup"
                        }
                    </strong>

                    <p>
                        ${
                            order.order_type === "custom"
                                ? (
                                    order.event_date
                                        ? formatDate(order.event_date)
                                        : "No event date selected"
                                )
                                : `
                                    ${formatDate(order.pickup_date)}
                                    <br>
                                    <small>12:30 PM</small>
                                `
                        }
                    </p>
                </div>

                <div>
                    <strong>Total</strong>
                    <p>€${Number(order.subtotal || 0).toFixed(2)}</p>
                </div>

                <div>
                    <strong>Items</strong>
                    <p>${totalItems}</p>
                </div>

                <div>
                    <strong>Preferred Contact</strong>
                    <p>
                        ${
                            order.preferred_contact === "email"
                                ? "Email"
                                : "Text Message"
                        }
                    </p>
                </div>

                <div>
                    <strong>Order Placed</strong>
                    <p>${formatDate(order.created_at)}</p>
                </div>

            </div>

            ${
                order.notes
                    ? `
                        <div class="order-notes">
                            <strong>Special Instructions</strong>

                            <p>
                                ${escapeHtml(order.notes).replace(/\n/g, "<br>")}
                            </p>
                        </div>
                    `
                    : ""
            }

            <div class="order-items">
                <strong>Items Ordered</strong>
                ${renderOrderItems(items)}
            </div>

            <div class="order-actions">
                ${renderStatusButtons(order)}

                <button
                    class="delete-btn"
                    onclick="deleteOrder('${order.id}')">
                    Delete
                </button>
            </div>

        </article>
    `;

}


/* ==========================================
   ORDER ITEMS
========================================== */

function renderOrderItems(items) {

    if (!items.length) {
        return `<p>No items.</p>`;
    }

    return `
        <div class="order-items-list">
            ${items.map(item => `
                <div class="order-item-row">

                    <div class="order-item-left">
                        <span class="order-item-qty">
                            ${item.quantity}×
                        </span>

                        <span class="order-item-name">
                            ${escapeHtml(item.item_name)}
                        </span>
                    </div>

                    <div class="order-item-right">
                        €${Number(item.line_total || 0).toFixed(2)}
                    </div>

                </div>
            `).join("")}
        </div>
    `;

}


/* ==========================================
   STATUS BUTTONS
========================================== */

function renderStatusButtons(order) {

    switch (order.status) {

        case "pending":
            return `
                <button
                    class="approve-btn"
                    onclick="updateOrderStatus('${order.id}','confirmed')">
                    Confirm
                </button>

                <button
                    class="remove-option-btn"
                    onclick="updateOrderStatus('${order.id}','cancelled')">
                    Cancel
                </button>
            `;

        case "confirmed":
            return `
                <button
                    class="approve-btn"
                    onclick="updateOrderStatus('${order.id}','ready')">
                    Ready
                </button>

                <button
                    class="remove-option-btn"
                    onclick="updateOrderStatus('${order.id}','cancelled')">
                    Cancel
                </button>
            `;

        case "ready":
            return `
                <button
                    class="approve-btn"
                    onclick="updateOrderStatus('${order.id}','completed')">
                    Complete
                </button>
            `;

        case "completed":
            return `
                <span class="order-finished">
                    Completed
                </span>
            `;

        case "cancelled":
            return `
                <span class="order-finished">
                    Cancelled
                </span>
            `;

        default:
            return "";

    }

}


/* ==========================================
   UPDATE STATUS
========================================== */

async function updateOrderStatus(orderId, status) {

    const { error } = await supabaseClient
        .from("orders")
        .update({ status })
        .eq("id", orderId);

    if (error) {

        console.error(error);
        alert(error.message);
        return;

    }

    if (status === "Completed") {

        await createSaleFromOrder(orderId);

    }

    await loadOrderManager();

}

async function createSaleFromOrder(orderId) {

    const { data: order, error: orderError } =
        await supabaseClient
            .from("orders")
            .select("*")
            .eq("id", orderId)
            .single();

    if (orderError) {

        console.error(orderError);
        return;

    }

    const { data: items, error: itemsError } =
        await supabaseClient
            .from("order_items")
            .select("*")
            .eq("order_id", orderId);

    if (itemsError) {

        console.error(itemsError);
        return;

    }

    console.log("ORDER", order);

    console.log("ITEMS", items);

}

/* ==========================================
   DELETE
========================================== */

async function deleteOrder(orderId) {

    if (!confirm("Delete this order?")) return;

    const { error } = await supabaseClient
        .from("orders")
        .delete()
        .eq("id", orderId);

    if (error) {

        console.error(error);
        alert(error.message);
        return;

    }

    await loadOrderManager();

}


/* ==========================================
   MANUAL ORDER MODAL
========================================== */

function openManualOrderModal() {

    manualOrderItems = {};

    const modal = document.getElementById("manualOrderModal");

    if (!modal) return;

    resetManualOrderForm();

    modal.style.display = "flex";

    renderManualMenuItems();

    updateManualOrderSummary();

}

function closeManualOrderModal() {

    const modal = document.getElementById("manualOrderModal");

    if (modal) {
        modal.style.display = "none";
    }

}

function resetManualOrderForm() {

    setInputValue("manualCustomerName", "");
    setInputValue("manualCustomerPhone", "");
    setInputValue("manualCustomerEmail", "");
    setInputValue("manualContact", "text");
    setInputValue("manualSource", "website");
    setInputValue("manualOrderType", "weekly");
    setInputValue("manualPickupDate", getNextSundayForManualOrder());
    setInputValue("manualEventDate", "");
    setInputValue("manualCustomPickupDate", "");
    setInputValue("manualNotes", "");
    setInputValue("manualStatus", "pending");

    toggleManualOrderType();

}

function toggleManualOrderType() {

    const orderType = document.getElementById("manualOrderType")?.value || "weekly";
    const isCustom = orderType === "custom";

    const weeklyFields = document.getElementById("weeklyFields");
    const customFields = document.getElementById("customFields");

    if (weeklyFields) {
        weeklyFields.style.display = isCustom ? "none" : "block";
    }

    if (customFields) {
        customFields.style.display = isCustom ? "block" : "none";
    }

}

function renderManualMenuItems() {

    const container = document.getElementById("manualItems");

    if (!container) return;

    if (!menuItems.length) {

        container.innerHTML = `
            <p>No available menu items found.</p>
        `;

        return;

    }

    container.innerHTML = `
        <div class="manual-pos-list">
            ${menuItems.map(item => renderManualMenuItem(item)).join("")}
        </div>

        <div class="manual-order-summary">
            <div>
                <span>Total Items</span>
                <strong id="manualTotalItems">0</strong>
            </div>

            <div>
                <span>Subtotal</span>
                <strong id="manualSubtotal">€0.00</strong>
            </div>
        </div>
    `;

}

function renderManualMenuItem(item) {

    const price = Number(item.price || 0);

    return `
        <div class="manual-pos-item">

            <div>
                <strong>${escapeHtml(item.name)}</strong>

                <small>
                    ${escapeHtml(item.category || "Menu")}
                    •
                    €${price.toFixed(2)}
                </small>
            </div>

            <div class="manual-pos-controls">

                <button
                    type="button"
                    class="secondary-btn"
                    onclick="changeManualItemQuantity('${item.id}', -1)">
                    −
                </button>

                <span id="manualQty-${item.id}">
                    0
                </span>

                <button
                    type="button"
                    class="primary-btn"
                    onclick="changeManualItemQuantity('${item.id}', 1)">
                    +
                </button>

            </div>

        </div>
    `;

}

function changeManualItemQuantity(itemId, change) {

    const item = menuItems.find(menuItem => String(menuItem.id) === String(itemId));

    if (!item) return;

    const current = manualOrderItems[itemId]?.quantity || 0;
    const next = Math.max(0, current + change);

    if (next === 0) {

        delete manualOrderItems[itemId];

    } else {

        manualOrderItems[itemId] = {
            id: item.id,
            name: item.name,
            price: Number(item.price || 0),
            quantity: next
        };

    }

    const qtyElement = document.getElementById(`manualQty-${itemId}`);

    if (qtyElement) {
        qtyElement.textContent = next;
    }

    updateManualOrderSummary();

}

function updateManualOrderSummary() {

    const items = getManualOrderItems();

    const totalItems = items.reduce(
        (sum, item) => sum + item.quantity,
        0
    );

    const subtotal = getManualOrderSubtotal();

    setText("manualTotalItems", totalItems);
    setText("manualSubtotal", `€${subtotal.toFixed(2)}`);

}

function getManualOrderItems() {

    return Object.values(manualOrderItems);

}

function getManualOrderSubtotal() {

    return getManualOrderItems().reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
    );

}

async function saveManualOrder() {

    const customer_name = document.getElementById("manualCustomerName")?.value.trim();
    const customer_phone = document.getElementById("manualCustomerPhone")?.value.trim();
    const customer_email = document.getElementById("manualCustomerEmail")?.value.trim();
    const preferred_contact = document.getElementById("manualContact")?.value || "text";
    const source = document.getElementById("manualSource")?.value || "manual";
    const order_type = document.getElementById("manualOrderType")?.value || "weekly";
    const status = document.getElementById("manualStatus")?.value || "pending";
    const notesRaw = document.getElementById("manualNotes")?.value.trim();

    let pickup_date = null;
    let event_date = null;

    if (!customer_name) {
        alert("Please enter the customer name.");
        return;
    }

    if (!customer_phone) {
        alert("Please enter the customer phone number.");
        return;
    }

    const items = getManualOrderItems();

    if (!items.length) {
        alert("Please add at least one item.");
        return;
    }

    if (order_type === "weekly") {

        pickup_date = document.getElementById("manualPickupDate")?.value;

        if (!pickup_date) {
            alert("Please select a pickup date.");
            return;
        }

    } else {

        event_date = document.getElementById("manualEventDate")?.value;
        pickup_date = document.getElementById("manualCustomPickupDate")?.value;

        if (!event_date) {
            alert("Please select an event date.");
            return;
        }

        if (!pickup_date) {
            alert("Please select a pickup date.");
            return;
        }

    }

    const sourceLabel = getSourceLabel(source);

    const notes = [
        sourceLabel ? `Source: ${sourceLabel}` : "",
        notesRaw || ""
    ]
        .filter(Boolean)
        .join("\n\n");

    const subtotal = getManualOrderSubtotal();

    const { data: order, error } = await supabaseClient
        .from("orders")
        .insert({
            customer_name,
            customer_phone,
            customer_email,
            preferred_contact,
            order_type,
            pickup_date,
            event_date,
            notes,
            subtotal,
            status
        })
        .select()
        .single();

    if (error) {

        console.error(error);
        alert(error.message);
        return;

    }

    const orderItems = items.map(item => ({
        order_id: order.id,
        menu_item_id: item.id,
        item_name: item.name,
        quantity: item.quantity,
        price_at_purchase: item.price,
        line_total: item.price * item.quantity
    }));

    const { error: itemError } = await supabaseClient
        .from("order_items")
        .insert(orderItems);

    if (itemError) {

        console.error(itemError);
        alert(itemError.message);
        return;

    }

    closeManualOrderModal();

    await loadOrderManager();

}


/* ==========================================
   MANUAL ORDER HELPERS
========================================== */

function getNextSundayForManualOrder() {

    const today = new Date();
    const day = today.getDay();

    const daysUntilSunday =
        day === 0
            ? 7
            : 7 - day;

    const pickup = new Date(today);

    pickup.setDate(today.getDate() + daysUntilSunday);

    return pickup.toISOString().split("T")[0];

}

function getSourceLabel(source) {

    const labels = {
        website: "Website",
        facebook: "Facebook",
        messenger: "Messenger",
        instagram: "Instagram",
        phone: "Phone",
        text: "Text Message",
        in_person: "In Person",
        other: "Other",
        manual: "Manual"
    };

    return labels[source] || source;

}


/* ==========================================
   HELPERS
========================================== */

function capitalize(text) {

    const value = String(text || "");

    return value.charAt(0).toUpperCase() + value.slice(1);

}

function escapeHtml(text) {

    return String(text || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

}

function formatDate(date) {

    if (!date) return "Not set";

    return new Date(date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
    });

}

function setText(id, value) {

    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }

}

function setInputValue(id, value) {

    const element = document.getElementById(id);

    if (element) {
        element.value = value;
    }

}


/* ==========================================
   GLOBAL EXPORTS
========================================== */

window.toggleOrderSection = toggleOrderSection;
window.updateOrderStatus = updateOrderStatus;
window.deleteOrder = deleteOrder;

window.openManualOrderModal = openManualOrderModal;
window.closeManualOrderModal = closeManualOrderModal;
window.toggleManualOrderType = toggleManualOrderType;
window.changeManualItemQuantity = changeManualItemQuantity;
window.saveManualOrder = saveManualOrder;

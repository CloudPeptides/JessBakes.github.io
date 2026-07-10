document.addEventListener("DOMContentLoaded", async () => {

    await requireAuth();

    setupLogout();

    loadOrderManager();

});


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

document.getElementById("pendingCount").textContent =
    orders.filter(o => o.status === "pending").length;

document.getElementById("confirmedCount").textContent =
    orders.filter(o => o.status === "confirmed").length;

document.getElementById("readyCount").textContent =
    orders.filter(o => o.status === "ready").length;

document.getElementById("completedCount").textContent =
    orders.filter(o => o.status === "completed").length;

renderOrderManager(orders);
}

/* ==========================================
   RENDER
========================================== */

function renderOrderManager(orders) {

    const container = document.getElementById("orderManager");

    if (!orders.length) {

        container.innerHTML = `
            <p>No orders yet.</p>
        `;

        return;

    }

    const pending = orders.filter(o => o.status === "pending");
    const confirmed = orders.filter(o => o.status === "confirmed");
    const ready = orders.filter(o => o.status === "ready");
    const completed = orders.filter(o => o.status === "completed");
    const cancelled = orders.filter(o => o.status === "cancelled");

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

/* ==========================================
   ORDER SECTION
========================================== */

function renderOrderSection(title, orders) {

    return `

<section class="order-section">

<h3>${title}</h3>

${
    !orders.length
        ? `<p class="empty-orders">None</p>`
        : orders.map(renderOrderCard).join("")
}

</section>

`;

}

/* ==========================================
   ORDER CARD
========================================== */

function renderOrderCard(order) {

    const totalItems = order.order_items.reduce(
        (sum, item) => sum + item.quantity,
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

            <p>

                €${Number(order.subtotal).toFixed(2)}

            </p>

        </div>

        <div>

            <strong>Items</strong>

            <p>

                ${totalItems}

            </p>

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

            <p>

                ${formatDate(order.created_at)}

            </p>

        </div>

    </div>

    ${
        order.order_type === "custom" && order.notes

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

        ${renderOrderItems(order.order_items)}

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

                        €${Number(item.line_total).toFixed(2)}

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
        .update({
            status
        })
        .eq("id", orderId);

    if (error) {

        console.error(error);

        alert(error.message);

        return;

    }

    loadOrderManager();

}

/* ==========================================
   DELETE
========================================== */

async function deleteOrder(orderId) {

    if (!confirm("Delete this order?")) {
        return;
    }

    const { error } = await supabaseClient
        .from("orders")
        .delete()
        .eq("id", orderId);

    if (error) {

        console.error(error);

        alert(error.message);

        return;

    }

    loadOrderManager();

}

/* ==========================================
   HELPERS
========================================== */

function capitalize(text) {

    return text.charAt(0).toUpperCase() +
           text.slice(1);

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

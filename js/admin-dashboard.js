/*==================================================
    PAGE INITIALIZATION
==================================================*/

document.addEventListener("DOMContentLoaded", async () => {
    await requireAuth();

    setupLogout();
    updateGreeting();

    await Promise.all([
        loadDashboardOrders(),
        loadDashboardReviews()
    ]);

    document.getElementById("inventoryAlerts").textContent = "0";
});


/*==================================================
    DASHBOARD HEADER
==================================================*/

function updateGreeting() {
    const greeting = document.getElementById("dashboardGreeting");
    const date = document.getElementById("dashboardDate");

    const hour = new Date().getHours();

    let message = "Good Morning,";

    if (hour >= 12) {
        message = "Good Afternoon,";
    }

    if (hour >= 17) {
        message = "Good Evening,";
    }

    greeting.textContent = message;

    date.textContent = new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric"
    });
}


/*==================================================
    ORDERS
==================================================*/

async function loadDashboardOrders() {
    const { data, error } = await supabaseClient
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) {
        console.error(error);
        return;
    }

    const orders = data || [];

    document.getElementById("orderCount").textContent =
        orders.filter(order => order.status === "pending").length;

    renderRecentOrders(orders.slice(0, 5));
    calculateRevenue(orders);
    renderUpcomingPickups(orders);
    buildNotifications(orders);
}

function renderRecentOrders(orders) {
    const container = document.getElementById("recentOrders");

    if (!orders.length) {
        container.innerHTML = "<p>No orders yet.</p>";
        return;
    }

    container.innerHTML = orders.map(order => `
        <div class="dashboard-order">
            <div>
                <strong>${escapeHtml(order.customer_name)}</strong>
                <small>${formatDate(order.created_at)}</small>
            </div>

            <span class="status-badge status-${order.status}">
                ${capitalize(order.status)}
            </span>
        </div>
    `).join("");
}


/*==================================================
    REVENUE
==================================================*/

function calculateRevenue(orders) {
    const today = new Date();

    let todayTotal = 0;
    let weekTotal = 0;

    orders.forEach(order => {
        if (order.status === "cancelled") return;

        const orderDate = new Date(order.created_at);
        const subtotal = Number(order.subtotal) || 0;

        if (isSameDay(today, orderDate)) {
            todayTotal += subtotal;
        }

        if (isThisWeek(today, orderDate)) {
            weekTotal += subtotal;
        }
    });

    document.getElementById("salesToday").textContent = euro(todayTotal);
    document.getElementById("salesWeek").textContent = euro(weekTotal);
}


/*==================================================
    UPCOMING PICKUPS
==================================================*/

function renderUpcomingPickups(orders) {
    const container = document.getElementById("upcomingPickups");

    const upcoming = orders
        .filter(order =>
            order.status === "confirmed" ||
            order.status === "ready"
        )
        .sort((a, b) => {
            const dateA = new Date(a.event_date || a.pickup_date || a.created_at);
            const dateB = new Date(b.event_date || b.pickup_date || b.created_at);

            return dateA - dateB;
        })
        .slice(0, 5);

    if (!upcoming.length) {
        container.innerHTML = "<p>No upcoming pickups.</p>";
        return;
    }

    container.innerHTML = upcoming.map(order => `
        <div class="dashboard-order">
            <div>
                <strong>${escapeHtml(order.customer_name)}</strong>
                <small>
                    ${formatDate(order.event_date || order.pickup_date || order.created_at)}
                </small>
            </div>

            <span>
                ${
                    order.order_type === "custom"
                        ? "Custom Order"
                        : "Weekly Pickup"
                }
            </span>
        </div>
    `).join("");
}


/*==================================================
    NOTIFICATIONS
==================================================*/

function buildNotifications(orders) {
    const panel = document.getElementById("notificationsPanel");
    const notes = [];

    const pending = orders.filter(order => order.status === "pending").length;

    if (pending) {
        notes.push(`${pending} pending order${pending === 1 ? "" : "s"}`);
    }

    const custom = orders.filter(order => order.order_type === "custom").length;

    if (custom) {
        notes.push(`${custom} custom order${custom === 1 ? "" : "s"}`);
    }

    if (!notes.length) {
        notes.push("Everything looks good today.");
    }

    panel.innerHTML = notes.map(note => `
        <div class="notification-item">
            ${escapeHtml(note)}
        </div>
    `).join("");
}


/*==================================================
    REVIEWS
==================================================*/

async function loadDashboardReviews() {
    const { data, error } = await supabaseClient
        .from("reviews")
        .select("*")
        .eq("approved", false)
        .order("created_at", { ascending: true });

    if (error) {
        console.error(error);
        return;
    }

    const reviews = data || [];

    document.getElementById("pendingReviewCount").textContent =
        reviews.length;

    renderRecentReviews(reviews.slice(0, 3));
}

function renderRecentReviews(reviews) {
    const container = document.getElementById("recentReviews");

    if (!reviews.length) {
        container.innerHTML = "<p>No pending reviews.</p>";
        return;
    }

    container.innerHTML = reviews.map(review => `
        <div class="dashboard-review">
            <strong>${escapeHtml(review.name)}</strong>
            <p>"${escapeHtml(review.review)}"</p>
        </div>
    `).join("");
}


/*==================================================
    HELPERS
==================================================*/

function euro(value) {
    return new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "EUR"
    }).format(value);
}

function isSameDay(a, b) {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

function isThisWeek(today, date) {
    const start = new Date(today);

    start.setDate(today.getDate() - today.getDay());
    start.setHours(0, 0, 0, 0);

    return date >= start;
}

function formatDate(date) {
    if (!date) return "Not set";

    return new Date(date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

function capitalize(text) {
    return String(text || "").charAt(0).toUpperCase() +
        String(text || "").slice(1);
}

function escapeHtml(text) {
    return String(text || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

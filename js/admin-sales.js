document.addEventListener("DOMContentLoaded", async () => {

    await requireAuth();

});

/* ==========================================
   PAGE INITIALIZATION
========================================== */

document.addEventListener("DOMContentLoaded", async () => {

    await requireAuth();

    setupLogout();

    loadSalesDashboard();

});


/* ==========================================
   SALES DASHBOARD
========================================== */

async function loadSalesDashboard() {

    const { data: orders, error } = await supabaseClient
        .from("orders")
        .select(`
            *,
            order_items(*)
        `)
        .order("created_at", { ascending: false });

    if (error) {

        console.error(error);

        return;

    }

    const completedOrders =
        orders.filter(order => order.status === "completed");

    updateSalesCards(completedOrders);

    renderRecentSales(completedOrders);

    renderBestSellers(completedOrders);

}


/* ==========================================
   SALES CARDS
========================================== */

function updateSalesCards(orders) {

    const today = new Date();

    let todayRevenue = 0;
    let weekRevenue = 0;
    let monthRevenue = 0;
    let totalRevenue = 0;

    orders.forEach(order => {

        const subtotal = Number(order.subtotal) || 0;

        const orderDate = new Date(order.created_at);

        totalRevenue += subtotal;

        if (isSameDay(today, orderDate)) {

            todayRevenue += subtotal;

        }

        if (isThisWeek(today, orderDate)) {

            weekRevenue += subtotal;

        }

        if (
            today.getMonth() === orderDate.getMonth() &&
            today.getFullYear() === orderDate.getFullYear()
        ) {

            monthRevenue += subtotal;

        }

    });

    document.getElementById("salesToday").textContent =
        euro(todayRevenue);

    document.getElementById("salesWeek").textContent =
        euro(weekRevenue);

    document.getElementById("salesMonth").textContent =
        euro(monthRevenue);

    document.getElementById("averageOrder").textContent =
        euro(
            orders.length
                ? totalRevenue / orders.length
                : 0
        );

}


/* ==========================================
   RECENT SALES
========================================== */

function renderRecentSales(orders) {

    const container =
        document.getElementById("recentSales");

    if (!container) return;

    if (!orders.length) {

        container.innerHTML = `
            <p>No completed sales yet.</p>
        `;

        return;

    }

    container.innerHTML = orders
        .slice(0, 10)
        .map(order => `

<div class="sale-row">

    <div>

        <strong>

            ${escapeHtml(order.customer_name)}

        </strong>

        <small>

            ${formatDate(order.created_at)}

        </small>

    </div>

    <strong>

        €${Number(order.subtotal).toFixed(2)}

    </strong>

</div>

`)
        .join("");

}


/* ==========================================
   BEST SELLERS
========================================== */

function renderBestSellers(orders) {

    const container =
        document.getElementById("bestSellers");

    if (!container) return;

    const totals = {};

    orders.forEach(order => {

        order.order_items.forEach(item => {

            if (!totals[item.item_name]) {

                totals[item.item_name] = 0;

            }

            totals[item.item_name] += item.quantity;

        });

    });

    const sorted =
        Object.entries(totals)
            .sort((a, b) => b[1] - a[1]);

    if (!sorted.length) {

        container.innerHTML = `
            <p>No sales yet.</p>
        `;

        return;

    }

    container.innerHTML =
        sorted.map(([name, qty]) => `

<div class="best-seller-row">

    <span>

        ${escapeHtml(name)}

    </span>

    <strong>

        ${qty} sold

    </strong>

</div>

`)
        .join("");

}


/* ==========================================
   HELPERS
========================================== */

function euro(value) {

    return new Intl.NumberFormat(
        "de-DE",
        {
            style: "currency",
            currency: "EUR"
        }
    ).format(value);

}

function formatDate(date) {

    return new Date(date).toLocaleDateString(
        "en-US",
        {
            month: "short",
            day: "numeric",
            year: "numeric"
        }
    );

}

function isSameDay(a, b) {

    return (
        a.getDate() === b.getDate() &&
        a.getMonth() === b.getMonth() &&
        a.getFullYear() === b.getFullYear()
    );

}

function isThisWeek(today, date) {

    const start = new Date(today);

    start.setDate(
        today.getDate() - today.getDay()
    );

    start.setHours(0, 0, 0, 0);

    return date >= start;

}

function escapeHtml(text) {

    return String(text || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

}

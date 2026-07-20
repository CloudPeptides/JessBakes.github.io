/*==================================================
    ADMIN SALES DASHBOARD
==================================================*/

let salesOrders = [];
let salesMenuItems = [];

let salesRecipes = [];
let salesRecipeIngredients = [];
let salesIngredients = [];
let salesPackagingItems = [];
let salesPackagingProfiles = [];

let revenueChart = null;
let categoryChart = null;
let currentSalesRange = "today";


document.addEventListener("DOMContentLoaded", async () => {
    await requireAuth();

    if (typeof setupLogout === "function") {
        setupLogout();
    }

    try {
        await ensureChartJs();
        bindSalesControls();
        await loadSalesDashboard();
    } catch (error) {
        console.error("Sales dashboard failed to initialize:", error);
    }
});

function ensureChartJs() {
    if (window.Chart) return Promise.resolve();

    return new Promise((resolve, reject) => {
        const existing = document.querySelector('script[src*="chart.js"]');

        if (existing) {
            existing.addEventListener("load", resolve, { once: true });
            existing.addEventListener("error", reject, { once: true });
            return;
        }

        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/chart.js";
        script.onload = resolve;
        script.onerror = () => reject(new Error("Chart.js could not be loaded."));
        document.head.appendChild(script);
    });
}

function bindSalesControls() {
    document.querySelectorAll(".sales-filters .filter-btn").forEach((button) => {
        button.addEventListener("click", () => {
            document.querySelectorAll(".sales-filters .filter-btn")
                .forEach((item) => item.classList.remove("active"));

            button.classList.add("active");
            currentSalesRange = normalizeRange(button.textContent);
            renderSalesDashboard();
        });
    });

    document.getElementById("exportCsv")?.addEventListener("click", exportSalesCsv);
    document.getElementById("exportExcel")?.addEventListener("click", exportSalesCsv);
    document.getElementById("printSales")?.addEventListener("click", () => window.print());
}

async function loadSalesDashboard() {
    const [
    ordersResult,
    menuResult,
    recipesResult,
    recipeIngredientsResult,
    ingredientsResult,
    packagingItemsResult,
    packagingProfilesResult
] = await Promise.all([

    supabaseClient
        .from("sales")
        .select(`
            *,
            sale_items(*)
        `)
        .order("completed_at", { ascending: false }),

    supabaseClient
        .from("menu_items")
        .select(`
            id,
            name,
            category,
            recipe_id,
            recipe_units_used,
            packaging_profile_id
        `),

    supabaseClient
        .from("recipes")
        .select("*"),

    supabaseClient
        .from("recipe_ingredients")
        .select("*"),

    supabaseClient
        .from("ingredients")
        .select("*"),

    supabaseClient
        .from("packaging_profile_items")
        .select("*"),

    supabaseClient
        .from("packaging_profiles")
        .select("*")
]);

    if (ordersResult.error) {
        console.error("Unable to load orders:", ordersResult.error);
        showSalesError("Unable to load sales data.");
        return;
    }

    if (menuResult.error) {
        console.warn("Unable to load menu categories:", menuResult.error);
    }

 salesOrders = (ordersResult.data || []).map((sale) => ({
    ...sale,

    subtotal: Number(sale.revenue) || 0,

    order_items: Array.isArray(sale.sale_items)
        ? sale.sale_items
        : []

}));

console.log(
    salesOrders.map(s => ({
        customer: s.customer_name,
        revenue: s.revenue,
        completed_at: s.completed_at
    }))
);

salesMenuItems = menuResult.data || [];

    salesRecipes = recipesResult.data || [];
salesRecipeIngredients = recipeIngredientsResult.data || [];
salesIngredients = ingredientsResult.data || [];
salesPackagingItems = packagingItemsResult.data || [];
salesPackagingProfiles = packagingProfilesResult.data || [];

renderSalesDashboard();
}

function calculateSaleCost(item) {

    const menuItem = salesMenuItems.find(
        m => String(m.id) === String(item.menu_item_id)
    );

    if (!menuItem) return 0;

    let totalCost = 0;


    // Recipe cost
    const recipeIngredients =
        salesRecipeIngredients.filter(
            ri =>
                String(ri.recipe_id) ===
                String(menuItem.recipe_id)
        );


    recipeIngredients.forEach(ri => {

        const ingredient =
            salesIngredients.find(
                i =>
                String(i.id) ===
                String(ri.ingredient_id)
            );

        if (!ingredient) return;


        const costPerGram =
            Number(ingredient.purchase_price) /
            Number(ingredient.purchase_size);


        totalCost +=
            Number(ri.quantity || 0) *
            costPerGram;

    });


    // Packaging cost
    const packaging =
        salesPackagingItems.filter(
            p =>
            String(p.profile_id) ===
            String(menuItem.packaging_profile_id)
        );


    packaging.forEach(p => {

        const ingredient =
            salesIngredients.find(
                i =>
                String(i.id) ===
                String(p.ingredient_id)
            );

        if (!ingredient) return;


        const cost =
            (Number(ingredient.purchase_price) /
            Number(ingredient.purchase_size))
            *
            Number(p.quantity || 0);


        totalCost += cost;

    });


    return totalCost *
        Number(item.quantity || 1);

}

function renderSalesDashboard() {

    const completedOrders = salesOrders;

    const activeOrders = [];

    updateSalesCards(completedOrders, activeOrders);
    updateLifetimeCards(completedOrders);

    const filteredCompleted = filterOrdersByRange(completedOrders, currentSalesRange);

    renderRevenueTrend(filteredCompleted, currentSalesRange);
    renderCategoryRevenue(filteredCompleted);
    renderBestSellers(filteredCompleted);
    renderRecentSales(filteredCompleted);
    renderSalesForecast(completedOrders);
    renderBusinessInsights(completedOrders, activeOrders);
    renderMonthlyRevenue(completedOrders);
    renderProfitBreakdown(filteredCompleted);
}

function updateSalesCards(completedOrders, activeOrders) {
    const now = new Date();

    const todayRevenue = sumRevenue(
        completedOrders.filter((order) => isSameDay(now, new Date(order.completed_at)))
    );

    const weekRevenue = sumRevenue(
        completedOrders.filter((order) => isThisWeek(new Date(order.completed_at), now))
    );

    const monthRevenue = sumRevenue(
        completedOrders.filter((order) => isSameMonth(new Date(order.completed_at), now))
    );

    const yearRevenue = sumRevenue(
        completedOrders.filter((order) =>
            new Date(order.completed_at).getFullYear() === now.getFullYear()
        )
    );

    const totalRevenue = sumRevenue(completedOrders);
    const pendingRevenue = sumRevenue(activeOrders);

    setText("salesToday", euro(todayRevenue));
    setText("salesWeek", euro(weekRevenue));
    setText("salesMonth", euro(monthRevenue));
    setText("salesYear", euro(yearRevenue));
    setText("averageOrder", euro(completedOrders.length ? totalRevenue / completedOrders.length : 0));
    setText("completedOrders", completedOrders.length);
    setText("pendingRevenue", euro(pendingRevenue));

    const profit = calculateProfit(completedOrders);
    setText("grossProfit", euro(profit.grossProfit));
}

function updateLifetimeCards(completedOrders) {
    const revenue = sumRevenue(completedOrders);
    const itemsSold = completedOrders.reduce(
        (total, order) => total + order.order_items.reduce(
            (sum, item) => sum + Number(item.quantity || 0),
            0
        ),
        0
    );

    setText("lifetimeRevenue", euro(revenue));
    setText("lifetimeOrders", completedOrders.length);
    setText("lifetimeItems", itemsSold);
    setText("lifetimeAverage", euro(completedOrders.length ? revenue / completedOrders.length : 0));
}

function renderRevenueTrend(orders, range) {
    const canvas = getOrCreateCanvas("salesChart");
    if (!canvas || !window.Chart) return;

    const grouped = buildRevenueSeries(orders, range);

    if (revenueChart) revenueChart.destroy();

    revenueChart = new Chart(canvas, {
        type: "line",
        data: {
            labels: grouped.labels,
            datasets: [{
                label: "Revenue",
                data: grouped.values,
                borderWidth: 2,
                tension: 0.3,
                fill: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: (value) => `€${value}`
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => euro(context.parsed.y)
                    }
                }
            }
        }
    });
}

function buildRevenueSeries(orders, range) {
    const grouped = new Map();

    orders.forEach((order) => {
        const date = new Date(order.completed_at);
        let key;
        let label;

        if (range === "year" || range === "all") {
            key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
            label = date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
        } else {
            key = date.toISOString().split("T")[0];
            label = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        }

        if (!grouped.has(key)) grouped.set(key, { label, value: 0 });
        grouped.get(key).value += Number(order.subtotal) || 0;
    });

    const sorted = [...grouped.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([, value]) => value);

    if (!sorted.length) {
        return { labels: ["No completed sales"], values: [0] };
    }

    return {
        labels: sorted.map((item) => item.label),
        values: sorted.map((item) => item.value)
    };
}

function renderCategoryRevenue(orders) {
    const container = document.getElementById("categoryRevenue");
    if (!container) return;

    container.innerHTML = `<div style="height:320px;"><canvas id="categoryRevenueChart"></canvas></div>`;
    const canvas = document.getElementById("categoryRevenueChart");

    const totals = { bread: 0, cookie: 0, dessert: 0, seasonal: 0, other: 0 };

    orders.forEach((order) => {
        order.order_items.forEach((item) => {
            const category = getItemCategory(item);
            const lineTotal = Number(item.line_total) ||
                Number(item.price_at_purchase || 0) * Number(item.quantity || 0);
            totals[category] = (totals[category] || 0) + lineTotal;
        });
    });

    const entries = Object.entries(totals).filter(([, value]) => value > 0);

    if (!entries.length) {
        container.innerHTML = "<p>No completed sales in this period.</p>";
        return;
    }

    if (categoryChart) categoryChart.destroy();

    categoryChart = new Chart(canvas, {
        type: "doughnut",
        data: {
            labels: entries.map(([key]) => formatCategory(key)),
            datasets: [{
                data: entries.map(([, value]) => value),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.label}: ${euro(context.parsed)}`
                    }
                }
            }
        }
    });
}

function renderBestSellers(orders) {
    const container = document.getElementById("bestSellers");
    if (!container) return;

    const totals = {};

    orders.forEach((order) => {
        order.order_items.forEach((item) => {
            const name = item.item_name || "Unknown item";
            totals[name] = (totals[name] || 0) + Number(item.quantity || 0);
        });
    });

    const sorted = Object.entries(totals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    if (!sorted.length) {
        container.innerHTML = "<p>No completed sales in this period.</p>";
        return;
    }

    container.innerHTML = sorted.map(([name, quantity], index) => `
        <div class="best-seller-row">
            <span>${index + 1}. ${escapeHtml(name)}</span>
            <strong>${quantity} sold</strong>
        </div>
    `).join("");
}

function renderRecentSales(orders) {

    const container =
        document.getElementById("recentSales");

    if (!container) return;

    if (!orders.length) {

        container.innerHTML =
            "<p>No completed sales in this period.</p>";

        return;

    }

    container.innerHTML =
        orders
            .slice()
            .sort(
                (a, b) =>
                    new Date(b.completed_at) -
                    new Date(a.completed_at)
            )
            .slice(0, 10)
            .map(renderSaleCard)
            .join("");

}

function renderSaleCard(order) {

    const items =
        order.order_items
            .map(item => `

                <div class="sale-item-row">

                    <span>

                        ${escapeHtml(item.item_name)}

                    </span>

                    <strong>

                        ×${item.quantity}

                    </strong>

                </div>

            `)
            .join("");

    return `

<div class="sale-card">

    <button
        class="sale-toggle"
        onclick="toggleSaleDetails('${order.id}')">

        View Details

    </button>

    <div class="sale-card-header">

        <div>

            <h3>

                ${escapeHtml(order.customer_name)}

            </h3>

            <small>

                ${formatDate(order.completed_at)}

            </small>

        </div>

        <strong>

            ${euro(order.subtotal)}

        </strong>

    </div>

    <div
    class="sale-details"
    id="sale-${order.id}"
    style="display:none;">

    <div class="sale-items">

        ${items}

    </div>

</div>

<div class="sale-summary">

        <div>

            Revenue

            <strong>

                ${euro(order.subtotal)}

            </strong>

        </div>

        <div>

            Profit

            <strong>

                ${euro(
    calculateProfit([order]).grossProfit
)}

            </strong>

        </div>

    </div>

</div>

`;

}

function toggleSaleDetails(id) {

    const details =
        document.getElementById(`sale-${id}`);

    if (!details) return;

    details.style.display =
        details.style.display === "none"
            ? "block"
            : "none";

}


function renderSalesForecast(completedOrders) {
    const container = document.getElementById("salesForecast");
    if (!container) return;

    const recentStart = new Date();
    recentStart.setDate(recentStart.getDate() - 28);
    recentStart.setHours(0, 0, 0, 0);

    const recentOrders = completedOrders.filter(
        (order) => new Date(order.completed_at) >= recentStart
    );

    const recentRevenue = sumRevenue(recentOrders);
    const weeklyAverage = recentRevenue / 4;
    const monthlyForecast = weeklyAverage * 4.345;

    container.innerHTML = `
        <div class="sales-metric-list">
            <div><span>Average weekly revenue</span><strong>${euro(weeklyAverage)}</strong></div>
            <div><span>Projected next 30 days</span><strong>${euro(monthlyForecast)}</strong></div>
        </div>
        <small>Forecast is based on the most recent 28 days of completed sales.</small>
    `;
}

function renderBusinessInsights(completedOrders, activeOrders) {
    const container = document.getElementById("salesInsights");
    if (!container) return;

    const insights = [];

    if (!completedOrders.length) {
        insights.push("Complete orders to begin building sales insights.");
    } else {
        const totalRevenue = sumRevenue(completedOrders);
        const average = totalRevenue / completedOrders.length;
        insights.push(`Your completed-order average is ${euro(average)}.`);

        const bestSeller = getTopSeller(completedOrders);
        if (bestSeller) {
            insights.push(`${bestSeller.name} is your top seller with ${bestSeller.quantity} sold.`);
        }

        const bestDay = getBestSalesDay(completedOrders);
        if (bestDay) {
            insights.push(`${bestDay.label} is currently your strongest sales day.`);
        }
    }

    if (activeOrders.length) {
        insights.push(`${activeOrders.length} active order${activeOrders.length === 1 ? "" : "s"} represent ${euro(sumRevenue(activeOrders))} in pending revenue.`);
    }

    container.innerHTML = `<ul class="sales-insights-list">${insights.map((insight) => `<li>${escapeHtml(insight)}</li>`).join("")}</ul>`;
}

function renderMonthlyRevenue(completedOrders) {
    const container = document.getElementById("monthlyRevenue");
    if (!container) return;

    const grouped = {};

    completedOrders.forEach((order) => {
        const date = new Date(order.completed_at);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        const label = date.toLocaleDateString("en-US", { month: "long", year: "numeric" });

        if (!grouped[key]) grouped[key] = { label, revenue: 0, orders: 0 };
        grouped[key].revenue += Number(order.subtotal) || 0;
        grouped[key].orders += 1;
    });

    const rows = Object.entries(grouped)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, 12);

    if (!rows.length) {
        container.innerHTML = "<p>No monthly revenue yet.</p>";
        return;
    }

    container.innerHTML = `
        <div class="sales-table">
            <div class="sales-table-row sales-table-header">
                <span>Month</span><span>Orders</span><span>Revenue</span>
            </div>
            ${rows.map(([, item]) => `
                <div class="sales-table-row">
                    <span>${escapeHtml(item.label)}</span>
                    <span>${item.orders}</span>
                    <strong>${euro(item.revenue)}</strong>
                </div>
            `).join("")}
        </div>
    `;
}

function renderProfitBreakdown(orders) {
    const container = document.getElementById("profitBreakdown");
    if (!container) return;

    const profit = calculateProfit(orders);

    container.innerHTML = `
        <div class="sales-metric-list">
            <div><span>Revenue</span><strong>${euro(profit.revenue)}</strong></div>
            <div><span>Estimated cost</span><strong>${euro(profit.cost)}</strong></div>
            <div><span>Gross profit</span><strong>${euro(profit.grossProfit)}</strong></div>
            <div><span>Gross margin</span><strong>${profit.margin.toFixed(1)}%</strong></div>
        </div>
    `;
}
function calculateProfit(sales) {

    let revenue = 0;
    let cost = 0;


    sales.forEach(order => {

        revenue += Number(order.revenue || 0);


        (order.order_items || []).forEach(orderItem => {

            let itemsToCost = [];


            if (orderItem.builder_details?.selections?.length) {

                orderItem.builder_details.selections.forEach(selection => {

                    itemsToCost.push({
                        menu_item_id: selection.id,
                        quantity: Number(selection.quantity || 0)
                    });

                });

            } else {

                itemsToCost.push(orderItem);

            }


            itemsToCost.forEach(item => {


                const menuItem =
                    salesMenuItems.find(
                        m =>
                        String(m.id) ===
                        String(item.menu_item_id)
                    );


                if (!menuItem) return;


                const recipe =
                    salesRecipes.find(
                        r =>
                        String(r.id) ===
                        String(menuItem.recipe_id)
                    );


                if (recipe) {

                    const multiplier =
                        Number(item.quantity || 0) *
                        Number(menuItem.recipe_units_used || 1) /
                        Number(recipe.yield_quantity || 1);


                    const recipeCost =
                        salesRecipeIngredients
                        .filter(
                            ri =>
                            String(ri.recipe_id) ===
                            String(recipe.id)
                        )
                        .reduce((sum, ri)=>{

                            const ingredient =
                                salesIngredients.find(
                                    i =>
                                    String(i.id) ===
                                    String(ri.ingredient_id)
                                );


                            if (!ingredient) return sum;


                            const purchaseSize =
                                ingredient.purchase_unit === "lb"
                                ? Number(ingredient.purchase_size) * 453.592
                                : Number(ingredient.purchase_size);


                            const costPerGram =
                                Number(ingredient.purchase_price) /
                                purchaseSize;


                            return sum +
                                Number(ri.quantity || 0) *
                                costPerGram;


                        },0);


                    cost += recipeCost * multiplier;

                }



                // packaging
const packagingItems =
    salesPackagingItems.filter(
        p =>
        String(p.profile_id) ===
        String(menuItem.packaging_profile_id)
    );


packagingItems.forEach(p => {

    const ingredient =
        salesIngredients.find(
            i =>
            String(i.id) ===
            String(p.ingredient_id)
        );


    if (!ingredient) return;


    // packaging is purchased by item, not grams
    const itemCost =
        Number(ingredient.purchase_price) /
        Number(ingredient.purchase_size || 1);


    cost +=
        itemCost *
        Number(p.quantity || 0) *
        Number(item.quantity || 1);

});

                });


            });


        });


    return {

        revenue,

        cost,

        grossProfit:
            revenue - cost,

        margin:
            revenue
            ? ((revenue-cost)/revenue)*100
            : 0

    };

}
function exportSalesCsv() {
    const completedOrders = salesOrders;
    const rows = [["Order ID", "Customer", "Date", "Status", "Items", "Subtotal"]];

    completedOrders.forEach((order) => {
        const itemSummary = order.order_items
            .map((item) => `${item.item_name} x${item.quantity}`)
            .join("; ");

        rows.push([
            order.id,
            order.customer_name,
            formatDate(order.completed_at),
            "Completed",
            itemSummary,
            Number(order.subtotal).toFixed(2)
        ]);
    });

    const csv = rows.map((row) =>
        row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")
    ).join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `jess-bakes-sales-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
}

function filterOrdersByRange(orders, range) {
    if (range === "all") return orders.slice();

    const now = new Date();

    return orders.filter((order) => {
        const date = new Date(order.completed_at);
        if (range === "today") return isSameDay(now, date);
        if (range === "week") return isThisWeek(date, now);
        if (range === "month") return isSameMonth(date, now);
        if (range === "year") return date.getFullYear() === now.getFullYear();
        return true;
    });
}

function normalizeRange(text) {
    const value = String(text || "").trim().toLowerCase();
    if (value.includes("all")) return "all";
    if (value.includes("week")) return "week";
    if (value.includes("month")) return "month";
    if (value.includes("year")) return "year";
    return "today";
}

function getTopSeller(orders) {
    const totals = {};

    orders.forEach((order) => {
        order.order_items.forEach((item) => {
            const name = item.item_name || "Unknown item";
            totals[name] = (totals[name] || 0) + Number(item.quantity || 0);
        });
    });

    const top = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
    return top ? { name: top[0], quantity: top[1] } : null;
}

function getBestSalesDay(orders) {
    const totals = {};

    orders.forEach((order) => {
        const label = new Date(order.completed_at).toLocaleDateString("en-US", { weekday: "long" });
        totals[label] = (totals[label] || 0) + Number(order.subtotal || 0);
    });

    const top = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
    return top ? { label: top[0], revenue: top[1] } : null;
}

function getItemCategory(item) {
    const menuItem = salesMenuItems.find(
        (menu) => String(menu.id) === String(item.menu_item_id)
    );

    const category = menuItem?.category || "other";
    return ["bread", "cookie", "dessert", "seasonal"].includes(category)
        ? category
        : "other";
}

function formatCategory(category) {
    const labels = {
        bread: "Bread",
        cookie: "Cookies",
        dessert: "Desserts",
        seasonal: "Seasonal",
        other: "Other"
    };

    return labels[category] || category;
}

function getOrCreateCanvas(id) {
    const element = document.getElementById(id);
    if (!element) return null;
    if (element.tagName === "CANVAS") return element;

    element.innerHTML = `<canvas id="${id}Canvas"></canvas>`;
    return document.getElementById(`${id}Canvas`);
}

function showSalesError(message) {
    [
        "recentSales",
        "bestSellers",
        "categoryRevenue",
        "salesForecast",
        "salesInsights",
        "monthlyRevenue",
        "profitBreakdown"
    ].forEach((id) => {
        const element = document.getElementById(id);
        if (element) element.innerHTML = `<p>${escapeHtml(message)}</p>`;
    });
}

function sumRevenue(orders) {
    return orders.reduce((total, order) => total + (Number(order.subtotal) || 0), 0);
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function euro(value) {
    return new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "EUR"
    }).format(Number(value) || 0);
}

function formatDate(date) {
    return new Date(date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

function isSameDay(a, b) {
    return a.getDate() === b.getDate() &&
        a.getMonth() === b.getMonth() &&
        a.getFullYear() === b.getFullYear();
}

function isSameMonth(a, b) {
    return a.getMonth() === b.getMonth() &&
        a.getFullYear() === b.getFullYear();
}

function isThisWeek(date, now = new Date()) {
    const start = new Date(now);
    start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 7);

    return date >= start && date < end;
}

function escapeHtml(text) {
    return String(text || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

window.loadSalesDashboard = loadSalesDashboard;
window.exportSalesCsv = exportSalesCsv;

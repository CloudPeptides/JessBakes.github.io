document.addEventListener("DOMContentLoaded", async () => {

    await requireAuth();

});

function escapeHtml(text) {

    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

}

/* ==========================================
   PAGE INITIALIZATION
========================================== */

document.addEventListener("DOMContentLoaded", async () => {

    await requireAuth();

    setupLogout();

    loadAnalytics();

});


/* ==========================================
   LOAD ANALYTICS
========================================== */

async function loadAnalytics() {

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

    const completed =
        orders.filter(order => order.status === "completed");

    updateOverview(completed);

    renderProductRankings(completed);

    renderCustomerInsights(completed);

    renderPickupTrends(completed);

    renderBakeryInsights(completed);

    renderTopCustomers(completed);

    renderProductBreakdown(completed);

}


/* ==========================================
   OVERVIEW
========================================== */

function updateOverview(orders){

    const customers =
    [...new Set(
        orders.map(order =>
            (order.customer_name || "")
                .trim()
                .toLowerCase()
        )
    )];

    const totalItems =
        orders.reduce((sum, order)=>{

            return sum +
                order.order_items.reduce(
                    (i,item)=>i+item.quantity,
                    0
                );

        },0);

    document.getElementById("totalCustomers").textContent =
        customers.length;

    document.getElementById("returningCustomers").textContent =
        getReturningCustomers(orders);

    document.getElementById("itemsSold").textContent =
        totalItems;

    document.getElementById("averageItems").textContent =
        orders.length
            ? (
                totalItems /
                orders.length
            ).toFixed(1)
            : "0";

}


/* ==========================================
   PRODUCT RANKINGS
========================================== */

function renderProductRankings(orders){

    const container =
        document.getElementById("productRankings");

    const totals = {};

    orders.forEach(order=>{

        order.order_items.forEach(item=>{

            totals[item.item_name] =
                (totals[item.item_name]||0)
                + item.quantity;

        });

    });

    const ranking =
        Object.entries(totals)
            .sort((a,b)=>b[1]-a[1]);

    if(!ranking.length){

        container.innerHTML =
            "<p>No completed orders yet.</p>";

        return;

    }

    container.innerHTML =
        ranking.map(([name,qty],index)=>`

<div class="ranking-row">

    <strong>

        ${index+1}.

        ${escapeHtml(name)}

    </strong>

    <span>

        ${qty} sold

    </span>

</div>

`).join("");

}


/* ==========================================
   CUSTOMER INSIGHTS
========================================== */

function renderCustomerInsights(orders){

    const container =
        document.getElementById("customerInsights");

    const totalCustomers =
    new Set(
        orders.map(order =>
            (order.customer_name || "")
                .trim()
                .toLowerCase()
        )
    ).size;

    const repeat =
        getReturningCustomers(orders);

    container.innerHTML = `

<p>

Total Customers

<strong>

${totalCustomers}

</strong>

</p>

<p>

Returning Customers

<strong>

${repeat}

</strong>

</p>

<p>

Repeat Rate

<strong>

${
    totalCustomers
        ? Math.round(
            repeat /
            totalCustomers
            *100
        )
        :0
}%

</strong>

</p>

`;

}


/* ==========================================
   PICKUP TRENDS
========================================== */

function renderPickupTrends(orders){

    const container =
        document.getElementById("pickupTrends");

    const weekly =
        orders.filter(o=>o.order_type==="weekly").length;

    const custom =
        orders.filter(o=>o.order_type==="custom").length;

    container.innerHTML = `

<p>

Weekly Pickup

<strong>

${weekly}

</strong>

</p>

<p>

Custom Orders

<strong>

${custom}

</strong>

</p>

`;

}


/* ==========================================
   BAKERY INSIGHTS
========================================== */

function renderBakeryInsights(orders){

    const container =
        document.getElementById("bakeryInsights");

    if(!orders.length){

        container.innerHTML =
            "<p>No completed orders yet.</p>";

        return;

    }

    const largest =
        [...orders]
            .sort((a,b)=>
                b.subtotal-a.subtotal
            )[0];

    container.innerHTML = `

<p>

Largest Order

<strong>

€${Number(largest.subtotal).toFixed(2)}

</strong>

</p>

<p>

Average Order

<strong>

€${
(
orders.reduce(
(s,o)=>s+Number(o.subtotal),
0
)
/
orders.length
).toFixed(2)
}

</strong>

</p>

`;

}


/* ==========================================
   TOP CUSTOMERS
========================================== */

function renderTopCustomers(orders) {

    const container =
        document.getElementById("topCustomers");

    const totals = {};

    orders.forEach(order => {

        const key =
            (order.customer_name || "")
                .trim()
                .toLowerCase();

        if (!totals[key]) {

            totals[key] = {

                name: order.customer_name || "Unknown",

                total: 0,

                orders: 0,

                lastOrder: order.created_at

            };

        }

        totals[key].total +=
            Number(order.subtotal || 0);

        totals[key].orders++;

        if (
            new Date(order.created_at) >
            new Date(totals[key].lastOrder)
        ) {

            totals[key].lastOrder =
                order.created_at;

        }

    });

    const customers =
        Object.values(totals)

        .sort((a, b) => b.total - a.total)

        .slice(0, 5);

    if (!customers.length) {

        container.innerHTML =
            "<p>No customers yet.</p>";

        return;

    }

    container.innerHTML =
        customers.map((customer, index) => {

            let medal = "";

            if (index === 0) medal = "🥇";
            else if (index === 1) medal = "🥈";
            else if (index === 2) medal = "🥉";

            const average =
                customer.total /
                customer.orders;

            const last =
                new Date(customer.lastOrder)
                    .toLocaleDateString();

            return `

<div class="customer-card">

    <div class="customer-header">

        <strong>

            ${medal}
            ${customer.name}

        </strong>

        <span>

            €${customer.total.toFixed(2)}

        </span>

    </div>

    <div class="customer-details">

        <span>

            ${customer.orders}
            order${customer.orders === 1 ? "" : "s"}

        </span>

        <span>

            Avg €${average.toFixed(2)}

        </span>

        <span>

            Last: ${last}

        </span>

    </div>

</div>

`;

        }).join("");

}

/* ==========================================
   PRODUCT BREAKDOWN
========================================== */

function renderProductBreakdown(orders){

    const container =
        document.getElementById("productBreakdown");

    container.innerHTML =
        document.getElementById(
            "productRankings"
        ).innerHTML;

}


/* ==========================================
   HELPERS
========================================== */

function getReturningCustomers(orders){

    const counts = {};

    orders.forEach(order=>{

        const key =
            (order.customer_name || "")
                .trim()
                .toLowerCase();

        counts[key] =
            (counts[key] || 0) + 1;

    });

    return Object.values(counts)
        .filter(count => count > 1)
        .length;

}

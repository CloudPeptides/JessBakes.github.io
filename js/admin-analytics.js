document.addEventListener("DOMContentLoaded", async () => {

    await requireAuth();

});

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
            orders.map(order => order.customer_email)
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
            orders.map(o=>o.customer_email)
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

function renderTopCustomers(orders){

    const container =
        document.getElementById("topCustomers");

    const totals = {};

    orders.forEach(order=>{

        const key =
            order.customer_email;

        if(!totals[key]){

            totals[key]={
                name:order.customer_name,
                total:0
            };

        }

        totals[key].total +=
            Number(order.subtotal);

    });

    const customers =
        Object.values(totals)
            .sort((a,b)=>
                b.total-a.total
            );

    if(!customers.length){

        container.innerHTML =
            "<p>No customers yet.</p>";

        return;

    }

    container.innerHTML =
        customers.map(customer=>`

<div class="ranking-row">

<strong>

${escapeHtml(customer.name)}

</strong>

<span>

€${customer.total.toFixed(2)}

</span>

</div>

`).join("");

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

    const counts={};

    orders.forEach(order=>{

        counts[order.customer_email]=
            (counts[order.customer_email]||0)+1;

    });

    return Object.values(counts)
        .filter(c=>c>1)
        .length;

}

function escapeHtml(text){

    return String(text||"")

        .replaceAll("&","&amp;")

        .replaceAll("<","&lt;")

        .replaceAll(">","&gt;")

        .replaceAll('"',"&quot;")

        .replaceAll("'","&#039;");

}

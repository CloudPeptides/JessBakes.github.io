/* ==========================================
   DASHBOARD
========================================== */

document.addEventListener("DOMContentLoaded", async () => {

    await requireAuth();

    document
        .getElementById("logoutBtn")
        .addEventListener("click", logout);

    await Promise.all([
        loadDashboardOrders(),
        loadDashboardReviews(),
        loadDashboardBallot()
    ]);

});


/* ==========================================
   ORDERS
========================================== */

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
        orders.filter(o => o.status === "pending").length;

    renderRecentOrders(orders.slice(0,5));

}


function renderRecentOrders(orders){

    const container =
        document.getElementById("recentOrders");

    if(!orders.length){

        container.innerHTML = `
            <p>No orders yet.</p>
        `;

        return;

    }

    container.innerHTML =
        orders.map(order => `

<div class="dashboard-order">

    <div>

        <strong>

            ${escapeHtml(order.customer_name)}

        </strong>

        <small>

            ${formatDate(order.created_at)}

        </small>

    </div>

    <span class="status-badge status-${order.status}">

        ${capitalize(order.status)}

    </span>

</div>

`).join("");

}


/* ==========================================
   REVIEWS
========================================== */

async function loadDashboardReviews(){

    const { data, error } =
        await supabaseClient
            .from("reviews")
            .select("*")
            .eq("approved",false)
            .order("created_at");

    if(error){

        console.error(error);

        return;

    }

    const reviews = data || [];

    document.getElementById(
        "pendingReviewCount"
    ).textContent = reviews.length;

    renderRecentReviews(
        reviews.slice(0,3)
    );

}


function renderRecentReviews(reviews){

    const container =
        document.getElementById("recentReviews");

    if(!reviews.length){

        container.innerHTML = `
            <p>No pending reviews.</p>
        `;

        return;

    }

    container.innerHTML =
        reviews.map(review => `

<div class="dashboard-review">

    <strong>

        ${escapeHtml(review.name)}

    </strong>

    <p>

        "${escapeHtml(review.review)}"

    </p>

</div>

`).join("");

}


/* ==========================================
   BALLOT
========================================== */

async function loadDashboardBallot(){

    const { data: votes } =
        await supabaseClient
            .from("votes")
            .select("id");

    const { data: options } =
        await supabaseClient
            .from("ballot_options")
            .select("id")
            .eq("active",true);

    document.getElementById(
        "ballotVoteCount"
    ).textContent = votes?.length || 0;

    document.getElementById(
        "ballotOptionCount"
    ).textContent = options?.length || 0;

}


/* ==========================================
   HELPERS
========================================== */

function formatDate(date){

    return new Date(date)
        .toLocaleDateString();

}

function capitalize(text){

    return text.charAt(0)
        .toUpperCase() +
        text.slice(1);

}

function escapeHtml(text){

    return String(text || "")
        .replaceAll("&","&amp;")
        .replaceAll("<","&lt;")
        .replaceAll(">","&gt;")
        .replaceAll('"',"&quot;")
        .replaceAll("'","&#039;");

}

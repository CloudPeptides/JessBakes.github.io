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

    const pendingOrders =
        orders.filter(o => o.status === "pending");

    document.getElementById("orderCount").textContent =
        pendingOrders.length;

    renderRecentOrders(
        orders.slice(0,5)
    );

    calculateRevenue(orders);

    renderUpcomingPickups(orders);

    buildNotifications(orders);

}

/* ==========================================
   REVENUE
========================================== */

function calculateRevenue(orders){

    const today = new Date();

    let todayTotal = 0;

    let weekTotal = 0;

    orders.forEach(order => {

        if(order.status === "cancelled")
            return;

        const orderDate =
            new Date(order.created_at);

        const subtotal =
            Number(order.subtotal) || 0;

        if(isSameDay(today, orderDate)){

            todayTotal += subtotal;

        }

        if(isThisWeek(today, orderDate)){

            weekTotal += subtotal;

        }

    });

    document.getElementById("salesToday").textContent =
        euro(todayTotal);

    document.getElementById("salesWeek").textContent =
        euro(weekTotal);

}

function euro(value){

    return new Intl.NumberFormat(

        "de-DE",

        {

            style:"currency",

            currency:"EUR"

        }

    ).format(value);

}

function isSameDay(a,b){

    return a.getFullYear()===b.getFullYear()

        &&

        a.getMonth()===b.getMonth()

        &&

        a.getDate()===b.getDate();

}

function isThisWeek(today,date){

    const start =
        new Date(today);

    start.setDate(
        today.getDate()-today.getDay()
    );

    start.setHours(0,0,0,0);

    return date>=start;

}

/* ==========================================
   UPCOMING PICKUPS
========================================== */

function renderUpcomingPickups(orders){

    const container =
        document.getElementById("upcomingPickups");

    const upcoming =
        orders

        .filter(o =>
            o.status==="confirmed"
            ||

            o.status==="ready"
        )

        .sort((a,b)=>

            new Date(a.pickup_date)

            -

            new Date(b.pickup_date)

        )

        .slice(0,5);

    if(!upcoming.length){

        container.innerHTML=

        "<p>No upcoming pickups.</p>";

        return;

    }

    container.innerHTML=

        upcoming.map(order=>`

<div class="dashboard-order">

<div>

<strong>

${escapeHtml(order.customer_name)}

</strong>

<small>

${formatDate(order.pickup_date)}

</small>

</div>

<span>

${escapeHtml(order.pickup_type || "Sunday Pickup")}

</span>

</div>

`).join("");

}

/* ==========================================
   NOTIFICATIONS
========================================== */

function buildNotifications(orders){

    const panel =
        document.getElementById("notificationsPanel");

    const notes=[];

    const pending =
        orders.filter(o=>o.status==="pending").length;

    if(pending){

        notes.push(

            `📦 ${pending} pending order${pending>1?"s":""}`

        );

    }

    const custom =
        orders.filter(

            o=>o.pickup_type==="custom"

        ).length;

    if(custom){

        notes.push(

            `🎉 ${custom} custom order${custom>1?"s":""}`

        );

    }

    if(!notes.length){

        notes.push(

            "Everything looks good today."

        );

    }

    panel.innerHTML=

        notes.map(note=>`

<div class="notification-item">

${note}

</div>

`).join("");

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

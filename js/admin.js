const loginScreen = document.getElementById("loginScreen");
const dashboard = document.getElementById("dashboard");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");

document.addEventListener("DOMContentLoaded", async () => {

    const { data } = await supabaseClient.auth.getSession();

    if (data.session) {
        showDashboard(data.session.user);
    }

});

loginForm.addEventListener("submit", async (e) => {

    e.preventDefault();

    loginError.textContent = "";

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
    });

    if (error) {
        loginError.textContent = error.message;
        return;
    }

    showDashboard(data.user);

});

function showDashboard(user) {

    loginScreen.style.display = "none";
    dashboard.style.display = "block";

    dashboard.innerHTML = `

       <div class="dashboard-container">

    <header class="dashboard-header">

        <div>

            <p class="eyebrow">Jess Bakes Sourdough</p>

            <h1>Admin Dashboard</h1>

            <p>Welcome back, Jess.</p>

        </div>

        <button
            class="logout-btn"
            id="logoutBtn">

            Sign Out

        </button>

    </header>

    <section class="overview-grid">

        <div class="overview-card">

            <h3>Pending Reviews</h3>

            <span id="pendingReviewCount">--</span>

        </div>

        <div class="overview-card">

            <h3>Ballot Votes</h3>

            <span id="ballotVoteCount">--</span>

        </div>

        <div class="overview-card">

            <h3>Products</h3>

            <span id="productCount">--</span>

        </div>

        <div class="overview-card">

            <h3>Orders</h3>

            <span>Coming Soon</span>

        </div>

    </section>

    <section class="admin-panel">

        <div class="panel-header">

            <h2>Pending Reviews</h2>

        </div>

        <div id="pendingReviews">

            Loading...

        </div>

    </section>

    <section class="admin-panel">

        <div class="panel-header">

            <h2>Bakery Ballot</h2>

        </div>

        <div id="ballotManager">

            Coming Soon

        </div>

    </section>

    <section class="admin-panel">

        <div class="panel-header">

            <h2>Menu</h2>

        </div>

        <div id="menuManager">

            Coming Soon

        </div>

    </section>

    <section class="admin-panel">

        <div class="panel-header">

            <h2>Orders</h2>

        </div>

        <div id="orderManager">

            Coming Soon

        </div>

    </section>

</div>

    `;

    document
        .getElementById("logoutBtn")
        .addEventListener("click", logout);

    loadPendingReviews();
    loadBallotManager();

}

async function loadPendingReviews() {

    const { data, error } = await supabaseClient
        .from("reviews")
        .select("*")
        .eq("approved", false)
        .order("created_at", { ascending: true });

    if (error) {

        console.error(error);

        return;

    }

    renderPendingReviews(data || []);

}

function renderPendingReviews(reviews) {

    document.getElementById("pendingReviewCount").textContent = reviews.length;

    const container = document.getElementById("pendingReviews");

    if (!reviews.length) {

        container.innerHTML = "<p>No pending reviews 🎉</p>";

        return;

    }

    container.innerHTML = reviews.map(review => `

        <article class="admin-review-card">

            <div class="admin-review-top">

                <div>

                    <h3>${review.name}</h3>

                    <p class="admin-product">${review.product}</p>

                </div>

                <div class="admin-stars">

                    ${"★".repeat(review.rating)}${"☆".repeat(5-review.rating)}

                </div>

            </div>

            <p class="admin-review-text">

                "${review.review}"

            </p>

            <div class="admin-review-actions">

                <button
                    class="approve-btn"
                    onclick="approveReview('${review.id}')">

                    Approve

                </button>

                <button
                    class="delete-btn"
                    onclick="deleteReview('${review.id}')">

                    Delete

                </button>

            </div>

        </article>

    `).join("");

}

async function approveReview(id) {

    const { error } = await supabaseClient
        .from("reviews")
        .update({
            approved: true
        })
        .eq("id", id);

    if (error) {

        console.error(error);

        return;

    }

    loadPendingReviews();

}

async function deleteReview(id) {

    if (!confirm("Delete this review?")) return;

    const { data, error } = await supabaseClient
        .from("reviews")
        .delete()
        .eq("id", id)
        .select();

    console.log("Delete result:", data);
    console.log("Delete error:", error);

    if (error) {

        alert(error.message);

        return;

    }

    loadPendingReviews();

}

async function loadBallotManager() {

    ...
}

async function logout() {

    await supabaseClient.auth.signOut();

    location.reload();

}

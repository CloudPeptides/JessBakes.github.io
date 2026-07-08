const loginScreen = document.getElementById("loginScreen");
const dashboard = document.getElementById("dashboard");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");

document.addEventListener("DOMContentLoaded", async () => {
    const { data } = await supabaseClient.auth.getSession();

    if (data.session) {
        showDashboard();
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

    showDashboard();
});

function showDashboard() {
    loginScreen.style.display = "none";
    dashboard.style.display = "block";

    dashboard.innerHTML = `
        <div class="dashboard-container">

            <header class="dashboard-header">
                <div>
                    <p class="eyebrow">Jess Bakes Sourdough</p>
                    <h1>Admin Dashboard</h1>
                    <p>Manage your website from one place.</p>
                </div>

                <button class="logout-btn" id="logoutBtn">
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
                    <h3>Ballot Options</h3>
                    <span id="ballotOptionCount">--</span>
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
                    Loading...
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

    document.getElementById("logoutBtn").addEventListener("click", logout);

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
        alert(error.message);
        return;
    }

    renderPendingReviews(data || []);
}

function renderPendingReviews(reviews) {
    document.getElementById("pendingReviewCount").textContent = reviews.length;

    const container = document.getElementById("pendingReviews");

    if (!reviews.length) {
        container.innerHTML = `<p>No pending reviews.</p>`;
        return;
    }

    container.innerHTML = reviews.map((review) => `
        <article class="admin-review-card">
            <div class="admin-review-top">
                <div>
                    <h3>${review.name}</h3>
                    <p class="admin-product">${review.product}</p>
                </div>

                <div class="admin-stars">
                    ${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}
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
        .update({ approved: true })
        .eq("id", id);

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    loadPendingReviews();
}

async function deleteReview(id) {
    if (!confirm("Delete this review?")) return;

    const { error } = await supabaseClient
        .from("reviews")
        .delete()
        .eq("id", id);

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    loadPendingReviews();
}

async function loadBallotManager() {
    const [settingsResult, optionsResult, votesResult] = await Promise.all([
        supabaseClient
            .from("ballot_settings")
            .select("*")
            .eq("active", true)
            .limit(1)
            .maybeSingle(),

        supabaseClient
            .from("ballot_options")
            .select("*")
            .eq("active", true)
            .order("category")
            .order("name"),

        supabaseClient
            .from("votes")
            .select("*")
    ]);

    if (settingsResult.error) {
        console.error(settingsResult.error);
        document.getElementById("ballotManager").innerHTML = `<p>Unable to load ballot settings.</p>`;
        return;
    }

    if (optionsResult.error) {
        console.error(optionsResult.error);
        document.getElementById("ballotManager").innerHTML = `<p>Unable to load ballot options.</p>`;
        return;
    }

    if (votesResult.error) {
        console.error(votesResult.error);
        document.getElementById("ballotManager").innerHTML = `<p>Unable to load ballot votes.</p>`;
        return;
    }

    const settings = settingsResult.data;
    const options = optionsResult.data || [];
    const votes = votesResult.data || [];

    document.getElementById("ballotVoteCount").textContent = votes.length;
    document.getElementById("ballotOptionCount").textContent = options.length;

    renderBallotManager(settings, options, votes);
}

function renderBallotManager(settings, options, votes) {
    const container = document.getElementById("ballotManager");

    if (!settings) {
        container.innerHTML = `
            <p>No active ballot found.</p>
        `;
        return;
    }

    const bread = options.filter((option) => option.category.toLowerCase() === "bread");
    const cookies = options.filter((option) => option.category.toLowerCase() === "cookie");
    const desserts = options.filter((option) => option.category.toLowerCase() === "dessert");

    container.innerHTML = `
        <div class="ballot-admin-overview">
            <div>
                <strong>Status</strong>
                <p>${settings.active ? "Active" : "Closed"}</p>
            </div>

            <div>
                <strong>Voting Ends</strong>
                <p>${formatDate(settings.end_date)}</p>
            </div>

            <div>
                <strong>Total Votes</strong>
                <p>${votes.length}</p>
            </div>
        </div>

        <div class="ballot-admin-grid">
            ${renderBallotCategory("Bread", bread, votes)}
            ${renderBallotCategory("Cookies", cookies, votes)}
            ${renderBallotCategory("Desserts", desserts, votes)}
        </div>
    `;
}

function renderBallotCategory(title, options, votes) {

    if (!options.length) {

        return `

            <div class="ballot-admin-category">

                <h3>${title}</h3>

                <p>No options yet.</p>

            </div>

        `;

    }

    return `

        <div class="ballot-admin-category">

            <h3>${title}</h3>

            ${options.map(option => {

                const voteCount = votes.filter(vote => vote.option_id === option.id).length;

                return `

                    <div class="ballot-option-row">

                        <div>

                            <strong>${option.name}</strong>

                            <small>${voteCount} vote${voteCount === 1 ? "" : "s"}</small>

                        </div>

                        <button
                            class="edit-option-btn"
                            onclick="editBallotOption('${option.id}')">

                            Edit

                        </button>

                    </div>

                `;

            }).join("")}

        </div>

    `;

}

function formatDate(dateString) {
    if (!dateString) return "Not set";

    return new Date(dateString).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

async function editBallotOption(id) {

    const { data, error } = await supabaseClient
        .from("ballot_options")
        .select("*")
        .eq("id", id)
        .single();

    if (error) {

        console.error(error);
        alert(error.message);

        return;

    }

    document.getElementById("editOptionId").value = data.id;

    document.getElementById("editOptionName").value = data.name;

    document.getElementById("editOptionCategory").value = data.category;

    document.getElementById("editOptionActive").checked = data.active;

    document.getElementById("editOptionModal").style.display = "flex";

}

function closeEditModal() {

    document.getElementById("editOptionModal").style.display = "none";

}

async function saveBallotOption() {

    const id = document.getElementById("editOptionId").value;

    const name = document.getElementById("editOptionName").value.trim();

    const category = document.getElementById("editOptionCategory").value;

    const active = document.getElementById("editOptionActive").checked;

    const { error } = await supabaseClient

        .from("ballot_options")

        .update({

            name,

            category,

            active

        })

        .eq("id", id);

    if (error) {

        console.error(error);

        alert(error.message);

        return;

    }

    closeEditModal();

    loadBallotManager();

}

async function logout() {
    await supabaseClient.auth.signOut();
    location.reload();
}

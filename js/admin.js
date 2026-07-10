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

    const { error } = await supabaseClient.auth.signInWithPassword({
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

            <p class="eyebrow">
                Jess Bakes Sourdough
            </p>

            <h1>
                Dashboard
            </h1>

            <p>
                Welcome back, Jess.
            </p>

        </div>

        <button
            class="logout-btn"
            id="logoutBtn">

            Sign Out

        </button>

    </header>

    <section class="overview-grid">

        <div class="overview-card">

            <div class="overview-label">

                Pending Reviews

            </div>

            <div
                class="overview-value"
                id="pendingReviewCount">

                --

            </div>

        </div>

        <div class="overview-card">

            <div class="overview-label">

                Orders

            </div>

            <div
                class="overview-value"
                id="orderCount">

                --

            </div>

        </div>

        <div class="overview-card">

            <div class="overview-label">

                Ballot Votes

            </div>

            <div
                class="overview-value"
                id="ballotVoteCount">

                --

            </div>

        </div>

        <div class="overview-card">

            <div class="overview-label">

                Ballot Options

            </div>

            <div
                class="overview-value"
                id="ballotOptionCount">

                --

            </div>

        </div>

    </section>

    <div class="dashboard-grid">

        <section class="admin-panel panel-orders">

            <div class="panel-header">

                <h2>Orders</h2>

            </div>

            <div id="orderManager">

                Loading...

            </div>

        </section>

        <section class="admin-panel panel-menu">

            <div class="panel-header">

                <h2>Menu</h2>

            </div>

            <div id="menuManager">

                Loading...

            </div>

        </section>

        <section class="admin-panel panel-reviews">

            <div class="panel-header">

                <h2>Pending Reviews</h2>

            </div>

            <div id="pendingReviews">

                Loading...

            </div>

        </section>

        <section class="admin-panel panel-ballot">

            <div class="panel-header">

                <h2>Bakery Ballot</h2>

            </div>

            <div id="ballotManager">

                Loading...

            </div>

        </section>

    </div>

</div>

`;

    document
        .getElementById("logoutBtn")
        .addEventListener("click", logout);

    loadPendingReviews();
    loadBallotManager();
    loadMenuManager();
    loadOrderManager();

}

/* =========================
   REVIEWS
========================= */

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
                    <h3>${escapeHtml(review.name)}</h3>
                    <p class="admin-product">${escapeHtml(review.product)}</p>
                </div>

                <div class="admin-stars">
                    ${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}
                </div>
            </div>

            <p class="admin-review-text">
                "${escapeHtml(review.review)}"
            </p>

            <div class="admin-review-actions">
                <button class="approve-btn" onclick="approveReview('${review.id}')">
                    Approve
                </button>

                <button class="delete-btn" onclick="deleteReview('${review.id}')">
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

/* =========================
   BALLOT MANAGER
========================= */

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

    const ballotManager = document.getElementById("ballotManager");

    if (settingsResult.error) {
        console.error(settingsResult.error);
        ballotManager.innerHTML = `<p>Unable to load ballot settings.</p>`;
        return;
    }

    if (optionsResult.error) {
        console.error(optionsResult.error);
        ballotManager.innerHTML = `<p>Unable to load ballot options.</p>`;
        return;
    }

    if (votesResult.error) {
        console.error(votesResult.error);
        ballotManager.innerHTML = `<p>Unable to load ballot votes.</p>`;
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
            <div class="ballot-admin-toolbar">
                <button class="approve-btn" onclick="openNewBallotModal()">
                    Start New Ballot
                </button>
            </div>

            <p>No active ballot found.</p>
        `;
        return;
    }

    const bread = options.filter(option => option.category === "bread");
    const cookies = options.filter(option => option.category === "cookie");
    const desserts = options.filter(option => option.category === "dessert");

    container.innerHTML = `
        <div class="ballot-admin-toolbar">
            <button class="approve-btn" onclick="openNewBallotModal()">
                Start New Ballot
            </button>
        </div>

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

        <div class="ballot-date-editor">
            <label for="ballotEndDate">
                Change Voting End Date
            </label>

            <input
                type="date"
                id="ballotEndDate"
                value="${formatDateForInput(settings.end_date)}">

            <button
                class="edit-option-btn"
                onclick="saveBallotEndDate('${settings.id}')">
                Save Date
            </button>
        </div>

        <div class="ballot-admin-grid">
            ${renderBallotCategory("Bread", "bread", bread, votes)}
            ${renderBallotCategory("Cookies", "cookie", cookies, votes)}
            ${renderBallotCategory("Desserts", "dessert", desserts, votes)}
        </div>
    `;
}

function renderBallotCategory(title, category, options, votes) {
    return `
        <div class="ballot-admin-category">
            <div class="ballot-category-header">
                <h3>${title}</h3>

                <button
                    class="add-option-btn"
                    onclick="openNewOptionModal('${category}')">
                    + Add
                </button>
            </div>

            ${
                !options.length
                    ? `<p>No options yet.</p>`
                    : options.map(option => {
                        const voteCount = votes.filter(
                            vote => vote.option_id === option.id
                        ).length;

                        return `
                            <div class="ballot-option-row">
                                <div>
                                    <strong>${escapeHtml(option.name)}</strong>
                                    <small>${voteCount} vote${voteCount === 1 ? "" : "s"}</small>
                                </div>

                                <div class="ballot-row-actions">
                                    <button
                                        class="edit-option-btn"
                                        onclick="editBallotOption('${option.id}')">
                                        Edit
                                    </button>

                                    <button
                                        class="remove-option-btn"
                                        onclick="removeBallotOption('${option.id}', '${escapeHtml(option.name)}')">
                                        Remove
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join("")
            }
        </div>
    `;
}

/* =========================
   BALLOT OPTION MANAGEMENT
========================= */

function openNewOptionModal(category) {
    document.getElementById("optionModalTitle").textContent = "Add Ballot Option";
    document.getElementById("editOptionId").value = "";
    document.getElementById("editOptionName").value = "";
    document.getElementById("editOptionCategory").value = category;
    document.getElementById("editOptionActive").checked = true;
    document.getElementById("editOptionModal").style.display = "flex";
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

    document.getElementById("optionModalTitle").textContent = "Edit Ballot Option";
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

    if (!name) {
        alert("Please enter a ballot option.");
        return;
    }

    let error;

    if (id) {
        ({ error } = await supabaseClient
            .from("ballot_options")
            .update({
                name,
                category,
                active
            })
            .eq("id", id));
    } else {
        ({ error } = await supabaseClient
            .from("ballot_options")
            .insert({
                name,
                category,
                active
            }));
    }

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    closeEditModal();
    loadBallotManager();
}

async function removeBallotOption(id, name) {
    if (!confirm(`Remove "${name}" from this ballot?`)) return;

    const { error } = await supabaseClient
        .from("ballot_options")
        .update({ active: false })
        .eq("id", id);

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    loadBallotManager();
}

async function saveBallotEndDate(ballotId) {
    const endDate = document.getElementById("ballotEndDate").value;

    if (!endDate) {
        alert("Please select an end date.");
        return;
    }

    const { error } = await supabaseClient
        .from("ballot_settings")
        .update({ end_date: endDate })
        .eq("id", ballotId);

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    loadBallotManager();
}

/* =========================
   NEW BALLOT
========================= */

function openNewBallotModal() {
    document.getElementById("newBallotModal").style.display = "flex";

    document.getElementById("newBallotTitle").value = "";

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);

    document.getElementById("newBallotEndDate").value =
        endDate.toISOString().split("T")[0];

    ["bread", "cookie", "dessert"].forEach(category => {
        const container = document.getElementById(category + "Inputs");
        container.innerHTML = "";

        for (let i = 0; i < 5; i++) {
            addBallotInput(category);
        }
    });
}

function closeNewBallotModal() {
    document.getElementById("newBallotModal").style.display = "none";
}

function addBallotInput(category) {
    const container = document.getElementById(category + "Inputs");

    const input = document.createElement("input");
    input.type = "text";
    input.className = "ballot-input";
    input.placeholder = "Option name";

    container.appendChild(input);
}

async function startNewBallot() {

    const title =
        document.getElementById("newBallotTitle")
            .value
            .trim();

    const endDate =
        document.getElementById("newBallotEndDate")
            .value;

    if (!title) {

        alert("Please enter a ballot title.");

        return;

    }

    if (!endDate) {

        alert("Please choose an end date.");

        return;

    }

    const bread = getNewBallotInputs("bread");
    const cookies = getNewBallotInputs("cookie");
    const desserts = getNewBallotInputs("dessert");

    if (!bread.length || !cookies.length || !desserts.length) {

        alert("Please enter at least one option for every category.");

        return;

    }

    if (!confirm(
        "Start a new ballot? This will archive the current ballot and begin a new one."
    )) return;

    const { error: rpcError } =
        await supabaseClient.rpc("prepare_new_ballot");

    if (rpcError) {

        console.error(rpcError);

        alert(rpcError.message);

        return;

    }

    const { data: settings } =
        await supabaseClient
            .from("ballot_settings")
            .select("id")
            .limit(1)
            .single();

    const { error: settingsError } =
        await supabaseClient
            .from("ballot_settings")
            .update({

                title,

                description:
                    "Vote for the next bread, cookie, and dessert you'd like to see.",

                start_date: new Date().toISOString(),

                end_date: endDate,

                active: true,

                show_results: true

            })
            .eq("id", settings.id);

    if (settingsError) {

        console.error(settingsError);

        alert(settingsError.message);

        return;

    }

    const options = [

        ...bread.map(name => ({
            category: "bread",
            name,
            active: true
        })),

        ...cookies.map(name => ({
            category: "cookie",
            name,
            active: true
        })),

        ...desserts.map(name => ({
            category: "dessert",
            name,
            active: true
        }))

    ];

    const { error: optionError } =
        await supabaseClient
            .from("ballot_options")
            .insert(options);

    if (optionError) {

        console.error(optionError);

        alert(optionError.message);

        return;

    }

    closeNewBallotModal();

    loadBallotManager();

}

function getNewBallotInputs(category) {
    return [...document.querySelectorAll(`#${category}Inputs input`)]
        .map(input => input.value.trim())
        .filter(Boolean);
}

/* =========================
   HELPERS
========================= */

function formatDate(dateString) {
    if (!dateString) return "Not set";

    return new Date(dateString).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

function formatDateForInput(dateString) {
    if (!dateString) return "";

    return new Date(dateString).toISOString().split("T")[0];
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

async function logout() {
    await supabaseClient.auth.signOut();
    location.reload();
}

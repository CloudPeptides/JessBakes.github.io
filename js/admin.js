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
            <div class="ballot-admin-actions">
                <p>No active ballot found.</p>
                <button class="approve-btn" onclick="startNewBallot()">Start New Ballot</button>
            </div>
        `;
        return;
    }

    const bread = options.filter((option) => option.category === "bread");
    const cookies = options.filter((option) => option.category === "cookie");
    const desserts = options.filter((option) => option.category === "dessert");

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

        <div class="ballot-date-editor">
            <label for="ballotEndDate">Change Voting End Date</label>
            <input type="date" id="ballotEndDate" value="${formatDateForInput(settings.end_date)}">
            <button class="edit-option-btn" onclick="saveBallotEndDate('${settings.id}')">
                Save Date
            </button>
        </div>

        <div class="ballot-admin-controls">
            <button class="delete-btn" onclick="endCurrentBallot('${settings.id}')">
                End Current Ballot
            </button>

            <button class="approve-btn" onclick="startNewBallot()">
                Start New Ballot
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
                    ? "<p>No options yet.</p>"
                    : options.map((option) => {
                        const voteCount = votes.filter(
                            (vote) => vote.option_id === option.id
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
        alert("Please enter a ballot option name.");
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
    if (!confirm(`Remove "${name}" from the ballot?`)) return;

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

async function saveBallotEndDate(settingsId) {
    const endDate = document.getElementById("ballotEndDate").value;

    if (!endDate) {
        alert("Please choose an end date.");
        return;
    }

    const { error } = await supabaseClient
        .from("ballot_settings")
        .update({
            end_date: endDate
        })
        .eq("id", settingsId);

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    loadBallotManager();
}

async function endCurrentBallot(settingsId) {
    if (!confirm("End the current ballot? Voting will close.")) return;

    const { error } = await supabaseClient
        .from("ballot_settings")
        .update({ active: false })
        .eq("id", settingsId);

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    loadBallotManager();
}

async function startNewBallot() {
    const confirmed = confirm(
        "Start a new ballot? This will archive current winners, reset all votes, and create a new active ballot."
    );

    if (!confirmed) return;

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
            .eq("active", true),

        supabaseClient
            .from("votes")
            .select("*")
    ]);

    if (settingsResult.error || optionsResult.error || votesResult.error) {
        console.error(settingsResult.error || optionsResult.error || votesResult.error);
        alert("Could not start a new ballot.");
        return;
    }

    const currentSettings = settingsResult.data;
    const options = optionsResult.data || [];
    const votes = votesResult.data || [];

    if (currentSettings && votes.length) {
        const historyRows = buildHistoryRows(currentSettings, options, votes);

        if (historyRows.length) {
            const { error: historyError } = await supabaseClient
                .from("ballot_history")
                .insert(historyRows);

            if (historyError) {
                console.error(historyError);
                alert(historyError.message);
                return;
            }
        }
    }

    if (currentSettings) {
        const { error: closeError } = await supabaseClient
            .from("ballot_settings")
            .update({ active: false })
            .eq("id", currentSettings.id);

        if (closeError) {
            console.error(closeError);
            alert(closeError.message);
            return;
        }
    }

    const { error: deleteVotesError } = await supabaseClient
        .from("votes")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");

    if (deleteVotesError) {
        console.error(deleteVotesError);
        alert(deleteVotesError.message);
        return;
    }

    const today = new Date();
    const endDate = new Date();
    endDate.setDate(today.getDate() + 30);

    const title = prompt("New ballot title:", "Bakery Ballot");

    if (!title) return;

    const { error: newSettingsError } = await supabaseClient
        .from("ballot_settings")
        .insert({
            title,
            description: "Vote for the next bread, cookie, and dessert you would like to see.",
            start_date: today.toISOString(),
            end_date: endDate.toISOString(),
            active: true,
            show_results: true
        });

    if (newSettingsError) {
        console.error(newSettingsError);
        alert(newSettingsError.message);
        return;
    }

    loadBallotManager();
}

function buildHistoryRows(settings, options, votes) {
    const categories = ["bread", "cookie", "dessert"];

    return categories
        .map((category) => {
            const categoryOptions = options.filter((option) => option.category === category);
            const categoryVotes = votes.filter((vote) => vote.category === category);

            if (!categoryOptions.length || !categoryVotes.length) {
                return null;
            }

            const ranked = categoryOptions
                .map((option) => {
                    const count = categoryVotes.filter((vote) => vote.option_id === option.id).length;

                    return {
                        name: option.name,
                        votes: count
                    };
                })
                .sort((a, b) => b.votes - a.votes);

            const winner = ranked[0];

            return {
                ballot_title: settings.title || "Bakery Ballot",
                category,
                winner: winner.name,
                votes: winner.votes,
                total_votes: categoryVotes.length,
                ended_at: new Date().toISOString()
            };
        })
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

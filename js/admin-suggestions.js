/*==================================================
    ADMIN SUGGESTIONS
==================================================*/

document.addEventListener("DOMContentLoaded", async () => {
    await requireAuth();
    setupLogout();
    await loadSuggestions();
});

let suggestions = [];

async function loadSuggestions() {
    const container = document.getElementById("suggestionsManager");

    if (container) container.innerHTML = "<p>Loading suggestions...</p>";

    const { data, error } = await supabaseClient
        .from("suggestions")
        .select("*")
        .order("times_requested", { ascending: false })
        .order("created_at", { ascending: false });

    if (error) {
        console.error(error);
        if (container) container.innerHTML = "<p>Unable to load suggestions.</p>";
        return;
    }

    suggestions = data || [];
    updateSuggestionStats();
    renderSuggestions();
}

function updateSuggestionStats() {
    setText("newSuggestionCount", suggestions.filter(item => item.status === "new").length);
    setText("reviewedSuggestionCount", suggestions.filter(item => item.status === "reviewed").length);
    setText("ballotSuggestionCount", suggestions.filter(item => item.status === "added_to_ballot").length);
    setText("totalSuggestionCount", suggestions.length);
}

function renderSuggestions() {
    const container = document.getElementById("suggestionsManager");
    if (!container) return;

    if (!suggestions.length) {
        container.innerHTML = "<p>No suggestions yet.</p>";
        return;
    }

    const groups = {
        new: suggestions.filter(item => item.status === "new"),
        reviewed: suggestions.filter(item => item.status === "reviewed"),
        added_to_ballot: suggestions.filter(item => item.status === "added_to_ballot"),
        declined: suggestions.filter(item => item.status === "declined")
    };

    container.innerHTML = `
        ${renderSuggestionSection("New Suggestions", groups.new, "new")}
        ${renderSuggestionSection("Reviewed", groups.reviewed, "reviewed")}
        ${renderSuggestionSection("Added To Ballot", groups.added_to_ballot, "added_to_ballot")}
        ${renderSuggestionSection("Declined", groups.declined, "declined")}
    `;
}

function renderSuggestionSection(title, items, sectionKey) {
    const sectionId = `suggestions-${sectionKey}`;

    return `
        <section class="order-section">
            <button class="order-section-header" onclick="toggleSuggestionSection('${sectionId}')">
                <div>
                    <h3>${escapeHtml(title)}</h3>
                    <small>${items.length} suggestion${items.length === 1 ? "" : "s"}</small>
                </div>
                <span id="${sectionId}-icon">${items.length ? "▼" : "►"}</span>
            </button>

            <div id="${sectionId}" style="display:${items.length ? "block" : "none"};">
                ${items.length ? items.map(renderSuggestionCard).join("") : `<p class="empty-orders">No suggestions.</p>`}
            </div>
        </section>
    `;
}

function renderSuggestionCard(item) {
    return `
        <article class="order-card">
            <div class="order-card-header">
                <div>
                    <span class="status-badge status-${getSuggestionStatusClass(item.status)}">
                        ${escapeHtml(formatSuggestionStatus(item.status))}
                    </span>

                    <h3 style="margin-top:14px;">${escapeHtml(item.suggestion)}</h3>
                    <p>${escapeHtml(formatCategory(item.category))}</p>
                </div>

                <div style="text-align:right;">
                    <strong style="font-size:1.3rem;color:var(--accent);">${Number(item.times_requested || 1)}</strong>
                    <small style="display:block;color:#777;">request${Number(item.times_requested || 1) === 1 ? "" : "s"}</small>
                </div>
            </div>

            <div class="order-meta">
                <div>
                    <strong>Submitted By</strong>
                    <p>${escapeHtml(item.customer_name || "Anonymous")}</p>
                </div>

                <div>
                    <strong>Category</strong>
                    <p>${escapeHtml(formatCategory(item.category))}</p>
                </div>

                <div>
                    <strong>Submitted</strong>
                    <p>${formatDate(item.created_at)}</p>
                </div>
            </div>

            <div class="order-actions">
                ${item.status !== "added_to_ballot" ? `
                    <button class="approve-btn" onclick="addSuggestionToBallot('${item.id}')">
                        Add To Ballot
                    </button>
                ` : ""}

                ${item.status !== "reviewed" ? `
                    <button class="edit-option-btn" onclick="updateSuggestionStatus('${item.id}','reviewed')">
                        Mark Reviewed
                    </button>
                ` : ""}

                ${item.status !== "declined" ? `
                    <button class="remove-option-btn" onclick="updateSuggestionStatus('${item.id}','declined')">
                        Decline
                    </button>
                ` : ""}

                ${item.status !== "new" ? `
                    <button class="secondary-btn" onclick="updateSuggestionStatus('${item.id}','new')">
                        Move To New
                    </button>
                ` : ""}

                <button class="delete-btn" onclick="deleteSuggestion('${item.id}','${escapeJs(item.suggestion)}')">
                    Delete
                </button>
            </div>
        </article>
    `;
}

async function updateSuggestionStatus(id, status) {
    const { error } = await supabaseClient
        .from("suggestions")
        .update({ status })
        .eq("id", id);

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    await loadSuggestions();
}

async function addSuggestionToBallot(id) {
    const suggestion = suggestions.find(item => String(item.id) === String(id));
    if (!suggestion) return;

    if (!confirm(`Add "${suggestion.suggestion}" to the active ballot?`)) return;

    const { data: existing, error: lookupError } = await supabaseClient
        .from("ballot_options")
        .select("id")
        .eq("category", suggestion.category)
        .ilike("name", suggestion.suggestion)
        .eq("active", true)
        .maybeSingle();

    if (lookupError) {
        console.error(lookupError);
        alert(lookupError.message);
        return;
    }

    if (!existing) {
        const { error: insertError } = await supabaseClient
            .from("ballot_options")
            .insert({
                category: suggestion.category,
                name: suggestion.suggestion,
                active: true
            });

        if (insertError) {
            console.error(insertError);
            alert(insertError.message);
            return;
        }
    }

    const { error: updateError } = await supabaseClient
        .from("suggestions")
        .update({ status: "added_to_ballot" })
        .eq("id", id);

    if (updateError) {
        console.error(updateError);
        alert(updateError.message);
        return;
    }

    alert("Suggestion added to the ballot.");
    await loadSuggestions();
}

async function deleteSuggestion(id, suggestionText) {
    if (!confirm(`Delete "${suggestionText}"?\n\nThis cannot be undone.`)) return;

    const { error } = await supabaseClient
        .from("suggestions")
        .delete()
        .eq("id", id);

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    await loadSuggestions();
}

function toggleSuggestionSection(id) {
    const section = document.getElementById(id);
    const icon = document.getElementById(id + "-icon");
    if (!section || !icon) return;

    if (section.style.display === "none") {
        section.style.display = "block";
        icon.textContent = "▼";
    } else {
        section.style.display = "none";
        icon.textContent = "►";
    }
}

function formatCategory(category) {
    const labels = {
        bread: "Bread",
        cookie: "Cookie",
        dessert: "Dessert",
        seasonal: "Seasonal"
    };

    return labels[category] || category || "Other";
}

function formatSuggestionStatus(status) {
    const labels = {
        new: "New",
        reviewed: "Reviewed",
        added_to_ballot: "Added To Ballot",
        declined: "Declined"
    };

    return labels[status] || status || "New";
}

function getSuggestionStatusClass(status) {
    const classes = {
        new: "pending",
        reviewed: "confirmed",
        added_to_ballot: "ready",
        declined: "cancelled"
    };

    return classes[status] || "pending";
}

function formatDate(date) {
    if (!date) return "Not set";

    return new Date(date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function escapeJs(value) {
    return String(value || "")
        .replaceAll("\\", "\\\\")
        .replaceAll("'", "\\'")
        .replaceAll('"', "&quot;")
        .replaceAll("\n", " ");
}

window.loadSuggestions = loadSuggestions;
window.updateSuggestionStatus = updateSuggestionStatus;
window.addSuggestionToBallot = addSuggestionToBallot;
window.deleteSuggestion = deleteSuggestion;
window.toggleSuggestionSection = toggleSuggestionSection;

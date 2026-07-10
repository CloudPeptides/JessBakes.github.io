document.addEventListener("DOMContentLoaded", async () => {
    await requireAuth();
    setupLogout();
    loadPendingReviews();
});

async function loadPendingReviews() {
    const container = document.getElementById("pendingReviews");

    if (!container) return;

    container.innerHTML = "<p>Loading reviews...</p>";

    const { data, error } = await supabaseClient
        .from("reviews")
        .select("*")
        .eq("approved", false)
        .order("created_at", { ascending: true });

    if (error) {
        console.error(error);
        container.innerHTML = "<p>Unable to load reviews.</p>";
        return;
    }

    renderPendingReviews(data || []);
}

function renderPendingReviews(reviews) {
    const container = document.getElementById("pendingReviews");

    if (!reviews.length) {
        container.innerHTML = "<p>No pending reviews.</p>";
        return;
    }

    container.innerHTML = reviews.map(review => `
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

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

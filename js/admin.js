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

                    <p class="eyebrow">

                        Jess Bakes Sourdough

                    </p>

                    <h1>

                        Admin Dashboard

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

            <div class="dashboard-card">

    <h3>Pending Reviews</h3>

    <div id="pendingReviews">

        Loading...

    </div>

</div>

                <div class="dashboard-card">

                    <h3>Bakery Ballot</h3>

                    <p>Loading...</p>

                </div>

                <div class="dashboard-card">

                    <h3>Menu Items</h3>

                    <p>Coming Soon</p>

                </div>

                <div class="dashboard-card">

                    <h3>Orders</h3>

                    <p>Coming Soon</p>

                </div>

            </div>

        </div>

    `;

    document
        .getElementById("logoutBtn")
        .addEventListener("click", logout);
   
    loadPendingReviews();

    function renderPendingReviews(reviews) {

    const container = document.getElementById("pendingReviews");

    if (!reviews.length) {

        container.innerHTML = `

            <p>No pending reviews 🎉</p>

        `;

        return;

    }

    container.innerHTML = reviews.map(review => `

        <div class="pending-review">

            <div class="pending-review-header">

                <strong>${review.name}</strong>

                <span>${"★".repeat(review.rating)}</span>

            </div>

            <p><strong>${review.product}</strong></p>

            <p>${review.review}</p>

            <div class="review-actions">

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

        </div>

    `).join("");

}

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

async function logout() {

    await supabaseClient.auth.signOut();

    location.reload();

}

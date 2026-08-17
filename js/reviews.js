let reviews = [];
let selectedRating = 0;

document.addEventListener("DOMContentLoaded", () => {

    initializeStars();

    loadReviews();

    document
        .getElementById("reviewForm")
        .addEventListener("submit", submitReview);

});

async function loadReviews() {

    const { data, error } = await supabaseClient

        .from("reviews")

        .select("*")

        .eq("approved", true)

        .order("created_at", {
            ascending: false
        });

    if (error) {

        console.error(error);

        return;

    }

    reviews = data || [];

    renderReviewSummary();

    renderReviews();

}

function renderReviewSummary() {

    const summary = document.getElementById("reviewSummary");

    if (!reviews.length) {

        summary.innerHTML = `

            <div class="review-summary-card">

                <div class="review-stars">

                    ★★★★★

                </div>

                <h3>No reviews yet</h3>

                <p>

                    Be the first to leave a review after trying one of my bakes.

                </p>

            </div>

        `;

        return;

    }

    const totalReviews = reviews.length;

    const average =

        reviews.reduce((sum, review) => sum + review.rating, 0)

        / totalReviews;

    summary.innerHTML = `

        <div class="review-summary-card">

            <div class="review-stars">

                ${generateStars(Math.round(average))}

            </div>

            <h3>${average.toFixed(1)} Average Rating</h3>

            <p>

                Based on ${totalReviews}

                review${totalReviews === 1 ? "" : "s"}

            </p>

        </div>

    `;

}

function renderReviews() {

    const list = document.getElementById("reviewList");

    if (!reviews.length) {

        list.innerHTML = "";

        return;

    }

    list.innerHTML = reviews

        .map(review => createReviewCard(review))

        .join("");

}

function createReviewCard(review) {

    return `

        <article class="review-card">

            <div class="review-stars">

                ${generateStars(review.rating)}

            </div>

            <h3>

                ${review.product}

            </h3>

            <p class="review-text">

                "${review.review}"

            </p>

            <div class="review-footer">

                <strong>

                    ${review.name}

                </strong>

                <span>

                    ${formatDate(review.created_at)}

                </span>

            </div>

        </article>

    `;

}

function generateStars(rating) {

    let stars = "";

    for (let i = 1; i <= 5; i++) {

        stars += i <= rating ? "★" : "☆";

    }

    return stars;

}

function formatDate(dateString) {

    return new Date(dateString)

        .toLocaleDateString("en-US", {

            month: "long",

            year: "numeric"

        });

}


function initializeStars() {

    const stars = document.querySelectorAll("#starRating button");

    stars.forEach((star) => {

        star.addEventListener("mouseenter", () => {

            highlightStars(Number(star.dataset.rating));

        });

        star.addEventListener("mouseleave", () => {

            highlightStars(selectedRating);

        });

        star.addEventListener("click", () => {

            selectedRating = Number(star.dataset.rating);

            document.getElementById("reviewRating").value = selectedRating;

            highlightStars(selectedRating);

        });

    });

}

function highlightStars(rating) {

    const stars = document.querySelectorAll("#starRating button");

    stars.forEach((star) => {

        const value = Number(star.dataset.rating);

        if (value <= rating) {

            star.textContent = "★";

            star.classList.add("active");

        } else {

            star.textContent = "☆";

            star.classList.remove("active");

        }

    });

}

function showReviewMessage(message, type = "error") {

    const box = document.getElementById("reviewMessage");

    box.textContent = message;

    box.className = `review-message ${type}`;

    box.style.display = "block";

}

async function submitReview(e) {

    e.preventDefault();
    document.getElementById("reviewMessage").style.display = "none";

    const name = document
        .getElementById("reviewName")
        .value
        .trim();

    const product = document
        .getElementById("reviewProduct")
        .value;

    const review = document
        .getElementById("reviewText")
        .value
        .trim();

    if (!name || !product || !review) {

        showReviewMessage("Please complete all fields.");

        return;

    }

    if (!selectedRating) {

        showReviewMessage("Please select a star rating.");

        return;

    }

    const submitButton = document.querySelector("#reviewForm button");

    submitButton.disabled = true;

    submitButton.textContent = "Submitting...";

    const { error } = await supabaseClient

        .from("reviews")

        .insert({

            name,

            product,

            rating: selectedRating,

            review,

            approved: false,

            featured: false

        });

    submitButton.disabled = false;

    submitButton.textContent = "Share Your Review";

    if (error) {

        console.error(error);

        showReviewMessage(
            "Something went wrong while submitting your review. Please try again."
        );

    }

    document.getElementById("reviewForm").style.display = "none";

    document.getElementById("reviewSuccess").style.display = "block";

}

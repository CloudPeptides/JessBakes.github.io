/*==================================================
    COMMUNITY FAVORITES
==================================================*/

document.addEventListener("DOMContentLoaded", () => {

    loadCommunityFavorites();

});

async function loadCommunityFavorites() {

    const container =
        document.getElementById("communityFavorites");

    if (!container) return;

    container.innerHTML = `
        <div class="favorite-loading">
            Loading winners...
        </div>
    `;

    const { data, error } = await supabaseClient
        .from("ballot_history")
        .select("*")
        .order("ended_at", {
            ascending: false
        });

    if (error) {

        console.error(error);

        container.innerHTML = `
            <div class="favorite-loading">
                Unable to load community favorites.
            </div>
        `;

        return;

    }

    if (!data || data.length === 0) {

        container.innerHTML = `
            <div class="favorite-loading">
                No winners yet.
            </div>
        `;

        return;

    }

    const latest = {};

    data.forEach(row => {

        if (!latest[row.category]) {

            latest[row.category] = row;

        }

    });

    const order = [
        "bread",
        "cookie",
        "dessert",
        "seasonal"
    ];

    const icons = {

        bread: "🍞",
        cookie: "🍪",
        dessert: "🧁",
        seasonal: "⭐"

    };

    const names = {

        bread: "Bread",
        cookie: "Cookie",
        dessert: "Dessert",
        seasonal: "Seasonal"

    };

    const cards = order
        .filter(category => latest[category])
        .map(category => {

            const item = latest[category];

            return `

<div class="favorite-card">

    <div class="favorite-icon">

        ${icons[category]}

    </div>

    <div class="favorite-category">

        ${names[category]}

    </div>

    <div class="favorite-name">

        ${escapeHtml(item.winner)}

    </div>

    <div class="favorite-votes">

        ${item.votes} vote${item.votes === 1 ? "" : "s"}

    </div>

    <div class="favorite-date">

        ${formatDate(item.ended_at)}

    </div>

</div>

`;

        });

    container.innerHTML = cards.join("");

}

function formatDate(date) {

    return new Date(date).toLocaleDateString(
        "en-US",
        {
            month: "long",
            day: "numeric",
            year: "numeric"
        }
    );

}

function escapeHtml(text) {

    if (text == null) return "";

    return text
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

}

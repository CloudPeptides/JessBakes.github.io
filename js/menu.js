const MENU_CATEGORY_NAMES = {
    bread: "Sourdough Bread",
    cookie: "Sourdough Cookies",
    dessert: "Desserts",
    seasonal: "Seasonal Specials"
};

document.addEventListener("DOMContentLoaded", () => {
    loadMenu();
});

async function loadMenu() {

    const container = document.getElementById("menuContainer");

    container.innerHTML = "<p>Loading menu...</p>";

    const { data, error } = await supabaseClient
        .from("menu_items")
        .select("*")
        .eq("available", true)
        .order("category", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

    if (error) {

        console.error(error);

        container.innerHTML = `

            <article class="notice-card">

                <h2>

                    Unable to load menu.

                </h2>

                <p>

                    Please try again later.

                </p>

            </article>

        `;

        return;

    }

    renderMenu(data || []);

}

function renderMenu(items) {

    const container = document.getElementById("menuContainer");

    if (!items.length) {

        container.innerHTML = `

            <article class="notice-card">

                <h2>

                    Menu Coming Soon

                </h2>

                <p>

                    Fresh bakes will appear here soon.

                </p>

            </article>

        `;

        return;

    }

    let html = "";

    Object.keys(MENU_CATEGORY_NAMES).forEach(category => {

        const categoryItems = items.filter(
            item => item.category === category
        );

        if (!categoryItems.length) return;

        html += `

            <div class="menu-section">

                <div class="menu-section-title">

                    <h2>

                        ${MENU_CATEGORY_NAMES[category]}

                    </h2>

                </div>

                <div class="menu-grid ${category === "cookie" ? "two" : ""}">

                    ${categoryItems.map(createMenuCard).join("")}

                </div>

            </div>

        `;

    });

    container.innerHTML = html;

}

function createMenuCard(item) {

    return `

        <article class="menu-item ${item.category === "cookie" ? "full" : ""}">

            <div class="menu-item-top">

                <h3>

                    ${escapeHtml(item.name)}

                    ${item.featured
                        ? `<span class="featured-badge">★ Featured</span>`
                        : ""}

                </h3>

                <span class="price">

                    €${formatPrice(item.price)}

                </span>

            </div>

            <p>

                ${escapeHtml(item.description || "")}

            </p>

        </article>

    `;

}

function formatPrice(price) {

    const value = Number(price);

    if (Number.isNaN(value)) {

        return "0";

    }

    return value
        .toFixed(2)
        .replace(/\.00$/, "");

}

function escapeHtml(text) {

    return String(text || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

}

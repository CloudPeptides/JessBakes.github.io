const profileContainer =
    document.getElementById("packagingProfiles");

async function loadPackaging() {

    const { data, error } =
        await supabase
            .from("packaging_profile_costs")
            .select("*")
            .order("name");

    if (error) {

        console.error(error);

        return;

    }

    renderProfiles(data);

}

function renderProfiles(profiles) {

    document.getElementById("profileCount").textContent =
        profiles.length;

    profileContainer.innerHTML =
        profiles.map(renderProfileCard).join("");

}

function renderProfileCard(profile) {

    return `

        <article class="packaging-card">

            <h3>

                ${profile.name}

            </h3>

            <p>

                ${profile.item_count} items

            </p>

            <h2>

                $${Number(profile.packaging_cost).toFixed(2)}

            </h2>

            <button class="primary-btn">

                Edit

            </button>

        </article>

    `;

}

loadPackaging();

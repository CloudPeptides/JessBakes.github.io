document.addEventListener("DOMContentLoaded", async () => {

    await requireAuth();
    await loadBakerySettings();

    document
        .getElementById("saveBakerySettingsBtn")
        .addEventListener("click", saveBakerySettings);

});

function showMessage(text, kind) {

    const el = document.getElementById("settingsMessage");
    el.textContent = text;
    el.className = `admin-inline-message is-${kind}`;
    el.style.display = "block";

}

async function loadBakerySettings() {

    const { data, error } =
        await supabaseClient
            .from("bakery_settings")
            .select("pickup_location")
            .limit(1)
            .maybeSingle();

    if (error) {

        console.error(error);
        showMessage("Couldn't load settings. Try reloading the page.", "error");
        return;

    }

    document.getElementById("pickupLocation").value =
        data?.pickup_location || "";

}

async function saveBakerySettings() {

    const button = document.getElementById("saveBakerySettingsBtn");
    const pickup_location =
        document.getElementById("pickupLocation").value.trim();

    button.disabled = true;
    showMessage("Saving...", "loading");

    const { data: existing } =
        await supabaseClient
            .from("bakery_settings")
            .select("id")
            .limit(1)
            .maybeSingle();

    const { error } = existing
        ? await supabaseClient
            .from("bakery_settings")
            .update({ pickup_location, updated_at: new Date().toISOString() })
            .eq("id", existing.id)
        : await supabaseClient
            .from("bakery_settings")
            .insert({ pickup_location });

    button.disabled = false;

    if (error) {

        console.error(error);
        showMessage("Couldn't save. Please try again.", "error");
        return;

    }

    showMessage("Saved. This only appears in confirmed-order emails — never publicly.", "success");

}

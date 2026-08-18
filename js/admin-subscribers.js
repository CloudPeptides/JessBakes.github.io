let subscribers = [];

document.addEventListener("DOMContentLoaded", async () => {

    await requireAuth();

    loadSubscribers();

    document
        .getElementById("subscriberSearch")
        .addEventListener("input", filterSubscribers);

});

async function loadSubscribers() {

    const { data, error } =
        await supabaseClient
            .from("subscribers")
            .select("*")
            .eq("is_active", true)
            .order("created_at", {
                ascending: false
            });

    if (error) {

        console.error(error);

        return;

    }

    subscribers = data;

    renderSubscribers(subscribers);

}

function renderSubscribers(list) {

    document.getElementById("subscriberCount").textContent =
        list.length;

    const tbody =
        document.getElementById("subscriberTableBody");

    tbody.innerHTML = "";

    list.forEach(subscriber => {

        const tr =
            document.createElement("tr");

        tr.innerHTML = `

            <td>${escapeHtml(subscriber.name)}</td>

            <td>${escapeHtml(subscriber.email)}</td>

            <td>${escapeHtml(subscriber.status || "active")}</td>

            <td>${formatDate(subscriber.created_at)}</td>

            <td>

                <button
                    class="danger-btn"
                    onclick="deleteSubscriber('${subscriber.id}')">

                    Unsubscribe

                </button>

            </td>

        `;

        tbody.appendChild(tr);

    });

}

function filterSubscribers() {

    const search =
        document
            .getElementById("subscriberSearch")
            .value
            .toLowerCase();

    renderSubscribers(

        subscribers.filter(subscriber =>

            subscriber.name.toLowerCase().includes(search) ||

            subscriber.email.toLowerCase().includes(search)

        )

    );

}

// Admin-side "delete" means unsubscribe -- the same status flip the
// public one-click unsubscribe link performs, so the record and its
// history stay intact rather than being destroyed.
async function deleteSubscriber(id) {

    if (!confirm("Unsubscribe this person from the weekly menu email?")) {

        return;

    }

    const { error } =
        await supabaseClient
            .from("subscribers")
            .update({

                status: "unsubscribed"

            })
            .eq("id", id);

    if (error) {

        alert(error.message);

        return;

    }

    loadSubscribers();

}

function formatDate(date) {

    return new Date(date)
        .toLocaleDateString();

}

function escapeHtml(text) {
    return String(text ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

let subscribers = [];

document.addEventListener("DOMContentLoaded", () => {

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

            <td>${subscriber.name}</td>

            <td>${subscriber.email}</td>

            <td>${formatDate(subscriber.created_at)}</td>

            <td>

                <button
                    class="danger-btn"
                    onclick="deleteSubscriber('${subscriber.id}')">

                    Delete

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

async function deleteSubscriber(id) {

    if (!confirm("Delete this subscriber?")) {

        return;

    }

    const { error } =
        await supabaseClient
            .from("subscribers")
            .update({

                is_active: false

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

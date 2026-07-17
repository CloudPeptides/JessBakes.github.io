let quill;
let subscribers = [];

document.addEventListener("DOMContentLoaded", () => {

    loadSubscribers();

    document
        .getElementById("subscriberSearch")
        .addEventListener("input", filterSubscribers);

    const editor =
        document.getElementById("newsletterEditor");

    if (editor) {

        quill = new Quill(editor, {

            theme: "snow",

            placeholder:
                "Write this week's newsletter..."

        });

    }

    document
        .getElementById("testNewsletterBtn")
        .addEventListener(
            "click",
            sendTestNewsletter
        );

    document
        .getElementById("sendNewsletterBtn")
        .addEventListener(
            "click",
            sendNewsletter
        );

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

async function sendTestNewsletter() {

    const button =
        document.getElementById("testNewsletterBtn");

    button.disabled = true;

    try {

        const subject =
            document
                .getElementById("newsletterSubject")
                .value
                .trim();

        const html =
            quill.root.innerHTML;

        if (!subject) {

            alert("Please enter a subject.");

            return;

        }

        if (
            !html ||
            html === "<p><br></p>"
        ) {

            alert("Please write your newsletter.");

            return;

        }

        const { error } =
            await supabaseClient
                .functions
                .invoke(
                    "rapid-worker",
                    {
                        body: {

                            mode: "test",

                            subject,

                            html

                        }
                    }
                );

        if (error) {

            alert(error.message);

            return;

        }

        alert(
            "Test email sent to jessica.holsopple3@gmail.com."
        );

    } finally {

        button.disabled = false;

    }

}

async function sendNewsletter() {

    if (

        !confirm(

            `Send this newsletter to ${subscribers.length} subscribers?`

        )

    ) {

        return;

    }

    const button =
        document.getElementById("sendNewsletterBtn");

    button.disabled = true;

    try {

        const subject =
            document
                .getElementById("newsletterSubject")
                .value
                .trim();

        const html =
            quill.root.innerHTML;

        if (!subject) {

            alert("Please enter a subject.");

            return;

        }

        if (
            !html ||
            html === "<p><br></p>"
        ) {

            alert("Please write your newsletter.");

            return;

        }

        const { data, error } =
            await supabaseClient
                .functions
                .invoke(
                    "rapid-worker",
                    {
                        body: {

                            mode: "newsletter",

                            subject,

                            html

                        }
                    }
                );

        if (error) {

            alert(error.message);

            return;

        }

        alert(

            `Newsletter sent to ${data?.sent ?? 0} subscribers!`

        );

    } finally {

        button.disabled = false;

    }

}

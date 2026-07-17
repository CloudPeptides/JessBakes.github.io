const newsletterForm =
    document.getElementById("newsletterForm");

if (newsletterForm) {

    newsletterForm.addEventListener(
        "submit",
        subscribeToNewsletter
    );

}

async function subscribeToNewsletter(e) {

    e.preventDefault();

    const email =
        document
            .getElementById("newsletterEmail")
            .value
            .trim()
            .toLowerCase();

    const message =
        document.getElementById("newsletterMessage");

    const { error } =
        await supabaseClient
            .from("subscribers")
            .insert({

                email

            });

    if (error) {

        if (error.code === "23505") {

            message.textContent =
                "You're already subscribed.";

            return;

        }

        message.textContent =
            "Something went wrong.";

        return;

    }

    message.textContent =
        "Thanks for subscribing!";

    newsletterForm.reset();

}

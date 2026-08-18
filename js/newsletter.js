const newsletterForm =
    document.getElementById("newsletterForm");

if (newsletterForm) {

    newsletterForm.addEventListener(
        "submit",
        subscribeToNewsletter
    );

}

// Public signups always go through the newsletter-subscribe Edge
// Function -- never a direct table insert -- so consent, honeypot,
// rate-limiting, and validation are enforced server-side no matter
// what the browser sends. See supabase/functions/newsletter-subscribe.
async function subscribeToNewsletter(e) {

    e.preventDefault();

    const submitButton = newsletterForm.querySelector("button[type='submit']");

    const name =
        document
            .getElementById("newsletterName")
            .value
            .trim();

    const email =
        document
            .getElementById("newsletterEmail")
            .value
            .trim()
            .toLowerCase();

    const consent =
        document.getElementById("newsletterConsent")?.checked === true;

    const honeypot =
        document.getElementById("newsletterWebsite")?.value || "";

    const message =
        document.getElementById("newsletterMessage");

    if (!consent) {

        message.textContent =
            "Please check the box to confirm you'd like to receive the weekly menu email.";

        return;

    }

    if (submitButton) {
        submitButton.disabled = true;
    }

    message.textContent = "";

    try {

        const { data, error } =
            await supabaseClient
                .functions
                .invoke(
                    "newsletter-subscribe",
                    {
                        body: { name, email, consent, honeypot }
                    }
                );

        if (error) {

            message.textContent =
                "Something went wrong. Please try again in a moment.";

            return;

        }

        if (!data?.ok) {

            message.textContent =
                data?.reason === "rate_limited"
                    ? "Please wait a moment before trying again."
                    : "Please enter a valid email address.";

            return;

        }

        message.textContent =
            data.alreadySubscribed
                ? "You're already subscribed!"
                : "Thanks for subscribing! Check your inbox for a confirmation.";

        newsletterForm.reset();

    } finally {

        if (submitButton) {
            submitButton.disabled = false;
        }

    }

}

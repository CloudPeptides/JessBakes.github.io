/* ==========================================
   UNSUBSCRIBE LANDING PAGE

   Reads the opaque token from the URL and immediately calls the
   newsletter-unsubscribe Edge Function -- no login, no second
   confirmation click, one-click unsubscribe as required. The token
   is single-purpose and hashed server-side; nothing here can be
   reused for anything other than unsubscribing.
   ========================================== */

document.addEventListener("DOMContentLoaded", async () => {

    const statusEl = document.getElementById("unsubscribeStatus");
    const token = new URLSearchParams(window.location.search).get("t");

    if (!token) {
        statusEl.textContent =
            "This unsubscribe link is missing its token. If you followed a link from an email, please try again from that email.";
        return;
    }

    try {

        const { data, error } =
            await supabaseClient
                .functions
                .invoke(
                    "newsletter-unsubscribe",
                    { body: { token } }
                );

        if (error || !data?.ok) {
            statusEl.textContent =
                "This unsubscribe link is no longer valid. If you're still receiving emails you don't want, please contact us.";
            return;
        }

        statusEl.textContent =
            "You've been unsubscribed. You won't receive any more menu emails.";

    } catch (err) {

        console.error(err);
        statusEl.textContent =
            "Something went wrong. Please try again in a moment, or contact us.";

    }

});

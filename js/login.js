/* ==========================================
   LOGIN
========================================== */

const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");

document.addEventListener("DOMContentLoaded", async () => {

    const {
        data: { session }
    } = await supabaseClient.auth.getSession();

    if (session) {

        window.location.href = resolvePostLoginDestination();

    }

});

/* ==========================================
   POST-LOGIN DESTINATION

   Normally the dashboard -- but if requireAuth() bounced someone here
   from a push-notification deep link (?order=<id> on orders.html), go
   back there instead once they're signed in. See js/auth.js.
========================================== */
function resolvePostLoginDestination() {

    const returnTo = sessionStorage.getItem("jb_admin_return_to");
    sessionStorage.removeItem("jb_admin_return_to");

    // Only ever trust a same-app relative path this site itself wrote
    // (see requireAuth() in js/auth.js) -- never an absolute/external
    // URL, so this can never become an open redirect.
    if (returnTo && returnTo.startsWith("admin/")) {
        return returnTo;
    }

    return "admin/dashboard.html";

}


/* ==========================================
   LOGIN
========================================== */

loginForm.addEventListener("submit", async (event) => {

    event.preventDefault();

    loginError.textContent = "";

    const email =
        document.getElementById("email").value.trim();

    const password =
        document.getElementById("password").value;

    const { error } =
        await supabaseClient.auth.signInWithPassword({

            email,
            password

        });

    if (error) {

        loginError.textContent = error.message;

        return;

    }

    window.location.href = resolvePostLoginDestination();

});

/* ==========================================
   AUTH
========================================== */

async function requireAuth() {

    const {
        data: { session }
    } = await supabaseClient.auth.getSession();

    if (!session) {

        // Preserve a push-notification deep link (?order=<id>) across
        // the login round-trip, so tapping a notification while signed
        // out still lands back on the right order afterward -- see
        // login.js, which reads this same key on successful sign-in.
        // Session-scoped and same-origin only; never touches the URL
        // itself, so no token/credential ever appears in it.
        if (window.location.search) {
            sessionStorage.setItem(
                "jb_admin_return_to",
                window.location.pathname + window.location.search
            );
        }

        window.location.href = "../admin.html";

        return null;

    }

    return session;

}

/* ==========================================
   LOGOUT
========================================== */

async function logout() {

    await supabaseClient.auth.signOut();

    window.location.href = "../admin.html";

}

function setupLogout() {

    const button = document.getElementById("logoutBtn");

    if (!button) return;

    button.addEventListener("click", logout);

}

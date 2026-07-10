/* ==========================================
   AUTH
========================================== */

async function requireAuth() {

    const {
        data: { session }
    } = await supabaseClient.auth.getSession();

    if (!session) {

        window.location.href = "admin.html";

        return null;

    }

    return session;

}

/* ==========================================
   LOGOUT
========================================== */

async function logout() {

    await supabaseClient.auth.signOut();

    window.location.href = "admin.html";

}

function setupLogout() {

    const button = document.getElementById("logoutBtn");

    if (!button) return;

    button.addEventListener("click", logout);

}

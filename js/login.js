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

        window.location.href = "admin/dashboard.html";

    }

});


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

    window.location.href = "admin/dashboard.html";

});

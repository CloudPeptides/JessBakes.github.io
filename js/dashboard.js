document.addEventListener("DOMContentLoaded", async () => {

    await requireAuth();

    document.getElementById("app").innerHTML = renderLayout(
        "Dashboard",
        `

<div class="dashboard-home">

    <h2>Dashboard</h2>

    <p>

        Welcome back, Jess.

    </p>

</div>

`
    );

    document
        .getElementById("logoutBtn")
        .addEventListener("click", logout);

});

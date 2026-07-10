/* ==========================================
   SHARED ADMIN LAYOUT
========================================== */

document.addEventListener("DOMContentLoaded", () => {

    highlightCurrentPage();

    setupLogout();

});


/* ==========================================
   ACTIVE NAV LINK
========================================== */

function highlightCurrentPage() {

    const currentPage =
        window.location.pathname
            .split("/")
            .pop();

    document
        .querySelectorAll(".sidebar-nav a")
        .forEach(link => {

            const href =
                link.getAttribute("href");

            link.classList.toggle(
                "active",
                href === currentPage
            );

        });

}


/* ==========================================
   LOGOUT
========================================== */

function setupLogout() {

    const button =
        document.getElementById("logoutBtn");

    if (!button) return;

    button.addEventListener("click", logout);

}

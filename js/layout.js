/* ==========================================
   SHARED ADMIN LAYOUT
========================================== */

function renderLayout(pageTitle, content) {

    return `

<div class="admin-shell">

    <aside class="sidebar">

        <div class="sidebar-brand">

            <h2>Jess Bakes</h2>

            <span>SOURDOUGH</span>

        </div>

        <nav class="sidebar-nav">

            ${navLink("Dashboard","dashboard.html",pageTitle)}
            ${navLink("Orders","orders.html",pageTitle)}
            ${navLink("Menu","menu-admin.html",pageTitle)}
            ${navLink("Reviews","reviews-admin.html",pageTitle)}

            <hr>

            ${navLink("Sales","sales.html",pageTitle)}
            ${navLink("Analytics","analytics.html",pageTitle)}
            ${navLink("Inventory","inventory.html",pageTitle)}
            ${navLink("Gallery","gallery.html",pageTitle)}

            <hr>

            ${navLink("Settings","settings.html",pageTitle)}

        </nav>

        <button
            id="logoutBtn"
            class="logout-btn">

            Sign Out

        </button>

    </aside>

    <main class="admin-content">

        <header class="admin-header">

            <div>

                <h1>${pageTitle}</h1>

                <p>

                    Jess Bakes Sourdough Admin

                </p>

            </div>

        </header>

        ${content}

    </main>

</div>

`;

}

/* ==========================================
   SIDEBAR LINKS
========================================== */

function navLink(title, href, currentPage){

    return `

<a
    href="${href}"
    class="${
        title === currentPage
            ? "active"
            : ""
    }">

    ${title}

</a>

`;

}

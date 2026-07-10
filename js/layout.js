function renderAdminLayout(pageTitle, pageContent) {

    return `

<div class="admin-shell">

    <aside class="admin-sidebar">

        <div class="sidebar-logo">

            <h2>Jess Bakes</h2>

            <span>SOURDOUGH</span>

        </div>

        <nav class="sidebar-nav">

            <a href="admin.html"
               class="${pageTitle === "Dashboard" ? "active" : ""}">
                Dashboard
            </a>

            <a href="admin-orders.html"
               class="${pageTitle === "Orders" ? "active" : ""}">
                Orders
            </a>

            <a href="admin-menu.html"
               class="${pageTitle === "Menu" ? "active" : ""}">
                Menu
            </a>

            <a href="admin-reviews.html"
               class="${pageTitle === "Reviews" ? "active" : ""}">
                Reviews
            </a>

            <a href="admin-ballot.html"
               class="${pageTitle === "Ballot" ? "active" : ""}">
                Ballot
            </a>

            <a href="admin-sales.html"
               class="${pageTitle === "Sales" ? "active" : ""}">
                Sales
            </a>

            <a href="admin-inventory.html"
               class="${pageTitle === "Inventory" ? "active" : ""}">
                Inventory
            </a>

            <a href="admin-gallery.html"
               class="${pageTitle === "Gallery" ? "active" : ""}">
                Gallery
            </a>

            <a href="admin-settings.html"
               class="${pageTitle === "Settings" ? "active" : ""}">
                Settings
            </a>

        </nav>

        <button
            id="logoutBtn"
            class="logout-btn">

            Sign Out

        </button>

    </aside>

    <main class="admin-main">

        <header class="admin-topbar">

            <div>

                <h1>${pageTitle}</h1>

                <p>Welcome back, Jess.</p>

            </div>

        </header>

        ${pageContent}

    </main>

</div>

`;

}

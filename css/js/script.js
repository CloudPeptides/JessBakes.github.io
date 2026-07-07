const mobileToggle = document.querySelector(".mobile-toggle");
const navSides = document.querySelectorAll(".nav-side");

if (mobileToggle && navSides.length) {
    mobileToggle.addEventListener("click", () => {
        navSides.forEach((nav) => {
            nav.classList.toggle("open");
        });
    });
}

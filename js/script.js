const mobileToggle = document.querySelector(".mobile-toggle");
const navLinks = document.querySelector(".nav-links");

if (mobileToggle && navLinks) {
  mobileToggle.addEventListener("click", () => {
    navLinks.classList.toggle("open");
  });
}
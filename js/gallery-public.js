/*==================================================
    PUBLIC GALLERY

    Read-only: fetches only published photos (RLS enforces this
    server-side regardless -- gallery_photos' public SELECT policy is
    `using (published = true)`, so even a tampered client-side query can
    never see a draft). No auth, no write calls, no admin controls.
==================================================*/

const GALLERY_BUCKET = "gallery";
const SIGNED_URL_TTL_SECONDS = 3600;

let publicPhotos = [];
let publicAlbums = [];
let publicSignedUrlByPath = new Map();
let activeAlbumFilter = null; // null = All, "none" = Uncategorized, else an album id
let visiblePhotos = [];

let lightboxIndex = -1;
let lightboxLastFocused = null;


/*==================================================
    INITIALIZATION
==================================================*/

document.addEventListener("DOMContentLoaded", () => {
    loadPublicGallery();
    setupLightbox();
});

async function loadPublicGallery() {
    try {
        const [photosResult, albumsResult] = await Promise.all([
            supabaseClient
                .from("gallery_photos")
                .select("*")
                .eq("published", true),

            supabaseClient
                .from("gallery_albums")
                .select("*")
                .order("sort_order", { ascending: true })
                .order("name", { ascending: true })
        ]);

        if (photosResult.error) throw photosResult.error;

        publicPhotos = photosResult.data || [];
        publicAlbums = albumsResult.error ? [] : (albumsResult.data || []);

        await signPublicPhotoUrls();

        if (!publicPhotos.length) {
            setState("No photos have been published yet. Check back soon!");
            renderFilters();
            renderGrid();
            return;
        }

        setState(null);
        renderFilters();
        renderGrid();
    } catch (err) {
        console.error(err);
        setState("Unable to load the gallery right now. Please try again later.", true);
    }
}

async function signPublicPhotoUrls() {
    const paths = [...new Set(publicPhotos.map(p => p.storage_path).filter(Boolean))];

    if (!paths.length) {
        publicSignedUrlByPath = new Map();
        return;
    }

    const { data, error } = await supabaseClient
        .storage
        .from(GALLERY_BUCKET)
        .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

    if (error) {
        console.error("Unable to sign gallery photo URLs:", error);
        publicSignedUrlByPath = new Map();
        return;
    }

    publicSignedUrlByPath = new Map(
        (data || [])
            .filter(entry => entry.signedUrl && !entry.error)
            .map(entry => [entry.path, entry.signedUrl])
    );
}

function setState(message, isError = false) {
    const stateEl = document.getElementById("galleryPublicState");
    if (!stateEl) return;

    if (!message) {
        stateEl.style.display = "none";
        stateEl.classList.remove("gallery-public-state-error");
        return;
    }

    stateEl.textContent = message;
    stateEl.style.display = "block";
    stateEl.classList.toggle("gallery-public-state-error", isError);
}


/*==================================================
    FILTERS
==================================================*/

function renderFilters() {
    const container = document.getElementById("galleryPublicFilters");
    if (!container) return;

    const published = publicPhotos; // already published-only from the query
    const chips = GalleryShared.buildPublicAlbumFilters(published, publicAlbums);

    if (chips.length <= 1) {
        container.innerHTML = "";
        return;
    }

    container.innerHTML = chips.map(chip => `
        <button
            type="button"
            class="gallery-filter-chip ${String(activeAlbumFilter) === String(chip.id) ? "active" : ""}"
            aria-pressed="${String(activeAlbumFilter) === String(chip.id)}"
            onclick="setPublicAlbumFilter(${chip.id === null ? "null" : `'${chip.id}'`})">

            ${escapeHtml(chip.label)} (${chip.count})

        </button>
    `).join("");
}

function setPublicAlbumFilter(albumId) {
    activeAlbumFilter = albumId;
    renderFilters();
    renderGrid();
}


/*==================================================
    GRID
==================================================*/

function renderGrid() {
    const grid = document.getElementById("galleryPublicGrid");
    if (!grid) return;

    if (!publicPhotos.length) {
        grid.innerHTML = "";
        return;
    }

    const filtered = GalleryShared.filterPhotos(publicPhotos, {
        status: "published",
        albumId: activeAlbumFilter
    });

    visiblePhotos = GalleryShared.sortForPublicGallery(filtered);

    if (!visiblePhotos.length) {
        grid.innerHTML = "";
        setState("No photos in this album yet.");
        return;
    }

    setState(null);

    grid.innerHTML = visiblePhotos.map((photo, index) => {
        const url = publicSignedUrlByPath.get(photo.storage_path);

        return `
            <button
                type="button"
                class="gallery-public-card"
                aria-label="View larger photo: ${escapeHtml(photo.title)}"
                onclick="openLightbox(${index})">

                ${photo.featured ? `<span class="gallery-featured-badge">★ Featured</span>` : ""}

                ${url
                    ? `<img src="${url}" alt="${escapeHtml(photo.alt_text || photo.title)}" loading="lazy" decoding="async">`
                    : `<span class="gallery-public-card-placeholder" aria-hidden="true">🖼</span>`
                }

                <span class="gallery-public-card-title">${escapeHtml(photo.title)}</span>

            </button>
        `;
    }).join("");
}


/*==================================================
    LIGHTBOX
==================================================*/

function setupLightbox() {
    const lightbox = document.getElementById("galleryLightbox");
    if (!lightbox) return;

    document.getElementById("galleryLightboxClose").addEventListener("click", closeLightbox);
    document.getElementById("galleryLightboxPrev").addEventListener("click", () => stepLightbox(-1));
    document.getElementById("galleryLightboxNext").addEventListener("click", () => stepLightbox(1));

    lightbox.addEventListener("click", (event) => {
        if (event.target === lightbox) closeLightbox();
    });

    document.addEventListener("keydown", (event) => {
        if (lightboxIndex === -1) return;

        if (event.key === "Escape") {
            closeLightbox();
        } else if (event.key === "ArrowLeft") {
            stepLightbox(-1);
        } else if (event.key === "ArrowRight") {
            stepLightbox(1);
        } else if (event.key === "Tab") {
            trapLightboxFocus(event);
        }
    });

    // Mobile swipe navigation.
    let touchStartX = null;

    lightbox.addEventListener("touchstart", (event) => {
        touchStartX = event.changedTouches[0].clientX;
    }, { passive: true });

    lightbox.addEventListener("touchend", (event) => {
        if (touchStartX === null) return;

        const deltaX = event.changedTouches[0].clientX - touchStartX;
        const SWIPE_THRESHOLD = 40;

        if (deltaX > SWIPE_THRESHOLD) {
            stepLightbox(-1);
        } else if (deltaX < -SWIPE_THRESHOLD) {
            stepLightbox(1);
        }

        touchStartX = null;
    }, { passive: true });
}

function openLightbox(index) {
    if (!visiblePhotos[index]) return;

    lightboxLastFocused = document.activeElement;
    lightboxIndex = index;

    renderLightboxPhoto();

    const lightbox = document.getElementById("galleryLightbox");
    lightbox.classList.add("open");
    lightbox.setAttribute("aria-hidden", "false");
    document.body.classList.add("gallery-lightbox-open");

    document.getElementById("galleryLightboxClose").focus();
}

function closeLightbox() {
    const lightbox = document.getElementById("galleryLightbox");
    if (!lightbox) return;

    lightbox.classList.remove("open");
    lightbox.setAttribute("aria-hidden", "true");
    document.body.classList.remove("gallery-lightbox-open");

    lightboxIndex = -1;

    if (lightboxLastFocused && typeof lightboxLastFocused.focus === "function") {
        lightboxLastFocused.focus();
    }
}

function stepLightbox(direction) {
    if (lightboxIndex === -1 || !visiblePhotos.length) return;

    lightboxIndex = (lightboxIndex + direction + visiblePhotos.length) % visiblePhotos.length;
    renderLightboxPhoto();
}

function renderLightboxPhoto() {
    const photo = visiblePhotos[lightboxIndex];
    if (!photo) return;

    const url = publicSignedUrlByPath.get(photo.storage_path);
    const img = document.getElementById("galleryLightboxImage");

    img.src = url || "";
    img.alt = photo.alt_text || photo.title || "";

    const captionParts = [photo.title, photo.caption].filter(Boolean);
    document.getElementById("galleryLightboxCaption").textContent = captionParts.join(" — ");

    const multiplePhotos = visiblePhotos.length > 1;
    document.getElementById("galleryLightboxPrev").style.display = multiplePhotos ? "flex" : "none";
    document.getElementById("galleryLightboxNext").style.display = multiplePhotos ? "flex" : "none";
}

function trapLightboxFocus(event) {
    const lightbox = document.getElementById("galleryLightbox");
    const focusable = [...lightbox.querySelectorAll("button")].filter(el => el.offsetParent !== null);

    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}


/*==================================================
    HELPERS
==================================================*/

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

window.setPublicAlbumFilter = setPublicAlbumFilter;
window.openLightbox = openLightbox;

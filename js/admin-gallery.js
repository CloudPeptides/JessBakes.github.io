/*==================================================
    ADMIN GALLERY
==================================================*/

const GALLERY_BUCKET = "gallery";
const SIGNED_URL_TTL_SECONDS = 3600;

let albums = [];
let photos = [];
let signedUrlByPath = new Map();
let currentRenderedPhotos = []; // the currently filtered+sorted list, kept for move-up/down math

const galleryFilters = {
    search: "",
    status: "all",
    featured: false,
    albumId: null
};
let gallerySortKey = "newest";

const gallerySelected = new Set();


/*==================================================
    PAGE INITIALIZATION
==================================================*/

document.addEventListener("DOMContentLoaded", async () => {
    await requireAuth();

    setupLogout();
    setupGalleryDropzone();

    await loadGalleryData();
});

document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;

    closeUploadModal();
    closePhotoEditModal();
    closeAlbumManagerModal();
    closeAlbumDeleteModal();
});


/*==================================================
    DATA LOADING
==================================================*/

async function loadGalleryData() {
    const [albumsResult, photosResult] = await Promise.all([
        supabaseClient
            .from("gallery_albums")
            .select("*")
            .order("sort_order", { ascending: true })
            .order("name", { ascending: true }),

        supabaseClient
            .from("gallery_photos")
            .select("*")
    ]);

    if (albumsResult.error) {
        console.error(albumsResult.error);
        albums = [];
    } else {
        albums = albumsResult.data || [];
    }

    if (photosResult.error) {
        console.error(photosResult.error);
        photos = [];
        renderGalleryError("Unable to load photos.");
        return;
    }

    photos = photosResult.data || [];

    await refreshSignedUrls();

    renderGalleryStats();
    renderAlbumChips();
    populateAllAlbumSelects();
    renderGalleryGrid();
}

async function refreshSignedUrls() {
    const paths = [...new Set(photos.map(p => p.storage_path).filter(Boolean))];

    if (!paths.length) {
        signedUrlByPath = new Map();
        return;
    }

    const { data, error } = await supabaseClient
        .storage
        .from(GALLERY_BUCKET)
        .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

    if (error) {
        console.error("Unable to sign gallery photo URLs:", error);
        signedUrlByPath = new Map();
        return;
    }

    signedUrlByPath = new Map(
        (data || [])
            .filter(entry => entry.signedUrl && !entry.error)
            .map(entry => [entry.path, entry.signedUrl])
    );
}

function renderGalleryError(message) {
    const grid = document.getElementById("galleryGrid");
    if (grid) grid.innerHTML = `<div class="gallery-empty"><h3>${escapeHtml(message)}</h3></div>`;
}


/*==================================================
    STATS
==================================================*/

function renderGalleryStats() {
    setText("statTotalPhotos", photos.length);
    setText("statPublished", photos.filter(p => p.published).length);
    setText("statDrafts", photos.filter(p => !p.published).length);
    setText("statFeatured", photos.filter(p => p.featured).length);
}


/*==================================================
    ALBUM CHIPS + FILTER BAR
==================================================*/

function renderAlbumChips() {
    const container = document.getElementById("galleryAlbumChips");
    if (!container) return;

    const countFor = (albumId) => photos.filter(p =>
        albumId === "none" ? (p.album_id === null || p.album_id === undefined) : p.album_id === albumId
    ).length;

    const chips = [
        `<button type="button" class="gallery-album-chip ${galleryFilters.albumId === null ? "active" : ""}" onclick="setGalleryAlbumFilter(null)">All Albums (${photos.length})</button>`,
        ...albums.map(album => `
            <button type="button" class="gallery-album-chip ${String(galleryFilters.albumId) === String(album.id) ? "active" : ""}" onclick="setGalleryAlbumFilter(${album.id})">
                ${escapeHtml(album.name)} (${countFor(album.id)})
            </button>
        `),
        `<button type="button" class="gallery-album-chip ${galleryFilters.albumId === "none" ? "active" : ""}" onclick="setGalleryAlbumFilter('none')">Uncategorized (${countFor("none")})</button>`,
        `<button type="button" class="gallery-album-chip gallery-album-chip-manage" onclick="openAlbumManagerModal()">⚙ Manage Albums</button>`
    ];

    container.innerHTML = chips.join("");
}

function setGalleryAlbumFilter(albumId) {
    galleryFilters.albumId = albumId;
    renderAlbumChips();
    renderGalleryGrid();
}

function setGalleryStatusFilter(status) {
    galleryFilters.status = status;

    document.querySelectorAll(".gallery-status-tab").forEach(tab => {
        tab.classList.toggle("active", tab.dataset.status === status);
    });

    renderGalleryGrid();
}

function onGalleryFiltersChanged() {
    galleryFilters.search = document.getElementById("gallerySearch")?.value || "";
    galleryFilters.featured = Boolean(document.getElementById("galleryFeaturedFilter")?.checked);
    gallerySortKey = document.getElementById("gallerySort")?.value || "newest";

    renderGalleryGrid();
}


/*==================================================
    GRID RENDERING
==================================================*/

function renderGalleryGrid() {
    const grid = document.getElementById("galleryGrid");
    if (!grid) return;

    const filtered = GalleryShared.filterPhotos(photos, {
        search: galleryFilters.search,
        status: galleryFilters.status,
        featured: galleryFilters.featured || undefined,
        albumId: galleryFilters.albumId
    });

    const sorted = GalleryShared.sortPhotos(filtered, gallerySortKey);
    currentRenderedPhotos = sorted;

    if (!sorted.length) {
        grid.innerHTML = `
            <div class="gallery-empty">
                <h3>No photos found</h3>
                <p>${photos.length ? "Try adjusting your search or filters." : "Upload your first bakery photo to get started."}</p>
            </div>
        `;
        renderBulkBar();
        return;
    }

    const canReorder = gallerySortKey === "display_order";

    grid.innerHTML = sorted.map((photo, index) => renderGalleryCard(photo, index, sorted.length, canReorder)).join("");

    renderBulkBar();
}

function renderGalleryCard(photo, index, total, canReorder) {
    const url = signedUrlByPath.get(photo.storage_path);
    const album = albums.find(a => a.id === photo.album_id);
    const checked = gallerySelected.has(photo.id) ? "checked" : "";

    return `
        <article class="gallery-card">

            <input
                type="checkbox"
                class="gallery-card-select"
                aria-label="Select ${escapeHtml(photo.title)}"
                ${checked}
                onchange="toggleGallerySelect('${photo.id}')">

            <div class="gallery-card-thumb">
                ${url
                    ? `<img src="${url}" alt="${escapeHtml(photo.alt_text || photo.title)}" loading="lazy">`
                    : `<div class="gallery-card-thumb-placeholder" aria-hidden="true">🖼</div>`
                }

                <div class="gallery-card-badges">
                    <span class="gallery-pill ${photo.published ? "gallery-pill-published" : "gallery-pill-draft"}">
                        ${photo.published ? "Published" : "Draft"}
                    </span>
                    ${photo.featured ? `<span class="featured-pill">★ Featured</span>` : ""}
                </div>
            </div>

            <div class="gallery-card-body">
                <h3 class="gallery-card-title">${escapeHtml(photo.title)}</h3>
                <p class="gallery-card-meta">
                    ${album ? escapeHtml(album.name) : "Uncategorized"}
                    ${photo.width && photo.height ? ` &middot; ${photo.width}&times;${photo.height}` : ""}
                    ${photo.file_size_bytes ? ` &middot; ${GalleryShared.formatBytes(photo.file_size_bytes)}` : ""}
                </p>

                <div class="gallery-card-actions">
                    <button type="button" class="edit-option-btn" onclick="openPhotoEditModal('${photo.id}')">Edit</button>

                    <button type="button" class="edit-option-btn" onclick="toggleGalleryFeatured('${photo.id}', ${Boolean(photo.featured)})">
                        ${photo.featured ? "Unfeature" : "Feature"}
                    </button>

                    <button type="button" class="edit-option-btn" onclick="toggleGalleryPublished('${photo.id}', ${Boolean(photo.published)})">
                        ${photo.published ? "Unpublish" : "Publish"}
                    </button>

                    ${canReorder ? `
                        <button type="button" class="gallery-move-btn" aria-label="Move ${escapeHtml(photo.title)} earlier" ${index === 0 ? "disabled" : ""} onclick="movePhoto('${photo.id}', -1)">↑</button>
                        <button type="button" class="gallery-move-btn" aria-label="Move ${escapeHtml(photo.title)} later" ${index === total - 1 ? "disabled" : ""} onclick="movePhoto('${photo.id}', 1)">↓</button>
                    ` : ""}

                    <button type="button" class="delete-btn" onclick="deletePhoto('${photo.id}', '${escapeJs(photo.title)}')">Delete</button>
                </div>
            </div>

        </article>
    `;
}


/*==================================================
    BULK SELECTION
==================================================*/

function toggleGallerySelect(id) {
    if (gallerySelected.has(id)) {
        gallerySelected.delete(id);
    } else {
        gallerySelected.add(id);
    }

    renderBulkBar();
}

function clearGallerySelection() {
    gallerySelected.clear();
    document.querySelectorAll(".gallery-card-select").forEach(cb => { cb.checked = false; });
    renderBulkBar();
}

function renderBulkBar() {
    const bar = document.getElementById("galleryBulkBar");
    if (!bar) return;

    if (!gallerySelected.size) {
        bar.style.display = "none";
        return;
    }

    bar.style.display = "flex";
    setText("galleryBulkCount", `${gallerySelected.size} selected`);
}

async function bulkSetPublished(value) {
    const ids = [...gallerySelected];
    if (!ids.length) return;

    let targetIds = ids;

    if (value) {
        const selectedPhotos = photos.filter(p => ids.includes(p.id));
        const invalid = selectedPhotos.filter(p => !GalleryShared.validateForPublish(p).valid);

        if (invalid.length) {
            const names = invalid.map(p => p.title || p.original_filename).join(", ");
            alert(`These photos need a title and alt text before they can be published, and were skipped: ${names}`);
            targetIds = selectedPhotos.filter(p => GalleryShared.validateForPublish(p).valid).map(p => p.id);
        }
    }

    if (!targetIds.length) return;

    const { error } = await supabaseClient
        .from("gallery_photos")
        .update({ published: value })
        .in("id", targetIds);

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    clearGallerySelection();
    await loadGalleryData();
}

async function bulkMoveToAlbum() {
    const ids = [...gallerySelected];
    if (!ids.length) return;

    const value = document.getElementById("galleryBulkAlbumSelect")?.value || "";
    const albumId = value === "" ? null : Number(value);

    const { error } = await supabaseClient
        .from("gallery_photos")
        .update({ album_id: albumId })
        .in("id", ids);

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    clearGallerySelection();
    await loadGalleryData();
}

async function bulkDeletePhotos() {
    const ids = [...gallerySelected];
    if (!ids.length) return;

    if (!confirm(`Delete ${ids.length} photo${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;

    const targets = photos.filter(p => ids.includes(p.id));

    const ok = await deletePhotosSafely(targets);
    if (!ok) return;

    clearGallerySelection();
    await loadGalleryData();
}


/*==================================================
    SINGLE PHOTO ACTIONS
==================================================*/

async function toggleGalleryFeatured(id, current) {
    const { error } = await supabaseClient
        .from("gallery_photos")
        .update({ featured: !current })
        .eq("id", id);

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    await loadGalleryData();
}

async function toggleGalleryPublished(id, current) {
    if (!current) {
        const photo = photos.find(p => p.id === id);
        const validation = GalleryShared.validateForPublish(photo);

        if (!validation.valid) {
            alert(validation.error);
            return;
        }
    }

    const { error } = await supabaseClient
        .from("gallery_photos")
        .update({ published: !current })
        .eq("id", id);

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    await loadGalleryData();
}

async function movePhoto(id, direction) {
    const updates = GalleryShared.computeMoveSwap(currentRenderedPhotos, id, direction);
    if (!updates) return;

    const [a, b] = updates;

    const [resultA, resultB] = await Promise.all([
        supabaseClient.from("gallery_photos").update({ display_order: a.display_order }).eq("id", a.id),
        supabaseClient.from("gallery_photos").update({ display_order: b.display_order }).eq("id", b.id)
    ]);

    if (resultA.error || resultB.error) {
        console.error(resultA.error || resultB.error);
        alert((resultA.error || resultB.error).message);
        return;
    }

    await loadGalleryData();
}

async function deletePhoto(id, title) {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;

    const photo = photos.find(p => p.id === id);
    if (!photo) return;

    const ok = await deletePhotosSafely([photo]);
    if (!ok) return;

    await loadGalleryData();
}

/** Deletes the Storage objects for the given photos first, then their DB
 * rows -- only if the Storage removal succeeds -- so a photo record never
 * outlives its file, and a failed Storage removal never leaves the DB row
 * silently pointing at a file we just tried (and failed) to delete. */
async function deletePhotosSafely(photoList) {
    const paths = photoList.map(p => p.storage_path).filter(Boolean);

    if (paths.length) {
        const { error: storageError } = await supabaseClient
            .storage
            .from(GALLERY_BUCKET)
            .remove(paths);

        if (storageError) {
            console.error(storageError);
            alert(`Couldn't delete the photo file(s): ${storageError.message}`);
            return false;
        }
    }

    const ids = photoList.map(p => p.id);

    const { error: dbError } = await supabaseClient
        .from("gallery_photos")
        .delete()
        .in("id", ids);

    if (dbError) {
        console.error(dbError);
        alert(dbError.message);
        return false;
    }

    return true;
}


/*==================================================
    EDIT MODAL
==================================================*/

function openPhotoEditModal(id) {
    const photo = photos.find(p => p.id === id);
    if (!photo) return;

    document.getElementById("editPhotoId").value = photo.id;
    document.getElementById("editPhotoTitle").value = photo.title || "";
    document.getElementById("editPhotoAltText").value = photo.alt_text || "";
    document.getElementById("editPhotoCaption").value = photo.caption || "";
    document.getElementById("editPhotoPublished").checked = Boolean(photo.published);
    document.getElementById("editPhotoFeatured").checked = Boolean(photo.featured);

    const preview = document.getElementById("editPhotoPreview");
    const url = signedUrlByPath.get(photo.storage_path);
    preview.src = url || "";
    preview.alt = photo.alt_text || photo.title || "";
    preview.style.display = url ? "block" : "none";

    populateAlbumSelect(document.getElementById("editPhotoAlbum"), { includeUncategorized: true });
    document.getElementById("editPhotoAlbum").value = photo.album_id ?? "";

    const meta = [
        photo.original_filename,
        photo.width && photo.height ? `${photo.width}×${photo.height}` : null,
        photo.file_size_bytes ? GalleryShared.formatBytes(photo.file_size_bytes) : null,
        photo.file_type
    ].filter(Boolean).join(" · ");

    document.getElementById("editPhotoMeta").textContent = meta;

    document.getElementById("photoEditModal").style.display = "flex";
    document.getElementById("editPhotoTitle").focus();
}

function closePhotoEditModal() {
    const modal = document.getElementById("photoEditModal");
    if (modal) modal.style.display = "none";
}

async function savePhotoEdit() {
    const id = document.getElementById("editPhotoId").value;

    const payload = {
        title: document.getElementById("editPhotoTitle").value.trim(),
        alt_text: document.getElementById("editPhotoAltText").value.trim() || null,
        caption: document.getElementById("editPhotoCaption").value.trim() || null,
        album_id: valueOrNull(document.getElementById("editPhotoAlbum").value),
        published: document.getElementById("editPhotoPublished").checked,
        featured: document.getElementById("editPhotoFeatured").checked
    };

    if (!payload.title) {
        alert("Please enter a title.");
        return;
    }

    if (payload.published) {
        const validation = GalleryShared.validateForPublish(payload);
        if (!validation.valid) {
            alert(validation.error);
            return;
        }
    }

    const { error } = await supabaseClient
        .from("gallery_photos")
        .update(payload)
        .eq("id", id);

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    closePhotoEditModal();
    await loadGalleryData();
}

async function deletePhotoFromEditModal() {
    const id = document.getElementById("editPhotoId").value;
    const photo = photos.find(p => p.id === id);
    if (!photo) return;

    if (!confirm(`Delete "${photo.title}"? This cannot be undone.`)) return;

    const ok = await deletePhotosSafely([photo]);
    if (!ok) return;

    closePhotoEditModal();
    await loadGalleryData();
}


/*==================================================
    UPLOAD MODAL + PIPELINE
==================================================*/

function openUploadModal() {
    populateAlbumSelect(document.getElementById("uploadAlbumSelect"), { includeUncategorized: true });
    document.getElementById("galleryUploadList").innerHTML = "";
    document.getElementById("uploadModal").style.display = "flex";
}

function closeUploadModal() {
    const modal = document.getElementById("uploadModal");
    if (modal) modal.style.display = "none";
}

function setupGalleryDropzone() {
    const dropzone = document.getElementById("galleryDropzone");
    const input = document.getElementById("galleryFileInput");
    if (!dropzone || !input) return;

    input.addEventListener("change", () => {
        handleGalleryFiles(input.files);
        input.value = "";
    });

    ["dragenter", "dragover"].forEach(eventName => {
        dropzone.addEventListener(eventName, (event) => {
            event.preventDefault();
            dropzone.classList.add("drag-active");
        });
    });

    ["dragleave", "drop"].forEach(eventName => {
        dropzone.addEventListener(eventName, (event) => {
            event.preventDefault();
            dropzone.classList.remove("drag-active");
        });
    });

    dropzone.addEventListener("drop", (event) => {
        const files = event.dataTransfer?.files;
        if (files?.length) handleGalleryFiles(files);
    });
}

async function handleGalleryFiles(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;

    const albumValue = document.getElementById("uploadAlbumSelect")?.value || "";
    const albumId = albumValue === "" ? null : Number(albumValue);

    const list = document.getElementById("galleryUploadList");

    let nextOrder = photos.reduce((max, p) => Math.max(max, Number(p.display_order || 0)), 0) + 1;

    for (const file of files) {
        const itemId = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const row = createUploadRow(itemId, file);
        list.appendChild(row);

        await processGalleryUpload(file, albumId, nextOrder, itemId);
        nextOrder += 1;
    }

    await loadGalleryData();
    populateAlbumSelect(document.getElementById("uploadAlbumSelect"), { includeUncategorized: true });
    document.getElementById("uploadAlbumSelect").value = albumValue;
}

function createUploadRow(itemId, file) {
    const row = document.createElement("div");
    row.className = "gallery-upload-item";
    row.id = itemId;

    row.innerHTML = `
        <div class="gallery-upload-thumb" aria-hidden="true"></div>
        <div class="gallery-upload-info">
            <div class="gallery-upload-name">${escapeHtml(file.name)}</div>
            <div class="gallery-upload-status" data-role="status">Validating...</div>
            <div class="gallery-upload-steps" data-role="steps">
                <span data-step="validate"></span>
                <span data-step="optimize"></span>
                <span data-step="upload"></span>
                <span data-step="save"></span>
            </div>
        </div>
        <div></div>
    `;

    return row;
}

function setUploadStep(itemId, step, state, statusText) {
    const row = document.getElementById(itemId);
    if (!row) return;

    const stepEl = row.querySelector(`[data-step="${step}"]`);
    if (stepEl) {
        stepEl.classList.remove("done", "active", "failed");
        stepEl.classList.add(state);
    }

    if (statusText) {
        const statusEl = row.querySelector('[data-role="status"]');
        if (statusEl) {
            statusEl.textContent = statusText;
            statusEl.classList.toggle("error", state === "failed");
            statusEl.classList.toggle("success", step === "save" && state === "done");
        }
    }
}

async function processGalleryUpload(file, albumId, displayOrder, itemId) {
    setUploadStep(itemId, "validate", "active");

    const basicCheck = GalleryShared.validateFileBasics(file);
    if (!basicCheck.valid) {
        setUploadStep(itemId, "validate", "failed", basicCheck.error);
        return;
    }

    setUploadStep(itemId, "validate", "done");
    setUploadStep(itemId, "optimize", "active", "Optimizing...");

    let optimized;
    try {
        optimized = await optimizeImageForUpload(file);
    } catch (err) {
        console.error(err);
        setUploadStep(itemId, "optimize", "failed", "Couldn't read this image file.");
        return;
    }

    if (optimized.blob.size > GalleryShared.MAX_OUTPUT_BYTES) {
        setUploadStep(itemId, "optimize", "failed", `Still too large after optimizing (${GalleryShared.formatBytes(optimized.blob.size)}). Try a smaller image.`);
        return;
    }

    setUploadStep(itemId, "optimize", "done");

    const thumb = document.querySelector(`#${itemId} .gallery-upload-thumb`);
    if (thumb) {
        const objectUrl = URL.createObjectURL(optimized.blob);
        thumb.style.backgroundImage = `url(${objectUrl})`;
        thumb.style.backgroundSize = "cover";
        thumb.style.backgroundPosition = "center";
    }

    setUploadStep(itemId, "upload", "active", "Uploading...");

    const id = crypto.randomUUID();
    const storagePath = GalleryShared.buildStoragePath(id, optimized.type);

    const { error: uploadError } = await supabaseClient
        .storage
        .from(GALLERY_BUCKET)
        .upload(storagePath, optimized.blob, {
            contentType: optimized.type,
            upsert: false
        });

    if (uploadError) {
        console.error(uploadError);
        setUploadStep(itemId, "upload", "failed", uploadError.message);
        return;
    }

    setUploadStep(itemId, "upload", "done");
    setUploadStep(itemId, "save", "active", "Saving...");

    const { error: insertError } = await supabaseClient
        .from("gallery_photos")
        .insert({
            id,
            title: titleFromFilename(file.name),
            alt_text: null,
            caption: null,
            album_id: albumId,
            published: false,
            featured: false,
            display_order: displayOrder,
            original_filename: file.name,
            storage_path: storagePath,
            width: optimized.width,
            height: optimized.height,
            file_type: optimized.type,
            file_size_bytes: optimized.blob.size
        });

    if (insertError) {
        console.error(insertError);

        // Storage upload succeeded but the DB row failed -- clean up the
        // now-orphaned Storage object rather than leaving a file with no
        // record of it.
        await supabaseClient.storage.from(GALLERY_BUCKET).remove([storagePath]);

        setUploadStep(itemId, "save", "failed", insertError.message);
        return;
    }

    setUploadStep(itemId, "save", "done", "Uploaded as a draft.");
}

function titleFromFilename(filename) {
    const withoutExt = String(filename || "").replace(/\.[^.]+$/, "");
    const spaced = withoutExt.replace(/[-_]+/g, " ").trim();
    if (!spaced) return "Untitled photo";
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Decodes the file, resizes/re-encodes it only if GalleryShared says it
 * needs it, and returns {blob, width, height, type}. Browser-only (canvas +
 * createImageBitmap); the pure size/dimension math lives in
 * js/gallery-shared.js and is unit-tested there. */
async function optimizeImageForUpload(file) {
    const bitmap = await createImageBitmap(file);
    const width = bitmap.width;
    const height = bitmap.height;

    if (!GalleryShared.needsOptimization(width, height, file.size)) {
        bitmap.close?.();
        return { blob: file, width, height, type: file.type };
    }

    const target = GalleryShared.computeTargetDimensions(width, height, GalleryShared.MAX_EDGE_PX);

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    bitmap.close?.();

    const outputType = file.type === "image/png" ? "image/png" : file.type;
    const quality = outputType === "image/png" ? undefined : GalleryShared.OUTPUT_QUALITY;

    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
            (result) => result ? resolve(result) : reject(new Error("Canvas encoding failed")),
            outputType,
            quality
        );
    });

    return { blob, width: target.width, height: target.height, type: outputType };
}


/*==================================================
    ALBUMS
==================================================*/

function populateAllAlbumSelects() {
    populateAlbumSelect(document.getElementById("uploadAlbumSelect"), { includeUncategorized: true });
    populateAlbumSelect(document.getElementById("galleryBulkAlbumSelect"), { includeUncategorized: true });
}

function populateAlbumSelect(select, { includeUncategorized = false, excludeId = null } = {}) {
    if (!select) return;

    const options = albums
        .filter(album => excludeId === null || album.id !== excludeId)
        .map(album => `<option value="${album.id}">${escapeHtml(album.name)}</option>`)
        .join("");

    select.innerHTML = (includeUncategorized ? `<option value="">Uncategorized</option>` : "") + options;
}

function openAlbumManagerModal() {
    renderAlbumManagerList();
    document.getElementById("albumManagerModal").style.display = "flex";
}

function closeAlbumManagerModal() {
    const modal = document.getElementById("albumManagerModal");
    if (modal) modal.style.display = "none";
}

function renderAlbumManagerList() {
    const container = document.getElementById("albumManagerList");
    if (!container) return;

    if (!albums.length) {
        container.innerHTML = "<p>No albums yet. Add one above.</p>";
        return;
    }

    container.innerHTML = albums.map(album => {
        const count = photos.filter(p => p.album_id === album.id).length;

        return `
            <div class="gallery-album-row">
                <input
                    type="text"
                    value="${escapeHtml(album.name)}"
                    aria-label="Rename ${escapeHtml(album.name)}"
                    onchange="renameAlbum(${album.id}, this.value)">

                <span class="gallery-field-help">${count} photo${count === 1 ? "" : "s"}</span>

                <button type="button" class="delete-btn" onclick="requestDeleteAlbum(${album.id})">Delete</button>
            </div>
        `;
    }).join("");
}

async function createAlbum() {
    const input = document.getElementById("newAlbumName");
    const name = input.value.trim();

    if (!name) {
        alert("Please enter an album name.");
        return;
    }

    const { error } = await supabaseClient
        .from("gallery_albums")
        .insert({ name });

    if (error) {
        console.error(error);
        alert(error.code === "23505" ? `An album named "${name}" already exists.` : error.message);
        return;
    }

    input.value = "";
    await loadGalleryData();
    renderAlbumManagerList();
}

async function renameAlbum(id, newName) {
    const name = newName.trim();

    if (!name) {
        alert("Album name can't be empty.");
        renderAlbumManagerList();
        return;
    }

    const { error } = await supabaseClient
        .from("gallery_albums")
        .update({ name })
        .eq("id", id);

    if (error) {
        console.error(error);
        alert(error.code === "23505" ? `An album named "${name}" already exists.` : error.message);
        renderAlbumManagerList();
        return;
    }

    await loadGalleryData();
    renderAlbumManagerList();
}

function requestDeleteAlbum(id) {
    const album = albums.find(a => a.id === id);
    if (!album) return;

    const count = photos.filter(p => p.album_id === id).length;

    if (GalleryShared.canDeleteAlbum(count)) {
        if (!confirm(`Delete the empty album "${album.name}"?`)) return;
        deleteAlbumNow(id);
        return;
    }

    document.getElementById("albumDeleteId").value = id;
    document.getElementById("albumDeleteMessage").textContent =
        `"${album.name}" has ${count} photo${count === 1 ? "" : "s"}. Move ${count === 1 ? "it" : "them"} to another album, or delete ${count === 1 ? "it" : "them"} along with this album.`;

    populateAlbumSelect(document.getElementById("albumDeleteMoveTarget"), { includeUncategorized: true, excludeId: id });

    closeAlbumManagerModal();
    document.getElementById("albumDeleteModal").style.display = "flex";
}

function closeAlbumDeleteModal() {
    const modal = document.getElementById("albumDeleteModal");
    if (modal) modal.style.display = "none";
}

async function confirmAlbumDeleteMovePhotos() {
    const id = Number(document.getElementById("albumDeleteId").value);
    const targetValue = document.getElementById("albumDeleteMoveTarget").value;
    const targetAlbumId = targetValue === "" ? null : Number(targetValue);

    const { error: moveError } = await supabaseClient
        .from("gallery_photos")
        .update({ album_id: targetAlbumId })
        .eq("album_id", id);

    if (moveError) {
        console.error(moveError);
        alert(moveError.message);
        return;
    }

    await deleteAlbumNow(id, true);
}

async function confirmAlbumDeletePhotosToo() {
    const id = Number(document.getElementById("albumDeleteId").value);

    if (!confirm("This will permanently delete every photo in this album. Continue?")) return;

    const targets = photos.filter(p => p.album_id === id);
    const ok = await deletePhotosSafely(targets);
    if (!ok) return;

    await deleteAlbumNow(id, true);
}

async function deleteAlbumNow(id, alreadyReloading = false) {
    const { error } = await supabaseClient
        .from("gallery_albums")
        .delete()
        .eq("id", id);

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    closeAlbumDeleteModal();
    await loadGalleryData();

    if (!alreadyReloading) {
        renderAlbumManagerList();
    }
}


/*==================================================
    HELPERS
==================================================*/

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function valueOrNull(value) {
    return value === "" || value === null || value === undefined ? null : Number(value);
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function escapeJs(value) {
    return String(value || "")
        .replaceAll("\\", "\\\\")
        .replaceAll("'", "\\'")
        .replaceAll('"', "&quot;")
        .replaceAll("\n", " ");
}


/*==================================================
    GLOBAL EXPORTS
==================================================*/

window.openUploadModal = openUploadModal;
window.closeUploadModal = closeUploadModal;

window.openPhotoEditModal = openPhotoEditModal;
window.closePhotoEditModal = closePhotoEditModal;
window.savePhotoEdit = savePhotoEdit;
window.deletePhotoFromEditModal = deletePhotoFromEditModal;

window.toggleGallerySelect = toggleGallerySelect;
window.clearGallerySelection = clearGallerySelection;
window.bulkSetPublished = bulkSetPublished;
window.bulkMoveToAlbum = bulkMoveToAlbum;
window.bulkDeletePhotos = bulkDeletePhotos;

window.toggleGalleryFeatured = toggleGalleryFeatured;
window.toggleGalleryPublished = toggleGalleryPublished;
window.movePhoto = movePhoto;
window.deletePhoto = deletePhoto;

window.setGalleryAlbumFilter = setGalleryAlbumFilter;
window.setGalleryStatusFilter = setGalleryStatusFilter;
window.onGalleryFiltersChanged = onGalleryFiltersChanged;

window.openAlbumManagerModal = openAlbumManagerModal;
window.closeAlbumManagerModal = closeAlbumManagerModal;
window.createAlbum = createAlbum;
window.renameAlbum = renameAlbum;
window.requestDeleteAlbum = requestDeleteAlbum;
window.closeAlbumDeleteModal = closeAlbumDeleteModal;
window.confirmAlbumDeleteMovePhotos = confirmAlbumDeleteMovePhotos;
window.confirmAlbumDeletePhotosToo = confirmAlbumDeletePhotosToo;

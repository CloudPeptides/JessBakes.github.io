/* ==========================================
   GALLERY SHARED LOGIC (shared, pure)
   ==========================================

   Validation, sorting/filtering, storage-path, and reorder-math for the
   admin Gallery feature (js/admin-gallery.js), pulled out into a pure,
   dependency-free module so it can run under Node (tests/gallery-shared.
   test.js) as well as unmodified in the browser (exposing
   `window.GallerySh ared`), matching the pattern already established by
   js/recipe-costing.js and js/sale-calculations.js.

   Nothing here touches the DOM, Supabase, canvas, or File/Blob APIs --
   those live in js/admin-gallery.js, which is browser-only and covered by
   the Playwright pass instead of Node unit tests.
   ========================================== */

(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.GalleryShared = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    // ---- Upload constraints ----
    // Mirrors the CHECK constraint on gallery_photos.file_type and the
    // storage bucket's allowed_mime_types, set by the migration in
    // supabase/migrations/20260817163139_gallery_photos_albums_storage.sql.
    const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

    // Raw file-picker/drop input ceiling, checked before any optimization
    // is attempted (rejects obviously-wrong files fast, e.g. a video
    // dragged in by mistake, or a 200MB raw camera file).
    const MAX_INPUT_BYTES = 25 * 1024 * 1024; // 25 MB

    // If a valid image is already at/under this size and within
    // MAX_EDGE_PX, it's uploaded as-is (no re-encode, no quality loss).
    // Otherwise it's resized/re-compressed down toward this ceiling.
    const MAX_OUTPUT_BYTES = 6 * 1024 * 1024; // 6 MB -- under the bucket's 10MB hard limit with headroom.

    const MAX_EDGE_PX = 2400; // longest edge, in pixels, after optimization.

    const OUTPUT_QUALITY = 0.85; // canvas toBlob quality for jpeg/webp re-encodes.

    const EXTENSION_BY_TYPE = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp"
    };

    function extensionForType(type) {
        return EXTENSION_BY_TYPE[type] || null;
    }

    /** Basic pre-optimization validation of a File-like object
     * ({name, type, size}). Returns {valid, error}. */
    function validateFileBasics(file) {
        if (!file) {
            return { valid: false, error: "No file selected." };
        }

        if (!ALLOWED_MIME_TYPES.includes(file.type)) {
            return {
                valid: false,
                error: `"${file.name || "file"}" isn't a JPG, PNG, or WebP image.`
            };
        }

        if (!file.size || file.size <= 0) {
            return { valid: false, error: `"${file.name || "file"}" is empty.` };
        }

        if (file.size > MAX_INPUT_BYTES) {
            return {
                valid: false,
                error: `"${file.name || "file"}" is ${formatBytes(file.size)}, which is over the ${formatBytes(MAX_INPUT_BYTES)} limit.`
            };
        }

        return { valid: true, error: null };
    }

    /** Whether an already-decoded image needs resizing/re-encoding before
     * upload. Pure -- takes plain numbers, not a File/Image. */
    function needsOptimization(width, height, sizeBytes) {
        return (
            Math.max(width || 0, height || 0) > MAX_EDGE_PX ||
            (sizeBytes || 0) > MAX_OUTPUT_BYTES
        );
    }

    /** Scales {width, height} down (never up) so the longest edge is at
     * most maxEdge, preserving aspect ratio. Returns integer pixel
     * dimensions and whether scaling actually happened. */
    function computeTargetDimensions(width, height, maxEdge = MAX_EDGE_PX) {
        width = Math.max(1, Math.round(width || 0));
        height = Math.max(1, Math.round(height || 0));

        const longest = Math.max(width, height);

        if (longest <= maxEdge) {
            return { width, height, scaled: false };
        }

        const ratio = maxEdge / longest;

        return {
            width: Math.max(1, Math.round(width * ratio)),
            height: Math.max(1, Math.round(height * ratio)),
            scaled: true
        };
    }

    function buildStoragePath(id, type) {
        const ext = extensionForType(type) || "jpg";
        return `${id}.${ext}`;
    }

    function formatBytes(bytes) {
        bytes = Number(bytes) || 0;

        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    // ---- Sorting ----

    const SORT_KEYS = ["newest", "oldest", "title", "display_order"];

    function sortPhotos(photos, sortKey) {
        const list = (photos || []).slice();

        switch (sortKey) {
            case "oldest":
                return list.sort((a, b) =>
                    new Date(a.created_at || 0) - new Date(b.created_at || 0)
                );

            case "title":
                return list.sort((a, b) =>
                    String(a.title || "").localeCompare(String(b.title || ""))
                );

            case "display_order":
                return list.sort((a, b) =>
                    Number(a.display_order || 0) - Number(b.display_order || 0)
                );

            case "newest":
            default:
                return list.sort((a, b) =>
                    new Date(b.created_at || 0) - new Date(a.created_at || 0)
                );
        }
    }

    // ---- Filtering ----

    /** filters: { search, albumId, status, featured }
     *  - albumId: undefined/null/"" = all albums, "none" = uncategorized
     *    (album_id is null/undefined), otherwise matched by String() equality.
     *  - status: "all" (default) | "published" | "draft"
     *  - featured: true = featured only, otherwise ignored. */
    function filterPhotos(photos, filters = {}) {
        const search = String(filters.search || "").trim().toLowerCase();
        const { albumId, status, featured } = filters;

        return (photos || []).filter(photo => {
            if (search) {
                const haystack = `${photo.title || ""} ${photo.caption || ""} ${photo.original_filename || ""}`.toLowerCase();
                if (!haystack.includes(search)) return false;
            }

            if (albumId !== undefined && albumId !== null && albumId !== "") {
                if (albumId === "none") {
                    if (photo.album_id !== null && photo.album_id !== undefined) return false;
                } else if (String(photo.album_id) !== String(albumId)) {
                    return false;
                }
            }

            if (status === "published" && !photo.published) return false;
            if (status === "draft" && photo.published) return false;

            if (featured === true && !photo.featured) return false;

            return true;
        });
    }

    // ---- Publish validation (mirrors the DB check constraint) ----

    function validateForPublish(photo) {
        if (!photo || !String(photo.title || "").trim()) {
            return { valid: false, error: "Give this photo a title before publishing it." };
        }

        if (!String(photo.alt_text || "").trim()) {
            return { valid: false, error: "Alt text is required before a photo can be published." };
        }

        return { valid: true, error: null };
    }

    // ---- Reordering ----

    /** Given a list already sorted by display_order (ascending) and the id
     * of the photo to move, returns the two {id, display_order} updates
     * needed to swap it with its neighbor -- or null if the move isn't
     * possible (id not found, or already at that edge of the list).
     * direction: -1 to move up/earlier, 1 to move down/later. Pure --
     * callers persist the returned updates themselves. */
    function computeMoveSwap(sortedList, photoId, direction) {
        const list = sortedList || [];
        const index = list.findIndex(p => String(p.id) === String(photoId));

        if (index === -1) return null;

        const targetIndex = index + direction;

        if (targetIndex < 0 || targetIndex >= list.length) return null;

        const current = list[index];
        const target = list[targetIndex];

        return [
            { id: current.id, display_order: Number(target.display_order || 0) },
            { id: target.id, display_order: Number(current.display_order || 0) }
        ];
    }

    // ---- Albums ----

    function canDeleteAlbum(photoCountInAlbum) {
        return Number(photoCountInAlbum || 0) === 0;
    }

    return {
        ALLOWED_MIME_TYPES,
        MAX_INPUT_BYTES,
        MAX_OUTPUT_BYTES,
        MAX_EDGE_PX,
        OUTPUT_QUALITY,
        SORT_KEYS,
        extensionForType,
        validateFileBasics,
        needsOptimization,
        computeTargetDimensions,
        buildStoragePath,
        formatBytes,
        sortPhotos,
        filterPhotos,
        validateForPublish,
        computeMoveSwap,
        canDeleteAlbum
    };
});

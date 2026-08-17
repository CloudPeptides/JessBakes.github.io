"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const GalleryShared = require("../js/gallery-shared.js");

/* ==========================================
   FILE VALIDATION
========================================== */

test("1. validateFileBasics accepts jpg/png/webp within the size ceiling", () => {
    for (const type of GalleryShared.ALLOWED_MIME_TYPES) {
        const result = GalleryShared.validateFileBasics({ name: "photo.jpg", type, size: 1024 * 1024 });
        assert.equal(result.valid, true, type);
        assert.equal(result.error, null);
    }
});

test("2. validateFileBasics rejects a disallowed file type", () => {
    const result = GalleryShared.validateFileBasics({ name: "clip.mp4", type: "video/mp4", size: 1024 });
    assert.equal(result.valid, false);
    assert.match(result.error, /JPG, PNG, or WebP/);
});

test("3. validateFileBasics rejects a file over the input size ceiling", () => {
    const result = GalleryShared.validateFileBasics({
        name: "huge.png",
        type: "image/png",
        size: GalleryShared.MAX_INPUT_BYTES + 1
    });
    assert.equal(result.valid, false);
    assert.match(result.error, /limit/);
});

test("4. validateFileBasics rejects a zero-byte file", () => {
    const result = GalleryShared.validateFileBasics({ name: "empty.jpg", type: "image/jpeg", size: 0 });
    assert.equal(result.valid, false);
});

test("5. validateFileBasics rejects a missing file gracefully", () => {
    const result = GalleryShared.validateFileBasics(null);
    assert.equal(result.valid, false);
});

/* ==========================================
   OPTIMIZATION MATH
========================================== */

test("6. needsOptimization is false for a small, already-compact image", () => {
    assert.equal(GalleryShared.needsOptimization(1200, 800, 500 * 1024), false);
});

test("7. needsOptimization is true when the longest edge exceeds MAX_EDGE_PX", () => {
    assert.equal(GalleryShared.needsOptimization(4000, 3000, 500 * 1024), true);
});

test("8. needsOptimization is true when file size exceeds MAX_OUTPUT_BYTES even if dimensions are fine", () => {
    assert.equal(GalleryShared.needsOptimization(1200, 800, GalleryShared.MAX_OUTPUT_BYTES + 1), true);
});

test("9. computeTargetDimensions leaves a small image untouched", () => {
    const result = GalleryShared.computeTargetDimensions(1200, 800);
    assert.deepEqual(result, { width: 1200, height: 800, scaled: false });
});

test("10. computeTargetDimensions scales down a landscape image preserving aspect ratio", () => {
    const result = GalleryShared.computeTargetDimensions(4800, 3200, 2400);
    assert.equal(result.scaled, true);
    assert.equal(result.width, 2400);
    assert.equal(result.height, 1600); // 4800:3200 == 3:2, so 2400 * 2/3
});

test("11. computeTargetDimensions scales down a portrait image using height as the longest edge", () => {
    const result = GalleryShared.computeTargetDimensions(3000, 6000, 2400);
    assert.equal(result.width, 1200);
    assert.equal(result.height, 2400);
});

test("12. computeTargetDimensions never scales up", () => {
    const result = GalleryShared.computeTargetDimensions(100, 50, 2400);
    assert.equal(result.scaled, false);
    assert.equal(result.width, 100);
    assert.equal(result.height, 50);
});

/* ==========================================
   STORAGE PATHS
========================================== */

test("13. buildStoragePath maps mime types to the right extension", () => {
    assert.equal(GalleryShared.buildStoragePath("abc", "image/jpeg"), "abc.jpg");
    assert.equal(GalleryShared.buildStoragePath("abc", "image/png"), "abc.png");
    assert.equal(GalleryShared.buildStoragePath("abc", "image/webp"), "abc.webp");
});

test("14. buildStoragePath falls back to .jpg for an unrecognized type rather than throwing", () => {
    assert.equal(GalleryShared.buildStoragePath("abc", "image/gif"), "abc.jpg");
});

/* ==========================================
   FORMATTING
========================================== */

test("15. formatBytes renders human-readable sizes at each scale", () => {
    assert.equal(GalleryShared.formatBytes(500), "500 B");
    assert.equal(GalleryShared.formatBytes(2048), "2.0 KB");
    assert.equal(GalleryShared.formatBytes(3 * 1024 * 1024), "3.0 MB");
});

/* ==========================================
   SORTING
========================================== */

const PHOTOS = [
    { id: "a", title: "Sourdough Boule", created_at: "2026-06-01T00:00:00Z", display_order: 3, published: true, featured: false, album_id: 1 },
    { id: "b", title: "Cinnamon Rolls", created_at: "2026-08-01T00:00:00Z", display_order: 1, published: false, featured: true, album_id: 2 },
    { id: "c", title: "Brownie Batch", created_at: "2026-07-01T00:00:00Z", display_order: 2, published: true, featured: true, album_id: null }
];

test("16. sortPhotos 'newest' orders by created_at descending", () => {
    const sorted = GalleryShared.sortPhotos(PHOTOS, "newest").map(p => p.id);
    assert.deepEqual(sorted, ["b", "c", "a"]);
});

test("17. sortPhotos 'oldest' orders by created_at ascending", () => {
    const sorted = GalleryShared.sortPhotos(PHOTOS, "oldest").map(p => p.id);
    assert.deepEqual(sorted, ["a", "c", "b"]);
});

test("18. sortPhotos 'title' orders alphabetically", () => {
    const sorted = GalleryShared.sortPhotos(PHOTOS, "title").map(p => p.id);
    assert.deepEqual(sorted, ["c", "b", "a"]); // Brownie, Cinnamon, Sourdough
});

test("19. sortPhotos 'display_order' orders by the numeric field ascending", () => {
    const sorted = GalleryShared.sortPhotos(PHOTOS, "display_order").map(p => p.id);
    assert.deepEqual(sorted, ["b", "c", "a"]);
});

test("20. sortPhotos does not mutate the input array", () => {
    const copy = PHOTOS.slice();
    GalleryShared.sortPhotos(PHOTOS, "title");
    assert.deepEqual(PHOTOS, copy);
});

/* ==========================================
   FILTERING
========================================== */

test("21. filterPhotos with no filters returns everything", () => {
    assert.equal(GalleryShared.filterPhotos(PHOTOS, {}).length, 3);
});

test("22. filterPhotos matches search against title case-insensitively", () => {
    const result = GalleryShared.filterPhotos(PHOTOS, { search: "brownie" });
    assert.deepEqual(result.map(p => p.id), ["c"]);
});

test("23. filterPhotos status 'published' excludes drafts", () => {
    const result = GalleryShared.filterPhotos(PHOTOS, { status: "published" });
    assert.deepEqual(result.map(p => p.id).sort(), ["a", "c"]);
});

test("24. filterPhotos status 'draft' returns only unpublished photos", () => {
    const result = GalleryShared.filterPhotos(PHOTOS, { status: "draft" });
    assert.deepEqual(result.map(p => p.id), ["b"]);
});

test("25. filterPhotos featured:true returns only featured photos", () => {
    const result = GalleryShared.filterPhotos(PHOTOS, { featured: true });
    assert.deepEqual(result.map(p => p.id).sort(), ["b", "c"]);
});

test("26. filterPhotos albumId matches a specific album", () => {
    const result = GalleryShared.filterPhotos(PHOTOS, { albumId: 1 });
    assert.deepEqual(result.map(p => p.id), ["a"]);
});

test("27. filterPhotos albumId 'none' matches uncategorized photos (null album_id)", () => {
    const result = GalleryShared.filterPhotos(PHOTOS, { albumId: "none" });
    assert.deepEqual(result.map(p => p.id), ["c"]);
});

test("28. filterPhotos combines search + status + featured (all must match)", () => {
    const result = GalleryShared.filterPhotos(PHOTOS, { search: "roll", status: "draft", featured: true });
    assert.deepEqual(result.map(p => p.id), ["b"]);
});

/* ==========================================
   PUBLISH VALIDATION (mirrors the DB check constraint)
========================================== */

test("29. validateForPublish requires a title", () => {
    const result = GalleryShared.validateForPublish({ title: "", alt_text: "A loaf of bread" });
    assert.equal(result.valid, false);
    assert.match(result.error, /title/);
});

test("30. validateForPublish requires alt text", () => {
    const result = GalleryShared.validateForPublish({ title: "Boule", alt_text: "" });
    assert.equal(result.valid, false);
    assert.match(result.error, /Alt text/);
});

test("31. validateForPublish passes with both title and alt text present", () => {
    const result = GalleryShared.validateForPublish({ title: "Boule", alt_text: "A rustic sourdough boule" });
    assert.equal(result.valid, true);
});

test("32. validateForPublish treats whitespace-only text as missing", () => {
    const result = GalleryShared.validateForPublish({ title: "   ", alt_text: "  " });
    assert.equal(result.valid, false);
});

/* ==========================================
   REORDER MATH
========================================== */

const ORDERED = [
    { id: "x", display_order: 1 },
    { id: "y", display_order: 2 },
    { id: "z", display_order: 3 }
];

test("33. computeMoveSwap moving the middle item up swaps it with its predecessor", () => {
    const updates = GalleryShared.computeMoveSwap(ORDERED, "y", -1);
    assert.deepEqual(updates, [
        { id: "y", display_order: 1 },
        { id: "x", display_order: 2 }
    ]);
});

test("34. computeMoveSwap moving the middle item down swaps it with its successor", () => {
    const updates = GalleryShared.computeMoveSwap(ORDERED, "y", 1);
    assert.deepEqual(updates, [
        { id: "y", display_order: 3 },
        { id: "z", display_order: 2 }
    ]);
});

test("35. computeMoveSwap returns null when the item is already first and moved up", () => {
    assert.equal(GalleryShared.computeMoveSwap(ORDERED, "x", -1), null);
});

test("36. computeMoveSwap returns null when the item is already last and moved down", () => {
    assert.equal(GalleryShared.computeMoveSwap(ORDERED, "z", 1), null);
});

test("37. computeMoveSwap returns null for an id that isn't in the list", () => {
    assert.equal(GalleryShared.computeMoveSwap(ORDERED, "nope", 1), null);
});

/* ==========================================
   PUBLIC GALLERY SORT + FILTER CHIPS
========================================== */

test("39. sortForPublicGallery puts every featured photo before every non-featured photo", () => {
    const sorted = GalleryShared.sortForPublicGallery(PHOTOS);
    assert.deepEqual(sorted.map(p => p.id), ["b", "c", "a"]); // b,c featured; a not
});

test("40. sortForPublicGallery orders within each featured group by display_order ascending", () => {
    const featuredGroup = [
        { id: "f1", featured: true, display_order: 5 },
        { id: "f2", featured: true, display_order: 2 },
        { id: "f3", featured: false, display_order: 1 }
    ];
    const sorted = GalleryShared.sortForPublicGallery(featuredGroup);
    assert.deepEqual(sorted.map(p => p.id), ["f2", "f1", "f3"]);
});

test("41. sortForPublicGallery does not mutate the input array", () => {
    const copy = PHOTOS.slice();
    GalleryShared.sortForPublicGallery(PHOTOS);
    assert.deepEqual(PHOTOS, copy);
});

test("42. buildPublicAlbumFilters always leads with an 'All' chip counting every visible photo", () => {
    const chips = GalleryShared.buildPublicAlbumFilters(PHOTOS, []);
    assert.equal(chips[0].id, null);
    assert.equal(chips[0].label, "All");
    assert.equal(chips[0].count, 3);
});

test("43. buildPublicAlbumFilters includes an album chip only when it has at least one visible photo", () => {
    const albums = [{ id: 1, name: "Breads" }, { id: 99, name: "Empty Album" }];
    const chips = GalleryShared.buildPublicAlbumFilters(PHOTOS, albums);
    const labels = chips.map(c => c.label);
    assert.ok(labels.includes("Breads"));
    assert.ok(!labels.includes("Empty Album"));
});

test("44. buildPublicAlbumFilters includes 'Uncategorized' only when a visible photo has no album", () => {
    const chips = GalleryShared.buildPublicAlbumFilters(PHOTOS, [{ id: 1, name: "Breads" }, { id: 2, name: "Rolls" }]);
    const uncategorized = chips.find(c => c.id === "none");
    assert.ok(uncategorized);
    assert.equal(uncategorized.count, 1); // only "c" has album_id: null
});

test("45. buildPublicAlbumFilters omits 'Uncategorized' when every visible photo has an album", () => {
    const withAlbums = PHOTOS.map(p => ({ ...p, album_id: 1 }));
    const chips = GalleryShared.buildPublicAlbumFilters(withAlbums, [{ id: 1, name: "Breads" }]);
    assert.ok(!chips.some(c => c.id === "none"));
});

/* ==========================================
   ALBUM DELETE SAFETY
========================================== */

test("38. canDeleteAlbum is true only when the album has zero photos", () => {
    assert.equal(GalleryShared.canDeleteAlbum(0), true);
    assert.equal(GalleryShared.canDeleteAlbum(1), false);
    assert.equal(GalleryShared.canDeleteAlbum(5), false);
});

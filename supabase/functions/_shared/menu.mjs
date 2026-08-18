/* ==========================================
   WEEKLY MENU CONTENT BUILDER

   Pure transform from raw `menu_items` rows (as returned by a
   Supabase query) into the flat {name, description, priceEur} shape
   the weekly template renders -- and the "is this menu empty/unfit
   to send" check the scheduler uses to decide between sending and
   recording a skipped campaign.
   ========================================== */

/** Keeps only currently-available products, sorted by category then
 * sort_order (matching the public Menu page's own ordering), mapped
 * to exactly the fields the email needs. */
export function buildWeeklyMenuItems(menuItemsRows) {
    const rows = Array.isArray(menuItemsRows) ? menuItemsRows : [];

    return rows
        .filter(row => row && row.available === true)
        .sort((a, b) => {
            const cat = String(a.category || "").localeCompare(String(b.category || ""));
            if (cat !== 0) return cat;
            return (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
        })
        .map(row => ({
            name: row.name,
            description: row.description || "",
            priceEur: Number(row.price) || 0
        }));
}

/** A campaign should never send a broken/empty email. Returns a
 * skip reason string, or null if it's safe to proceed. */
export function weeklyMenuSkipReason(items) {
    if (!Array.isArray(items)) return "menu_load_failed";
    if (items.length === 0) return "empty_menu";
    return null;
}

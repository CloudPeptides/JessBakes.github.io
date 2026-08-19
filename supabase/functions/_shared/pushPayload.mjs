/* ==========================================
   WEB PUSH NOTIFICATION PAYLOAD (new-order alert)

   Pure functions -- no DB/network access, so directly unit-testable.

   Privacy is enforced STRUCTURALLY, not by a filter list: these
   functions' parameters simply have no channel for surname, email,
   phone, address, pickup location, notes, or any token/credential --
   there is nothing here that could leak them, by construction. Only
   a first name, the stored EUR total, the order type/pickup date,
   the order id, and a safe admin URL ever enter the payload.
   ========================================== */

/** "Alex Johnson" -> "Alex". Never returns a surname. Falls back to
 * a generic label rather than ever showing nothing or "undefined". */
export function firstNameOnly(fullName) {
    const trimmed = String(fullName || "").trim();
    if (!trimmed) return "A customer";
    return trimmed.split(/\s+/)[0];
}

function eur(amount) {
    const n = Number(amount) || 0;
    return `€${n.toFixed(2)}`;
}

/** Builds the exact { title, body, tag, data } shape sent as the Web
 * Push message payload (JSON-encrypted client-side by send-push's
 * Deno-only sending code -- see _shared/pushOutbox.ts). `data.url` is
 * a safe, same-origin admin deep link -- an order id in a query
 * string, never a credential or session token. */
export function buildOrderPushPayload({
    orderId, customerName, totalEur, orderType, pickupDate,
    siteUrl = "https://jessbakessourdough.com"
}) {
    const name = firstNameOnly(customerName);
    const typeLabel = orderType === "custom" ? "Custom order" : "Weekly pickup";
    const dateLabel = pickupDate ? `, ${pickupDate}` : "";

    return {
        title: "🧁 New Jess Bakes order",
        body: `${name} · ${eur(totalEur)} · ${typeLabel}${dateLabel}`,
        tag: `order-${orderId}`,
        data: {
            orderId,
            url: `${String(siteUrl).replace(/\/+$/, "")}/admin/orders.html?order=${encodeURIComponent(orderId)}`
        }
    };
}

/** Field names that must NEVER appear anywhere in a rendered push
 * payload -- used only by tests, as an explicit, readable allowlist
 * of what "privacy-conscious" means for this feature. */
export const FORBIDDEN_PUSH_FIELDS = [
    "surname", "last_name", "lastName", "email", "customer_email",
    "phone", "customer_phone", "address", "pickup_location",
    "notes", "special_instructions", "token", "access_token",
    "session", "password"
];

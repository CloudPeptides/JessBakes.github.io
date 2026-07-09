/* ==========================================
   CART.JS
========================================== */

const CART_KEY = "jess_bakes_cart";

let cart = [];
let cartMenuItems = [];
let rerenderMenu = null;

try {
    cart = JSON.parse(localStorage.getItem(CART_KEY)) || [];
} catch {
    cart = [];
}

/* ==========================================
   INITIALIZE
========================================== */

function initializeCart(menuItems, renderMenuCallback) {

    cartMenuItems = menuItems;
    rerenderMenu = renderMenuCallback;

    ensureCheckoutModal();

    renderCart();

}

/* ==========================================
   LOCAL STORAGE
========================================== */

function saveCart() {

    localStorage.setItem(
        CART_KEY,
        JSON.stringify(cart)
    );

}

function clearCart() {

    cart = [];

    saveCart();

    renderCart();

    if (rerenderMenu) {

        rerenderMenu();

    }

}

/* ==========================================
   QUANTITY
========================================== */

function getCartQuantity(itemId) {

    const existing = cart.find(
        item => item.id === itemId
    );

    return existing
        ? existing.quantity
        : 0;

}

function changeCartQuantity(itemId, change) {

    const menuItem = cartMenuItems.find(
        item => item.id === itemId
    );

    if (!menuItem) return;

    const existing = cart.find(
        item => item.id === itemId
    );

    if (!existing && change > 0) {

        cart.push({

            id: menuItem.id,

            name: menuItem.name,

            price: Number(menuItem.price),

            quantity: 1

        });

    } else if (existing) {

        existing.quantity += change;

        if (existing.quantity <= 0) {

            cart = cart.filter(
                item => item.id !== itemId
            );

        }

    }

    saveCart();

    renderCart();

    if (rerenderMenu) {

        rerenderMenu();

    }

}

/* ==========================================
   TOTALS
========================================== */

function getSubtotal() {

    return cart.reduce(

        (sum, item) =>

            sum +
            item.price * item.quantity,

        0

    );

}

function getItemCount() {

    return cart.reduce(

        (sum, item) =>

            sum + item.quantity,

        0

    );

}

/* ==========================================
   FLOATING CART
========================================== */

function renderCart() {

    let cartBox = document.getElementById(
        "floatingCart"
    );

    if (!cartBox) {

        cartBox = document.createElement("div");

        cartBox.id = "floatingCart";

        cartBox.className = "floating-cart";

        document.body.appendChild(cartBox);

    }

    if (!cart.length) {

        cartBox.style.display = "none";

        cartBox.innerHTML = "";

        return;

    }

    cartBox.style.display = "block";

    cartBox.innerHTML = `

<div class="floating-cart-header">

    <strong>

        Your Order

    </strong>

    <span>

        ${getItemCount()} item${getItemCount() === 1 ? "" : "s"}

    </span>

</div>

<div class="floating-cart-items">

${cart.map(item => `

<div class="floating-cart-line">

    <span>

        ${escapeHtml(item.name)}

        ×

        ${item.quantity}

    </span>

    <strong>

        €${formatPrice(
            item.quantity * item.price
        )}

    </strong>

</div>

`).join("")}

</div>

<div class="floating-cart-total">

    <span>

        Subtotal

    </span>

    <strong>

        €${formatPrice(
            getSubtotal()
        )}

    </strong>

</div>

<button

    type="button"

    class="primary-btn cart-checkout-btn"

    onclick="openCheckoutModal()">

    Checkout

</button>

`;

}


/* ==========================================
   CHECKOUT MODAL
========================================== */

function ensureCheckoutModal() {

    if (document.getElementById("checkoutModal")) return;

    const modal = document.createElement("div");

    modal.id = "checkoutModal";
    modal.className = "checkout-modal";
    modal.style.display = "none";

    modal.innerHTML = `

<div class="checkout-card">

    <div class="checkout-header">

        <h2>

            Checkout

        </h2>

        <button
            type="button"
            onclick="closeCheckoutModal()">

            ×

        </button>

    </div>

    <div id="checkoutSummary"></div>

    <form
        id="checkoutForm"
        class="checkout-form">

        <div class="form-group">

            <label>Name</label>

            <input
                id="customerName"
                type="text"
                required>

        </div>

        <div class="form-group">

            <label>Email</label>

            <input
                id="customerEmail"
                type="email">

        </div>

        <div class="form-group">

            <label>Phone</label>

            <input
                id="customerPhone"
                type="tel"
                required>

        </div>

        <div class="form-group">

            <label>Pickup Date</label>

            <input
                id="pickupDate"
                type="date"
                required>

        </div>

        <div class="form-group">

            <label>Notes</label>

            <textarea
                id="orderNotes"
                rows="4"></textarea>

        </div>

        <button
            type="submit"
            class="primary-btn">

            Submit Order

        </button>

    </form>

    <div
        id="checkoutSuccess"
        class="checkout-success"
        style="display:none;">

        <h3>

            Thank you!

        </h3>

        <p>

            Your order request has been submitted.
            I'll review it and contact you shortly.

        </p>

        <button
            class="primary-btn"
            onclick="closeCheckoutModal()">

            Close

        </button>

    </div>

</div>

`;

    document.body.appendChild(modal);

    document
        .getElementById("pickupDate")
        .min = new Date()
        .toISOString()
        .split("T")[0];

    document
        .getElementById("checkoutForm")
        .addEventListener(
            "submit",
            submitOrder
        );

}

/* ==========================================
   OPEN / CLOSE
========================================== */

function openCheckoutModal() {

    if (!cart.length) {

        alert("Your cart is empty.");

        return;

    }

    document
        .getElementById("checkoutModal")
        .style.display = "flex";

    document
        .getElementById("checkoutForm")
        .style.display = "grid";

    document
        .getElementById("checkoutSuccess")
        .style.display = "none";

    renderCheckoutSummary();

}

function closeCheckoutModal() {

    document
        .getElementById("checkoutModal")
        .style.display = "none";

}

/* ==========================================
   SUMMARY
========================================== */

function renderCheckoutSummary() {

    const summary =
        document.getElementById(
            "checkoutSummary"
        );

    summary.innerHTML = `

<div class="checkout-summary">

${cart.map(item => `

<div class="checkout-line">

<span>

${escapeHtml(item.name)}

×

${item.quantity}

</span>

<strong>

€${formatPrice(
    item.price * item.quantity
)}

</strong>

</div>

`).join("")}

<div class="checkout-total">

<span>

Subtotal

</span>

<strong>

€${formatPrice(
    getSubtotal()
)}

</strong>

</div>

</div>

`;

}

/* ==========================================
   SUBMIT ORDER
========================================== */

async function submitOrder(event) {

    event.preventDefault();

    const submitButton =
        event.target.querySelector(
            "button[type='submit']"
        );

    submitButton.disabled = true;
    submitButton.textContent = "Submitting...";

    const customer_name =
        document
            .getElementById("customerName")
            .value.trim();

    const customer_email =
        document
            .getElementById("customerEmail")
            .value.trim();

    const customer_phone =
        document
            .getElementById("customerPhone")
            .value.trim();

    const pickup_date =
        document
            .getElementById("pickupDate")
            .value;

    const notes =
        document
            .getElementById("orderNotes")
            .value.trim();

    const { data: order, error } =
        await supabaseClient

            .from("orders")

            .insert({

                customer_name,

                customer_email,

                customer_phone,

                pickup_date,

                notes,

                subtotal: getSubtotal(),

                status: "pending"

            })

            .select()

            .single();

    if (error) {

        console.error(error);

        alert(error.message);

        submitButton.disabled = false;

        submitButton.textContent = "Submit Order";

        return;

    }

    const items = cart.map(item => ({

        order_id: order.id,

        menu_item_id: item.id,

        item_name: item.name,

        quantity: item.quantity,

        price_at_purchase: item.price,

        line_total:
            item.price * item.quantity

    }));

    const { error: itemError } =
        await supabaseClient

            .from("order_items")

            .insert(items);

    if (itemError) {

        console.error(itemError);

        alert(itemError.message);

        submitButton.disabled = false;

        submitButton.textContent = "Submit Order";

        return;

    }

    clearCart();

    document
        .getElementById("checkoutForm")
        .reset();

    document
        .getElementById("checkoutForm")
        .style.display = "none";

    document
        .getElementById("checkoutSuccess")
        .style.display = "block";

}

/* ==========================================
   HELPERS
========================================== */

function formatPrice(price) {

    return Number(price)
        .toFixed(2)
        .replace(/\.00$/, "");

}

function escapeHtml(text) {

    return String(text || "")

        .replaceAll("&", "&amp;")

        .replaceAll("<", "&lt;")

        .replaceAll(">", "&gt;")

        .replaceAll('"', "&quot;")

        .replaceAll("'", "&#039;");

}

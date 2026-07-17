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
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
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
    const existing = cart.find(item => item.id === itemId);
    return existing ? existing.quantity : 0;
}

function changeCartQuantity(itemId, change) {
    const menuItem = cartMenuItems.find(item => item.id === itemId);

    if (!menuItem) return;

    const existing = cart.find(item => item.id === itemId);

    if (!existing && change > 0) {
        cart.push({
    type: "standard",

    id: menuItem.id,

    name: menuItem.name,

    price: Number(menuItem.price),

    quantity: 1
});
    } else if (existing) {
        existing.quantity += change;

        if (existing.quantity <= 0) {
            cart = cart.filter(item => item.id !== itemId);
        }
    }

    saveCart();
    renderCart();

    if (rerenderMenu) {
        rerenderMenu();
    }
}

/* ==========================================
   BUILDER PRODUCTS
========================================== */

async function openBuilderModal(builderId){

    const builder =
        cartMenuItems.find(i => i.id === builderId);

    if(!builder) return;

    const {data:options,error}=await supabaseClient
        .from("menu_items")
        .select("*")
        .eq("builder_group",builder.builder_group)
        .eq("product_type","standard")
        .eq("available",true)
        .order("name");

    if(error){
        console.error(error);
        alert(error.message);
        return;
    }

    showBuilderModal(builder,options);
}

function showBuilderModal(builder,options){

    alert("Builder modal goes here.");

}

function addBuilderToCart(builderProduct) {

    const existing = cart.find(item =>
        item.type === "builder" &&
        item.id === builderProduct.id &&
        JSON.stringify(item.selections) === JSON.stringify(builderProduct.selections)
    );

    if (existing) {

        existing.quantity++;

    } else {

        cart.push({

            type: "builder",

            id: builderProduct.id,

            name: builderProduct.name,

            price: Number(builderProduct.price),

            quantity: 1,

            selections: builderProduct.selections

        });

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
        (sum, item) => sum + item.price * item.quantity,
        0
    );
}

function getItemCount() {
    return cart.reduce(
        (sum, item) => sum + item.quantity,
        0
    );
}

/* ==========================================
   FLOATING CART
========================================== */

function renderCart() {
    let cartBox = document.getElementById("floatingCart");

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
            <strong>Your Order</strong>
            <span>${getItemCount()} item${getItemCount() === 1 ? "" : "s"}</span>
        </div>

        <div class="floating-cart-items">
            ${cart.map(item => {

    if (item.type === "builder") {

        return `

            <div class="floating-cart-line builder-cart-line">

                <div>

                    <strong>${escapeHtml(item.name)}</strong>

                    ${item.selections.map(selection => `

                        <div class="builder-selection">

                            • ${escapeHtml(selection.name)} × ${selection.quantity}

                        </div>

                    `).join("")}

                    <div>

                        Box × ${item.quantity}

                    </div>

                </div>

                <strong>

                    €${formatPrice(item.price * item.quantity)}

                </strong>

            </div>

        `;

    }

    return `

        <div class="floating-cart-line">

            <span>

                ${escapeHtml(item.name)} × ${item.quantity}

            </span>

            <strong>

                €${formatPrice(item.quantity * item.price)}

            </strong>

        </div>

    `;

}).join("")}
        </div>

        <div class="floating-cart-total">
            <span>Subtotal</span>
            <strong>€${formatPrice(getSubtotal())}</strong>
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
                <h2>Checkout</h2>

                <button
                    type="button"
                    onclick="closeCheckoutModal()">
                    ×
                </button>
            </div>

            <div id="checkoutSummary"></div>

            <form id="checkoutForm" class="checkout-form">

                <div class="form-group">
                    <label>Full Name(First and Last)</label>
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

    <label>Preferred Contact Method</label>

    <select id="preferredContact" required>

        <option value="text">
            Text Message
        </option>

        <option value="email">
            Email
        </option>

    </select>

</div>

                <div class="form-group">
                    <label>Order Type</label>

                    <select
                        id="orderType"
                        required
                        onchange="toggleCustomOrderDetails()">

                        <option value="weekly">
                            Weekly Sunday Pickup
                        </option>

                        <option value="custom">
                            Custom Order or Special Event
                        </option>

                    </select>

                    <div id="pickupInfo" class="pickup-info-card">

                    </div>
                </div>

                <div
                    id="customOrderDetailsGroup"
                    class="form-group"
                    style="display:none;">

                   <label>Event Date *</label>

                   <input
                   type="date"
                   id="eventDate">

                  <label style="margin-top:20px;">
                   Order Details
                  </label>

                  <textarea
                   id="customOrderDetails"
                   rows="5"
                   placeholder="Insert order details here...">
                  </textarea>

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

                <h3>Thank you!</h3>

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
        .getElementById("checkoutForm")
        .addEventListener("submit", submitOrder);
}

/* ==========================================
   ORDER TYPE UI
========================================== */

function getNextPickupDate() {

    const today = new Date();

    const day = today.getDay();

    let daysUntilSunday;

    if (day >= 5) {

        daysUntilSunday = 14 - day;

    } else {

        daysUntilSunday = 7 - day;

    }

    const pickup = new Date(today);

    pickup.setDate(today.getDate() + daysUntilSunday);

    return pickup;

}

function updatePickupInfo() {

    const box = document.getElementById("pickupInfo");

    const orderType = document.getElementById("orderType").value;

    if (orderType === "custom") {

        box.innerHTML = `

            <strong>Custom Orders</strong>

            <p>

                Select the date you need your order.

                Then use the notes below for

                anything else you'd like me to know.

            </p>

        `;

        return;

    }

    const pickup = getNextPickupDate();

    box.innerHTML = `

        <strong>Weekly Sunday Pickup</strong>

        <p>

            Orders placed <strong>Monday–Thursday</strong>

            are scheduled for the upcoming Sunday.

        </p>

        <p>

            Orders placed <strong>Friday–Sunday</strong>

            are automatically scheduled for the

            following Sunday while dough is being

            prepared for the current bake.

        </p>

        <div class="pickup-date">

            <h4>Your Pickup</h4>

            <p>

                ${pickup.toLocaleDateString("en-US",{

                    weekday:"long",

                    month:"long",

                    day:"numeric",

                    year:"numeric"

                })}

                <br>

                12:30 PM

            </p>

        </div>

    `;

}

function toggleCustomOrderDetails() {
    const orderType = document.getElementById("orderType").value;
    const detailsGroup = document.getElementById("customOrderDetailsGroup");

    if (orderType === "custom") {
        detailsGroup.style.display = "block";
    } else {
        detailsGroup.style.display = "none";
        document.getElementById("customOrderDetails").value = "";
    }
   updatePickupInfo();
}


/* ==========================================
   OPEN / CLOSE
========================================== */

function openCheckoutModal() {
    if (!cart.length) {
        alert("Your cart is empty.");
        return;
    }

    document.getElementById("checkoutModal").style.display = "flex";
    document.getElementById("checkoutForm").style.display = "grid";
    document.getElementById("checkoutSuccess").style.display = "none";

    renderCheckoutSummary();
    toggleCustomOrderDetails();
    updatePickupInfo();
}

function closeCheckoutModal() {
    document.getElementById("checkoutModal").style.display = "none";
    document.getElementById("checkoutForm").reset();

   toggleCustomOrderDetails();
   updatePickupInfo();
}

/* ==========================================
   SUMMARY
========================================== */

function renderCheckoutSummary() {
    const summary = document.getElementById("checkoutSummary");

    summary.innerHTML = `
        <div class="checkout-summary">
            ${cart.map(item => {

    if (item.type === "builder") {

        return `

            <div class="checkout-line">

                <div>

                    <strong>${escapeHtml(item.name)}</strong>

                    ${item.selections.map(selection => `

                        <div class="builder-selection">

                            • ${escapeHtml(selection.name)} × ${selection.quantity}

                        </div>

                    `).join("")}

                    <div>

                        Box × ${item.quantity}

                    </div>

                </div>

                <strong>

                    €${formatPrice(item.price * item.quantity)}

                </strong>

            </div>

        `;

    }

    return `

        <div class="checkout-line">

            <span>

                ${escapeHtml(item.name)} × ${item.quantity}

            </span>

            <strong>

                €${formatPrice(item.price * item.quantity)}

            </strong>

        </div>

    `;

}).join("")}

            <div class="checkout-total">
                <span>Subtotal</span>
                <strong>€${formatPrice(getSubtotal())}</strong>
            </div>
        </div>
    `;
}

/* ==========================================
   SUBMIT ORDER
========================================== */

async function submitOrder(event) {
    event.preventDefault();

    const submitButton = event.target.querySelector("button[type='submit']");

    submitButton.disabled = true;
    submitButton.textContent = "Submitting...";

    const customer_name = document.getElementById("customerName").value.trim();
    const customer_email = document.getElementById("customerEmail").value.trim();
    const customer_phone = document.getElementById("customerPhone").value.trim();
    const preferred_contact = document.getElementById("preferredContact").value;
    const order_type = document.getElementById("orderType").value;
    const custom_details = document.getElementById("customOrderDetails").value.trim();

    if (!customer_name) {
        alert("Please enter your name.");
        submitButton.disabled = false;
        submitButton.textContent = "Submit Order";
        return;
    }

    if (!customer_phone) {
        alert("Please enter your phone number.");
        submitButton.disabled = false;
        submitButton.textContent = "Submit Order";
        return;
    }

    if (order_type === "custom" && !custom_details) {
        alert("Please add details for your custom order or event.");
        submitButton.disabled = false;
        submitButton.textContent = "Submit Order";
        return;
    }

    let pickup_date = null;
    let event_date = null;

if (order_type === "weekly") {

    pickup_date = getNextPickupDate()
        .toISOString()
        .split("T")[0];

} else {

    event_date =
        document.getElementById("eventDate").value;

    // Required because pickup_date cannot be NULL.
    // Use the event date as the pickup date.
    pickup_date = event_date;

}

    const notes =
        order_type === "weekly"
            ? "Weekly Sunday Pickup"
            : custom_details;

    const { data: order, error } = await supabaseClient
        .from("orders")
        .insert({
    customer_name,
    customer_email,
    customer_phone,
    preferred_contact,

    order_type,

    pickup_date,
    event_date,

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

    menu_item_id:
        item.type === "builder"
            ? null
            : item.id,

    item_name: item.name,

    quantity: item.quantity,

    price_at_purchase: item.price,

    line_total:
        item.price * item.quantity,

    builder_details:
        item.type === "builder"
            ? item.selections
            : null

}));

    const { error: itemError } = await supabaseClient
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

    document.getElementById("checkoutForm").reset();
    document.getElementById("customOrderDetailsGroup").style.display = "none";

    document.getElementById("checkoutForm").style.display = "none";
    document.getElementById("checkoutSuccess").style.display = "block";

    submitButton.disabled = false;
    submitButton.textContent = "Submit Order";
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

/* ==========================================
   ADMIN APP / PUSH NOTIFICATIONS PANEL (admin/settings.html)

   Registers no push subscription and requests no permission on its
   own -- everything here is read-only status detection until the
   admin explicitly presses a button. See requirement: "do not
   request notification permission automatically."
   ========================================== */

document.addEventListener("DOMContentLoaded", async () => {

    await requireAuth();

    renderInstalledStatus();
    renderSupportStatus();
    await renderPermissionAndSubscriptionStatus();

    document.getElementById("pushEnableBtn").addEventListener("click", enableOrderNotifications);
    document.getElementById("pushTestBtn").addEventListener("click", sendTestNotification);
    document.getElementById("pushDisableBtn").addEventListener("click", disableOnThisDevice);

});

function showPushMessage(text, kind) {
    const el = document.getElementById("pushMessage");
    el.textContent = text;
    el.className = `admin-inline-message is-${kind}`;
    el.style.display = "block";
}

/* ==========================================
   STATUS DETECTION (read-only)
   ========================================== */

function isStandaloneDisplay() {
    // iOS Safari's own flag, plus the general PWA display-mode media
    // query (covers Chrome/Android and newer iOS versions too).
    return (
        window.navigator.standalone === true ||
        (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
    );
}

function isIos() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent || "");
}

function supportsWebPush() {
    return (
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window
    );
}

function renderInstalledStatus() {
    const installed = isStandaloneDisplay();
    document.getElementById("pushStatInstalled").textContent = installed ? "Yes" : "No";

    const instructions = document.getElementById("pushInstallInstructions");
    const enableBtn = document.getElementById("pushEnableBtn");

    if (!installed && isIos()) {
        instructions.style.display = "block";
        enableBtn.disabled = true;
        enableBtn.title = "Install this app to your Home Screen first (see instructions above).";
    } else {
        instructions.style.display = "none";
        enableBtn.disabled = false;
        enableBtn.title = "";
    }
}

function renderSupportStatus() {
    document.getElementById("pushStatSupport").textContent =
        supportsWebPush() ? "Supported" : "Not supported in this browser";
}

async function getCurrentBrowserSubscription() {
    if (!supportsWebPush()) return null;
    try {
        const registration = await navigator.serviceWorker.ready;
        return await registration.pushManager.getSubscription();
    } catch {
        return null;
    }
}

async function renderPermissionAndSubscriptionStatus() {

    const permission = ("Notification" in window) ? Notification.permission : "unsupported";
    document.getElementById("pushStatPermission").textContent =
        { granted: "Granted", denied: "Denied", default: "Not requested yet", unsupported: "Unsupported" }[permission] || permission;

    const subscription = await getCurrentBrowserSubscription();
    const subEl = document.getElementById("pushStatSubscription");

    if (!subscription) {
        subEl.textContent = "Not enabled";
        return;
    }

    // Cross-check the browser subscription against our own record of
    // it -- a subscription can exist at the browser level while our
    // row is disabled (e.g. previously pressed Disable) or missing.
    const { data } = await supabaseClient
        .from("admin_push_subscriptions")
        .select("disabled")
        .eq("endpoint", subscription.endpoint)
        .maybeSingle();

    if (data && !data.disabled) {
        subEl.textContent = "Enabled";
    } else {
        subEl.textContent = "Not enabled";
    }
}

/* ==========================================
   ENABLE
   ========================================== */

function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
}

async function enableOrderNotifications() {

    if (!supportsWebPush()) {
        showPushMessage("This browser doesn't support Web Push.", "error");
        return;
    }

    const button = document.getElementById("pushEnableBtn");
    button.disabled = true;
    showPushMessage("Requesting permission...", "loading");

    try {

        // The ONLY place in this app that ever calls
        // Notification.requestPermission() -- always in direct
        // response to this button press, never automatically.
        const permission = await Notification.requestPermission();
        document.getElementById("pushStatPermission").textContent =
            permission === "granted" ? "Granted" : (permission === "denied" ? "Denied" : "Not requested yet");

        if (permission !== "granted") {
            showPushMessage("Notification permission was not granted.", "warning");
            return;
        }

        showPushMessage("Setting up this device...", "loading");

        const { data: keyData, error: keyError } =
            await supabaseClient.functions.invoke("send-push", { body: { action: "vapid_public_key" } });

        if (keyError || !keyData?.ok || !keyData.publicKey) {
            showPushMessage("Couldn't reach the notification service. Try again shortly.", "error");
            return;
        }

        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
        });

        const { data: userData, error: userError } = await supabaseClient.auth.getUser();
        if (userError || !userData?.user?.id) {
            showPushMessage("Your session expired. Please sign in again.", "error");
            return;
        }

        const subJson = subscription.toJSON();

        const { error: upsertError } = await supabaseClient
            .from("admin_push_subscriptions")
            .upsert({
                admin_user_id: userData.user.id,
                endpoint: subscription.endpoint,
                p256dh_key: subJson.keys.p256dh,
                auth_key: subJson.keys.auth,
                device_label: window.navigator.userAgent.slice(0, 120),
                disabled: false,
                disabled_at: null,
                failure_count: 0,
                last_error: null,
                updated_at: new Date().toISOString()
            }, { onConflict: "endpoint" });

        if (upsertError) {
            console.error(upsertError);
            showPushMessage("Couldn't save this device. Please try again.", "error");
            return;
        }

        showPushMessage("Order notifications are enabled on this device.", "success");
        await renderPermissionAndSubscriptionStatus();

    } catch (err) {
        console.error(err);
        showPushMessage("Something went wrong enabling notifications.", "error");
    } finally {
        button.disabled = false;
    }

}

/* ==========================================
   TEST
   ========================================== */

async function sendTestNotification() {

    const button = document.getElementById("pushTestBtn");
    button.disabled = true;
    showPushMessage("Sending test notification...", "loading");

    try {
        const { data, error } = await supabaseClient.functions.invoke("send-push", { body: { action: "test" } });

        if (error || !data?.ok) {
            showPushMessage(
                data?.reason === "no_active_subscription_for_admin"
                    ? "No active device found. Press Enable Order Notifications first."
                    : "Test notification failed to send.",
                "warning"
            );
            return;
        }

        showPushMessage("Test notification sent. It should arrive within a few seconds.", "success");

    } catch (err) {
        console.error(err);
        showPushMessage("Test notification failed to send.", "error");
    } finally {
        button.disabled = false;
    }

}

/* ==========================================
   DISABLE (this device only)
   ========================================== */

async function disableOnThisDevice() {

    const button = document.getElementById("pushDisableBtn");
    button.disabled = true;
    showPushMessage("Disabling...", "loading");

    try {
        const subscription = await getCurrentBrowserSubscription();

        if (!subscription) {
            showPushMessage("Notifications aren't enabled on this device.", "warning");
            return;
        }

        const endpoint = subscription.endpoint;

        await subscription.unsubscribe();

        const { error } = await supabaseClient
            .from("admin_push_subscriptions")
            .update({ disabled: true, disabled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("endpoint", endpoint);

        if (error) {
            console.error(error);
        }

        showPushMessage("Notifications disabled on this device.", "success");
        await renderPermissionAndSubscriptionStatus();

    } catch (err) {
        console.error(err);
        showPushMessage("Couldn't disable notifications on this device.", "error");
    } finally {
        button.disabled = false;
    }

}

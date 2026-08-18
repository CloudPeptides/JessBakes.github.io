// Invoked every ~15 minutes by pg_cron (checks the configured local
// time itself, rather than relying on a fixed UTC cron hour -- see
// _shared/schedule.mjs for the DST-safe due-time math), and also
// callable by the admin dashboard's "Send Weekly Menu Now" button
// with { force: true }.
//
// Idempotent by construction: email_campaigns.campaign_key has a
// real unique constraint, so even if this function is invoked twice
// concurrently (a slow cron tick overlapping a manual Send Now), at
// most one campaign row is ever created for a given week -- the
// second attempt's insert simply fails with 23505 and this function
// treats that as "already handled," not an error.
import { getAdminClient, isServiceRoleOrAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { isWeeklySendDue, zonedParts } from "../_shared/schedule.mjs";
import { buildWeeklyMenuItems, weeklyMenuSkipReason } from "../_shared/menu.mjs";
import { weeklyCampaignKey, weeklyRecipientKey } from "../_shared/idempotency.mjs";
import { checkQuota } from "../_shared/batching.mjs";
import { processOutboxRow } from "../_shared/processOutbox.ts";

async function loadSettings(adminClient: any) {
    const { data } = await adminClient.from("email_settings").select("*").limit(1).maybeSingle();
    return data || {};
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req);
    if (preflight) return preflight;

    const headers = { ...corsHeaders(req), "Content-Type": "application/json" };
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });

    if (req.method !== "POST") {
        return json({ ok: false, reason: "method_not_allowed" }, 405);
    }

    const authorized = await isServiceRoleOrAdmin(req);
    if (!authorized) {
        return json({ ok: false, reason: "forbidden" }, 403);
    }

    let body: any = {};
    try { body = await req.json(); } catch { /* cron sends no body */ }
    const force = body.force === true;

    const adminClient = getAdminClient();
    const settings = await loadSettings(adminClient);

    if (!settings.newsletter_enabled && !force) {
        return json({ ok: true, skipped: true, reason: "disabled" });
    }

    const now = new Date();
    let campaignKey: string | null;

    if (force) {
        const parts = zonedParts(now, settings.weekly_timezone || "Europe/Berlin");
        campaignKey = weeklyCampaignKey(parts.isoDate);
    } else {
        const due = isWeeklySendDue(now, settings);
        if (!due.due) {
            return json({ ok: true, skipped: true, reason: "not_due" });
        }
        campaignKey = due.campaignKey;
    }

    // Claim this week's campaign. A conflict here means another
    // invocation already created it -- nothing left to do.
    const { data: campaign, error: campaignError } = await adminClient
        .from("email_campaigns")
        .insert({
            campaign_type: "weekly_menu",
            campaign_key: campaignKey,
            status: "pending",
            scheduled_for: now.toISOString()
        })
        .select()
        .single();

    if (campaignError || !campaign) {
        return json({ ok: true, alreadyExists: true, campaignKey });
    }

    // Load the live menu and decide send vs. documented skip.
    const { data: menuRows, error: menuError } = await adminClient
        .from("menu_items")
        .select("name, description, price, available, category, sort_order");

    const items = menuError ? null : buildWeeklyMenuItems(menuRows || []);
    const skipReason = weeklyMenuSkipReason(items);

    if (skipReason) {
        await adminClient.from("email_campaigns").update({
            status: "skipped",
            skip_reason: skipReason,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }).eq("id", campaign.id);

        return json({ ok: true, skipped: true, reason: skipReason, campaignKey });
    }

    await adminClient.from("email_campaigns").update({
        menu_snapshot: items,
        status: "sending",
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    }).eq("id", campaign.id);

    // Only active, non-suppressed subscribers -- unsubscribed/
    // bounced/complained rows are never selected here at all.
    const { data: subscribers } = await adminClient
        .from("subscribers")
        .select("id, email")
        .eq("status", "active");

    const recipients = subscribers || [];

    const quota = checkQuota(recipients.length, {
        dailyLimit: settings.daily_send_limit,
        monthlyLimit: settings.monthly_send_limit
    });

    let enqueued = 0;
    for (const sub of recipients) {
        const { error } = await adminClient.from("email_outbox").insert({
            email_type: "weekly_menu",
            idempotency_key: weeklyRecipientKey(campaignKey!, sub.id),
            recipient_email: sub.email,
            recipient_ref_table: "subscribers",
            recipient_ref_id: sub.id,
            campaign_id: campaign.id
        });
        if (!error) enqueued++;
    }

    await adminClient.from("email_campaigns").update({
        recipient_count: enqueued,
        updated_at: new Date().toISOString()
    }).eq("id", campaign.id);

    // Send immediately in this same invocation rather than waiting
    // for send-emails' own next cron tick -- keeps a manual "Send
    // Now" from the admin dashboard feeling instant. Any row this
    // pass doesn't reach (edge function time limit) is still picked
    // up normally by send-emails' regular processing pass afterward.
    const { data: pendingRows } = await adminClient
        .from("email_outbox")
        .select("*")
        .eq("campaign_id", campaign.id)
        .eq("status", "pending");

    let sent = 0, failed = 0;
    for (const row of pendingRows || []) {
        const { data: claimed } = await adminClient
            .from("email_outbox")
            .update({ status: "sending", updated_at: new Date().toISOString() })
            .eq("id", row.id)
            .eq("status", "pending")
            .select()
            .maybeSingle();

        if (!claimed) continue;
        const outcome = await processOutboxRow(adminClient, claimed, settings);
        if (outcome.success) sent++; else failed++;
    }

    await adminClient.from("email_campaigns").update({
        status: failed > 0 && sent === 0 ? "failed" : "sent",
        sent_count: sent,
        failed_count: failed,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    }).eq("id", campaign.id);

    return json({
        ok: true, campaignKey, recipientCount: enqueued, sent, failed, quotaWarning: quota.warn
    });
});

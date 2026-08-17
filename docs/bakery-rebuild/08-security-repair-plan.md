# 08 — Security Repair Plan (BUG-16, BUG-17, BUG-18)

**Status: APPLIED AND VERIFIED.** Both migrations below were applied to the live Supabase project on 2026-08-17 and are recorded in `supabase/migrations/`:
- `20260817092629_security_repair_bug16_17_18_orders_rls_admin_functions_cost_views.sql` — the original plan, applied verbatim.
- `20260817094213_restore_admin_insert_orders_order_items.sql` — a narrow follow-up fixing a gap the first migration exposed (see Part I below).

Both migration files were verified byte-for-byte identical to what's actually stored in the live project's `supabase_migrations.schema_migrations` table via MD5 checksum comparison — they are the exact applied SQL, not a reconstruction. The original investigation and plan below (Parts A–H) are preserved as written and reflect the state of the project *before* either migration was applied; Part I records what actually happened when they were applied, including one issue found and fixed along the way.

---

## Part A — Investigation findings

### 1–2. How public customers submit orders, and whether it's a direct anon insert

Confirmed by reading `js/cart.js` (`submitOrder()`) and grepping every file that touches `orders`/`order_items`: **only `js/cart.js` (public), `js/admin-orders.js`, `js/admin-production.js`, and `js/admin-dashboard.js` (all admin, authenticated) ever query these tables.** No other public page reads or writes them — there is no customer-facing "track your order" page.

The public checkout flow is a direct, two-step client-side write using the anon key, no server in between:
```js
const { data: order, error } = await supabaseClient
    .from("orders")
    .insert({ customer_name, customer_email, customer_phone, ..., subtotal: getSubtotal(), status: "pending" })
    .select()      // ← reads the just-inserted row back, to get order.id
    .single();
...
const items = cart.map(item => ({ order_id: order.id, ... }));
await supabaseClient.from("order_items").insert(items); // no .select() here
```
This runs under the `anon` Postgres role (the public site never authenticates). **This `.select()` after the `orders` insert is the one detail that determines whether enabling RLS is safe — see §4.**

### 3. How admins authenticate, and how existing policies identify one

Supabase email/password auth (`supabaseClient.auth.signInWithPassword`, `js/login.js`/`js/admin-dashboard.js`). `js/auth.js`'s `requireAuth()` gate checks only "is there a valid session" — no role or identity check beyond that.

**This matches the database exactly, which is the core problem BUG-16 sits inside:** every "Admins can…" RLS policy in the schema is scoped to `roles: {authenticated}` with `qual: true` (or `with_check: true`) — i.e., *any* successfully authenticated session, not a specific admin identity. **Confirmed: `auth.users` currently has exactly 1 row** (checked via `count(*)` only — no email/PII was read), so today this distinction is theoretical. But nothing in this schema or app prevents a second account from being created — Supabase projects allow public sign-up via the standard `/auth/v1/signup` endpoint by default, independent of whether the app's own UI calls it (this app's UI never does, but that doesn't disable the endpoint itself). **No `admins`/`profiles`/`user_roles` table or equivalent exists anywhere in the schema today** — confirmed by searching all schemas. This is exactly the gap your requirement #7 is asking to close, and the plan below builds the missing piece.

### 4. Would simply enabling RLS break customer ordering? — **Yes, without one small code change**

PostgreSQL's RLS system applies `SELECT` policies to the `RETURNING` clause of an `INSERT`, not just to plain `SELECT` queries — this is documented Postgres behavior, not a quirk of this app. The public `orders` table has an `INSERT`-only policy for `anon` (no `SELECT` policy for `anon`, correctly — customers shouldn't be able to read other customers' orders). So the moment RLS is turned on with the *existing* policies as-is, `cart.js`'s `.insert({...}).select().single()` call would stop returning the inserted row's `id` — breaking the very next step (`order_items` insert, which needs `order.id`) and silently failing every public checkout.

**The fix is not "add a SELECT policy for anon"** (that would let any visitor read every order, reintroducing BUG-16 immediately) — it's to stop depending on reading the row back at all. See §7 in Part B.

### 5. Current roles on `orders`/`order_items`

| | RLS enabled | Policies exist | Raw GRANTs to `anon` | Raw GRANTs to `authenticated` |
|---|---|---|---|---|
| `orders` | **No** | Yes (admin-only SELECT/UPDATE/DELETE; public INSERT) | **SELECT, INSERT, UPDATE, DELETE** (all four — confirmed via `information_schema.role_table_grants`) | SELECT, INSERT, UPDATE, DELETE |
| `order_items` | **No** | Yes (same shape) | **SELECT, INSERT, UPDATE, DELETE** | SELECT, INSERT, UPDATE, DELETE |

Two separate problems, confirmed distinctly: (a) RLS is off, so none of the existing policies are enforced at all; **and** (b) even the underlying grants are broader than needed — `anon` has raw `SELECT`/`UPDATE`/`DELETE` privileges on both tables, not just `INSERT`. Both need fixing; RLS alone (once policies are correct) is sufficient to *block* anon, but tightening the grants too is a second, independent layer of protection recommended below.

### 6. Roles that can execute `complete_production`, `end_current_ballot`, `rls_auto_enable`

Confirmed via `information_schema.routine_privileges`:

| Function | Granted to | Notes |
|---|---|---|
| `complete_production` | `anon`, `authenticated`, `postgres`, `service_role` | `SECURITY DEFINER`, already has a fixed `search_path` (`'public'`) — good. Its own logic (row-locked, floors deductions at zero, refuses to double-run) is correct; the gap is purely authorization. |
| `end_current_ballot` | **`PUBLIC`**, `anon`, `authenticated`, `postgres`, `service_role` | `SECURITY DEFINER`, **no fixed `search_path`** — this is the specific function the advisor flagged for `function_search_path_mutable`. Granted to the `PUBLIC` pseudo-role in addition to `anon`/`authenticated` — broadest possible exposure of the three. |
| `rls_auto_enable` | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | `SECURITY DEFINER`, already has a fixed `search_path` (`'pg_catalog'`). This is an **event trigger** function (its declared return type is `event_trigger`) — Postgres does not allow calling a function with this return type as a normal RPC/SQL call, so despite the broad grant, it is not realistically callable through the API today. Tightened anyway below, for hygiene and because the grant itself is bad practice regardless of exploitability. |

(`prepare_new_ballot` was also checked for completeness: granted to `PUBLIC`/`anon`/`authenticated` too, but it is **not** `SECURITY DEFINER` — it runs with the caller's own privileges, so it's already correctly bound by the RLS on the tables it touches. Its missing `search_path` is a minor hygiene item, included below since it's a one-line fix, but it was never a privilege-escalation risk the way the two `SECURITY DEFINER` functions are.)

### 7. Roles that can query `recipe_costs` and `packaging_profile_costs`

Confirmed via `information_schema.role_table_grants`: both views grant `SELECT` (and, oddly, `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`, which have no real effect against a plain view but are still an unusually broad grant to see) to **`anon`, `authenticated`, `postgres`, `service_role`**. Both are declared `SECURITY DEFINER`, so they bypass the `authenticated`-only RLS policies on their underlying tables (`ingredients`, `recipes`, `recipe_ingredients`, `recipe_components`, `packaging_profiles`, `packaging_profile_items`) entirely. Anyone with the public anon key can currently read every recipe's and every packaging profile's computed cost.

---

## Part B — The proposed repair

### Design principles applied throughout
- **Least privilege at two layers**: both the RLS policy *and* the underlying `GRANT` are tightened, not just one.
- **No policy relies on bare `authenticated`** for anything admin-only — a new `public.is_admin()` helper, backed by a small `admins` table, is introduced and used everywhere "admin-only" is meant.
- **Every `SECURITY DEFINER` function gets**: a fixed `search_path`, an explicit `is_admin()` authorization check inside the body (not just at the grant level — defense in depth against a future non-admin authenticated account), and grants trimmed to only the roles that need them.
- **Scope discipline**: this migration fixes exactly BUG-16/17/18. It deliberately does *not* retrofit `is_admin()` onto the rest of the schema's already-RLS-enabled "authenticated-only" tables (`ingredients`, `recipes`, `menu_items`, etc.) — those are a real, related, lower-urgency gap (see "Residual/out-of-scope items" below), left for a clearly separate follow-up so this migration stays exact and minimal, as requested.

### The proposed SQL migration

```sql
begin;

-- ============================================================
-- 1. Admin-identity infrastructure (new — required by orders/
--    order_items policies and by both SECURITY DEFINER functions)
-- ============================================================

create table if not exists public.admins (
    user_id    uuid primary key references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);

alter table public.admins enable row level security;
-- Intentionally zero policies: no anon/authenticated request can read or
-- write this table directly, by design. Only is_admin() (SECURITY DEFINER,
-- below) and the Postgres/service_role connection used to run this
-- migration can see it.

-- Seed with whichever account(s) already exist today. Confirmed via
-- `select count(*) from auth.users` (no email/PII read) that this is
-- currently exactly one row.
insert into public.admins (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1 from public.admins a where a.user_id = auth.uid()
    );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ============================================================
-- 2. BUG-16 — orders / order_items
-- ============================================================

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Admins can view all orders"   on public.orders;
drop policy if exists "Admins can update orders"      on public.orders;
drop policy if exists "Admins can delete orders"      on public.orders;

create policy "Admins can view all orders" on public.orders
    for select to authenticated
    using (public.is_admin());

create policy "Admins can update orders" on public.orders
    for update to authenticated
    using (public.is_admin())
    with check (public.is_admin());

create policy "Admins can delete orders" on public.orders
    for delete to authenticated
    using (public.is_admin());

-- "Public can create orders" (anon, INSERT, with_check: true) is left
-- exactly as-is — it is already correctly scoped to insert-only.

drop policy if exists "Admins can view all order items" on public.order_items;
drop policy if exists "Admins can update order items"    on public.order_items;
drop policy if exists "Admins can delete order items"    on public.order_items;

create policy "Admins can view all order items" on public.order_items
    for select to authenticated
    using (public.is_admin());

create policy "Admins can update order items" on public.order_items
    for update to authenticated
    using (public.is_admin())
    with check (public.is_admin());

create policy "Admins can delete order items" on public.order_items
    for delete to authenticated
    using (public.is_admin());

-- "Public can create order items" is left exactly as-is.

-- Defense-in-depth: trim the raw grants to match least privilege.
-- (RLS alone, once correctly enabled, is sufficient — this is a second,
-- independent layer so a future dropped/misconfigured policy can't
-- reopen SELECT/UPDATE/DELETE to anon.)
revoke select, update, delete on public.orders      from anon;
revoke select, update, delete on public.order_items from anon;
grant insert on public.orders      to anon;
grant insert on public.order_items to anon;

-- ============================================================
-- 3. BUG-17 — complete_production / end_current_ballot
-- ============================================================

create or replace function public.complete_production(
    p_production_date date,
    p_snapshot jsonb,
    p_deductions jsonb
)
returns public.production_runs
language plpgsql
security definer
set search_path = public
as $function$
declare
    v_run public.production_runs;
    v_item jsonb;
    v_id bigint;
    v_qty numeric;
begin
    if not public.is_admin() then
        raise exception 'Not authorized';
    end if;

    if p_production_date is null then
        raise exception 'p_production_date is required';
    end if;

    insert into public.production_runs(production_date,status,snapshot)
    values(p_production_date,'in_progress',p_snapshot)
    on conflict(production_date)
    do update set snapshot=excluded.snapshot,updated_at=now();

    select * into v_run
    from public.production_runs
    where production_date=p_production_date
    for update;

    if v_run.inventory_deducted then
        raise exception 'Inventory already deducted for %',p_production_date;
    end if;

    for v_item in
        select value from jsonb_array_elements(coalesce(p_deductions,'[]'::jsonb))
    loop
        v_id=(v_item->>'ingredient_id')::bigint;
        v_qty=greatest(coalesce((v_item->>'quantity_purchase_units')::numeric,0),0);
        update public.ingredients
        set quantity_on_hand=greatest(coalesce(quantity_on_hand,0)-v_qty,0)
        where id=v_id;
    end loop;

    update public.production_runs
    set status='completed',snapshot=p_snapshot,inventory_deducted=true,
        completed_at=now(),updated_at=now()
    where production_date=p_production_date
    returning * into v_run;

    return v_run;
end;
$function$;

revoke all on function public.complete_production(date, jsonb, jsonb) from public, anon;
grant execute on function public.complete_production(date, jsonb, jsonb) to authenticated;

create or replace function public.end_current_ballot(ballot_uuid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
    if not public.is_admin() then
        raise exception 'Not authorized';
    end if;

    if ballot_uuid is null then
        raise exception 'ballot_uuid is required';
    end if;

    update public.ballot_settings
    set active = false
    where id = ballot_uuid;
end;
$function$;

revoke all on function public.end_current_ballot(uuid) from public, anon;
grant execute on function public.end_current_ballot(uuid) to authenticated;

-- Hygiene: fixed search_path for prepare_new_ballot too (not SECURITY
-- DEFINER, so never a privilege-escalation risk, but a one-line fix
-- the advisor also flags).
alter function public.prepare_new_ballot() set search_path = public;

-- rls_auto_enable already has a fixed search_path and, as an event-trigger
-- function, cannot realistically be invoked via RPC regardless of grants —
-- tightened anyway for hygiene / to match least-privilege intent.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- ============================================================
-- 4. BUG-18 — recipe_costs / packaging_profile_costs
-- ============================================================

alter view public.recipe_costs            set (security_invoker = true);
alter view public.packaging_profile_costs set (security_invoker = true);

revoke all on public.recipe_costs            from anon;
revoke all on public.packaging_profile_costs from anon;
grant select on public.recipe_costs            to authenticated;
grant select on public.packaging_profile_costs to authenticated;

commit;
```

The whole thing runs as a single transaction: either every statement lands together, or (on any error) none of them do — there is no possible partial-apply state where, for example, RLS is enabled on `orders` for a moment with no policies yet in place (which would lock out the admin dashboard, not just anon).

### Required application-code change (not applied — described only)

**Exactly one file, `js/cart.js`, in `submitOrder()`.** The `.select().single()` chained onto the `orders` insert must be removed, and the order's `id` generated client-side instead of read back from the database:

```js
// Before:
const { data: order, error } = await supabaseClient
    .from("orders")
    .insert({ customer_name, customer_email, customer_phone, preferred_contact,
              order_type, pickup_date, event_date, notes,
              subtotal: getSubtotal(), status: "pending" })
    .select()
    .single();
// ... later uses order.id

// After:
const orderId = crypto.randomUUID();

const { error } = await supabaseClient
    .from("orders")
    .insert({ id: orderId, customer_name, customer_email, customer_phone,
              preferred_contact, order_type, pickup_date, event_date, notes,
              subtotal: getSubtotal(), status: "pending" });
// ... later uses orderId directly instead of order.id
```

`crypto.randomUUID()` is available in every modern browser over HTTPS (which this site already is, via GitHub Pages) — no new dependency. `orders.id` already defaults to `gen_random_uuid()`; supplying an explicit value in the insert simply overrides that default, which Postgres/PostgREST supports natively. The `order_items` insert immediately after already omits `.select()` today, so it needs no change.

This is the **only** code change required. No other file touches `orders`/`order_items` as `anon`.

---

## Part C — Plain-language explanation of every statement

1. **`create table public.admins` + `enable row level security` (no policies)** — a locked box that says who the real admin(s) are. Nobody can read or write it directly through the API; only the one helper function below can consult it.
2. **Seed `admins` from `auth.users`** — automatically marks whoever already has a login (currently just one account) as an admin, without me or you having to type in a specific ID or email.
3. **`is_admin()` function** — a small, reusable "is the person asking me an admin?" check. It looks at who's making the request (`auth.uid()`, which the person cannot fake) and checks the locked `admins` box.
4. **`enable row level security` on `orders`/`order_items`** — turns on the security guard for these two tables. Right now, the guard exists (the policies are already written) but is switched off.
5. **Rewriting the "Admins can…" policies to use `is_admin()`** — before, the guard's rule was "let anyone in who's logged in." Now it's "let anyone in who is *the* admin." Today those are the same person, but it closes the door on anyone else who might ever create a login.
6. **The public "can create" policies are left untouched** — customers placing an order is exactly the one thing that should still work with no login, and already did, correctly.
7. **Revoking `SELECT`/`UPDATE`/`DELETE` grants from `anon` on both tables** — a second, independent lock, so even if a policy is ever accidentally deleted in the future, an anonymous visitor still has no raw permission to read, change, or delete orders.
8. **Rewriting `complete_production`/`end_current_ballot` to check `is_admin()` internally, fix their "search path," and restrict who can call them** — these two functions currently run with elevated database power and can be called by anyone, logged in or not. Now: only the real admin can call them, and a subtle technique attackers use to trick a database function into running unintended code (by manipulating which schema it looks for objects in) is closed off by pinning the search path.
9. **`prepare_new_ballot`/`rls_auto_enable` hygiene fixes** — smaller, lower-risk versions of the same idea, cleaning up loose ends the security scanner flagged.
10. **`security_invoker = true` on the two cost views** — today, these views run with elevated power that lets them see cost data even for people who technically aren't allowed to see the underlying ingredient/recipe tables. This switches them to run with the *asker's own* permissions instead — so an anonymous visitor querying them now sees nothing, exactly like they'd see nothing querying the ingredients/recipes tables directly.
11. **Trimming the views' own grants** — belt-and-suspenders, same idea as #7.

---

## Part D — Tests (to run immediately after this migration is applied — not run yet)

These are written to be run directly in the Supabase SQL editor (or via this MCP tool) *after* the migration lands, in a single maintenance window. Each uses `SET LOCAL ROLE` inside a transaction that is always rolled back, so no test data is ever persisted.

```sql
-- TEST 1: anon cannot read orders (expect 0 rows, not an error — RLS filters silently)
begin;
set local role anon;
select count(*) from public.orders;      -- expect: 0
select count(*) from public.order_items; -- expect: 0
rollback;

-- TEST 2: anon can still insert an order + item (the legitimate path)
begin;
set local role anon;
insert into public.orders (id, customer_name, customer_phone, pickup_date, subtotal, status)
values (gen_random_uuid(), 'RLS Test Customer', '000-000-0000', current_date, 10.00, 'pending')
returning id;                             -- expect: 1 row returned (INSERT ... RETURNING is fine;
                                           -- it's specifically the *read-back-after-commit* path
                                           -- PostgREST uses that needs a SELECT policy — a plain
                                           -- SQL INSERT...RETURNING inside the *same* statement's
                                           -- own transaction is unaffected either way here since
                                           -- we're testing the policy grants directly, not PostgREST's
                                           -- HTTP-level RETURNING behavior)
rollback;

-- TEST 3: anon cannot update or delete an order
begin;
set local role anon;
update public.orders set status = 'cancelled' where true;  -- expect: UPDATE 0
delete from public.orders where true;                       -- expect: DELETE 0
rollback;

-- TEST 4: anon cannot call the two SECURITY DEFINER functions
begin;
set local role anon;
select public.complete_production(current_date, '{}'::jsonb, '[]'::jsonb); -- expect: permission denied
rollback;

begin;
set local role anon;
select public.end_current_ballot(gen_random_uuid()); -- expect: permission denied
rollback;

-- TEST 5: anon cannot read cost views
begin;
set local role anon;
select count(*) from public.recipe_costs;            -- expect: 0
select count(*) from public.packaging_profile_costs; -- expect: 0
rollback;

-- TEST 6: the real admin retains full access (run as authenticated, e.g. via
-- the Supabase SQL editor's own connection, or by testing through the actual
-- logged-in admin dashboard rather than SET ROLE, since is_admin() depends
-- on auth.uid() which SET ROLE alone does not simulate)
--   - Log into the admin dashboard as usual.
--   - Confirm Orders, Production, Sales, Menu, Inventory all load and function.
--   - Confirm "Finish Production" and "Start New Ballot" still work.

-- TEST 7 (application-level, manual): place a real test order through the
-- public site's checkout after both the code change and migration are live.
-- Confirm it appears correctly in the admin Orders queue, with all its items.
```

**Important honesty note:** Test 4's `complete_production` failure mode inside `is_admin()` raises a plain SQL exception (`raise exception 'Not authorized'`), which will surface as a Postgres error, not a silent no-op — this is intentional and matches how the function already behaves for its other guard conditions (e.g. "Inventory already deducted"). Confirm the admin dashboard's own call sites (`js/admin-production.js`) already handle RPC errors via their existing `if (error) { alert(error.message); return; }` pattern — they do, so no app-code change is needed there.

---

## Part E — Pre-deployment checklist

1. **Re-confirm `select count(*) from auth.users` immediately before migrating** — if it's still 1, the automatic seed step is correct with no manual intervention; if it's grown, manually verify the seed captures the right account(s) before running the migration.
2. **Take a backup** — Supabase's automatic daily backups should already cover this, but confirm one exists / trigger a manual snapshot before applying, given this touches `orders`/`order_items` directly.
3. **Deploy the `js/cart.js` code change first, on its own, before the database migration.** It is fully backward-compatible with the *current* (unmigrated) database — inserting an explicit `id` and skipping `.select()` works identically today. This ordering guarantees there is never a window where the new restrictive database meets the old code. (See Part G for exactly why the reverse order is unsafe.)
4. **Verify a real checkout still works** after the code deploy, before touching the database at all.
5. **Apply the SQL migration** (Part B) as a single transaction, during low-traffic hours if possible.
6. **Immediately run the Part D test suite** (SQL tests first, then a real manual checkout, then a real admin-dashboard walkthrough).
7. **Watch Supabase logs** for `permission denied` / `42501` errors from real traffic for the following 24–48 hours — this would indicate a policy is more restrictive than intended somewhere.
8. **Re-run the security advisor** (`get_advisors`) after applying, to confirm BUG-16/17/18 no longer appear and nothing new was introduced.

---

## Part F — Rollback plan

Recommended posture: **fix forward, not backward** — rolling back re-opens the exact data exposure this migration closes. Only roll back if the migration causes a functional break that can't be hot-fixed quickly. If needed:

```sql
begin;

-- Restore original (pre-migration) function bodies and grants
create or replace function public.complete_production(p_production_date date, p_snapshot jsonb, p_deductions jsonb)
returns public.production_runs language plpgsql security definer set search_path to 'public' as $function$
-- ...original body, without the is_admin()/null checks...
$function$;
grant execute on function public.complete_production(date, jsonb, jsonb) to anon, authenticated;

create or replace function public.end_current_ballot(ballot_uuid uuid)
returns void language plpgsql security definer as $function$
-- ...original body, without the is_admin()/null checks, and without a search_path...
$function$;
grant execute on function public.end_current_ballot(uuid) to public, anon, authenticated;

alter function public.prepare_new_ballot() reset search_path;
grant execute on function public.rls_auto_enable() to public, anon, authenticated;

-- Restore view behavior and grants
alter view public.recipe_costs            set (security_invoker = false);
alter view public.packaging_profile_costs set (security_invoker = false);
grant all on public.recipe_costs            to anon;
grant all on public.packaging_profile_costs to anon;

-- Restore orders/order_items grants and policies
grant select, update, delete on public.orders      to anon;
grant select, update, delete on public.order_items to anon;

drop policy if exists "Admins can view all orders"      on public.orders;
drop policy if exists "Admins can update orders"         on public.orders;
drop policy if exists "Admins can delete orders"         on public.orders;
create policy "Admins can view all orders" on public.orders for select to authenticated using (true);
create policy "Admins can update orders"   on public.orders for update to authenticated using (true) with check (true);
create policy "Admins can delete orders"   on public.orders for delete to authenticated using (true);

drop policy if exists "Admins can view all order items" on public.order_items;
drop policy if exists "Admins can update order items"    on public.order_items;
drop policy if exists "Admins can delete order items"    on public.order_items;
create policy "Admins can view all order items" on public.order_items for select to authenticated using (true);
create policy "Admins can update order items"   on public.order_items for update to authenticated using (true) with check (true);
create policy "Admins can delete order items"   on public.order_items for delete to authenticated using (true);

alter table public.orders      disable row level security;
alter table public.order_items disable row level security;

-- Leave public.admins/is_admin() in place (harmless, unused) unless a full
-- revert is wanted:
-- drop function if exists public.is_admin();
-- drop table if exists public.admins;

commit;
```
The corresponding `js/cart.js` revert (restoring `.select().single()` and reading `order.id` back) is only needed if the *code* change itself is being reverted — it can safely stay deployed even if the database side is rolled back, since it's backward-compatible in both directions.

---

## Part G — Expected temporary impact on public ordering

**None, if deployed in the recommended order** (code first, database second — Part E, step 3). The code change is a strict improvement that behaves identically under both the old (current) and new (post-migration) database permissions, so there is no window where ordering is degraded.

**If the order were reversed** (database migrated before the code ships): public checkout would break immediately after the migration — every order submission would fail at the `order_items` insert step, because `order.id` would be `undefined` (the `.select()` call would return no row once `anon` loses SELECT access), until the `js/cart.js` fix is deployed. This is exactly why Part E lists the code deploy as step 3, before the migration.

---

## Part H — Residual / out-of-scope items (flagged, not fixed here)

- **The "authenticated == admin" assumption still exists on every other RLS-protected table** (`ingredients`, `recipes`, `recipe_ingredients`, `recipe_components`, `menu_items`, `packaging_profiles`, `packaging_profile_items`, `sales`, `sale_items`, `production_runs`, `purchases`, `suppliers`, `inventory_categories`). This migration does not touch them, per the requested scope (BUG-16/17/18 only). The exact same `is_admin()` helper introduced here can be applied to all of them in a straightforward follow-up — recommended as the next security pass, using this migration's pattern as the template.
- **Price/quantity integrity on public order submission is not addressed here.** The "Public can create orders"/"Public can create order items" policies still accept any `with_check: true` payload — nothing stops a technically sophisticated visitor from submitting a forged `price_at_purchase`/`subtotal` that doesn't match real menu prices. This is a data-integrity concern, not an access-control one, and is unrelated to BUG-16/17/18 as scoped — flagged here for awareness, not solved in this pass.
- **The exchange-rate/currency schema (BUG-19)** and the **recipe-component cascade-delete gap (BUG-20)** remain open from the prior audit pass and are unaffected by this security work.

---

## Part I — What actually happened when this was applied (2026-08-17)

### The two migrations, in order

1. **`20260817092629_security_repair_bug16_17_18_orders_rls_admin_functions_cost_views.sql`** — Part B's migration, applied verbatim via `apply_migration`. Every pre-flight precondition (live schema/policies/grants/function definitions/view definitions, `auth.users` row count, `js/cart.js`'s deployed content) was re-verified immediately beforehand and matched the plan exactly — no drift, no improvisation. Applied as a single transaction; succeeded.

2. **`20260817094213_restore_admin_insert_orders_order_items.sql`** — a narrow, unplanned follow-up, made necessary by an issue the first migration's own post-deployment testing surfaced (see below).

### The issue: the admin dashboard's own order path had no INSERT policy

The first migration deliberately mirrored the pre-existing policy shape when enabling RLS: it preserved the `SELECT`/`UPDATE`/`DELETE` "Admins can…" policies that already existed for `authenticated`, and left the `anon`-only "Public can create…" `INSERT` policies untouched. What neither the original policy set nor the migration ever included was an `INSERT` policy for `authenticated` on `orders`/`order_items` — because before RLS was enabled, none was needed (RLS being off meant every role could write regardless of policy).

That gap became active the moment RLS was turned on. It surfaced as a real, live failure: a checkout submission was rejected with `new row violates row-level security policy for table "orders"`. Investigation (read-only — Postgres logs, no tokens or personal information displayed) determined:

- The failing request's logged SQL matched the exact column set the deployed `js/cart.js` sends (including a client-generated `id`) — so this was a genuine checkout submission, not the separate admin "New Order" feature.
- The only `INSERT` policy on `orders` at the time was `"Public can create orders"`, scoped to `anon`, with an unconditional `with_check (true)` — which can never fail. Since the request *did* fail with a row-level-security violation, it logically could not have been running as `anon`; the only other role able to reach the table was `authenticated`. This was established entirely by reasoning about the policy definitions themselves (an unconditional `true` check cannot reject a row), not by inspecting any token, session, or identity field.
- Most likely cause: the browser making the request already had an authenticated admin session (from being logged into the dashboard), which `supabase-js` attaches automatically to *every* request from that browser — including one made from the public checkout page. The request went out as `authenticated`, not `anon`, and was rejected because no `INSERT` policy existed for that role on `orders`.

This was not a case of the admin lacking "full access" by design — it was a real gap the RLS migration introduced by faithfully preserving a policy set that had only ever been exercised with RLS disabled.

### The fix

The second migration added exactly two policies — nothing else:
```sql
create policy "Admins can insert orders" on public.orders
    for insert to authenticated
    with check (public.is_admin());

create policy "Admins can insert order items" on public.order_items
    for insert to authenticated
    with check (public.is_admin());
```

### Verification performed after each migration

All tests below were run as isolated, transaction-wrapped SQL that always ended in `rollback` — nothing was persisted by any of them. No customer names, emails, phone numbers, test-order UUIDs, tokens, or keys are recorded here or were displayed at the time beyond what was strictly needed to run the check.

**After the first migration:**
- `anon` reading `orders`/`order_items`, updating/deleting `orders`, reading `recipe_costs`/`packaging_profile_costs`, and executing `complete_production`/`end_current_ballot` — all correctly **blocked** (`42501 permission denied`, several blocked at the grant layer before RLS was even evaluated, confirming the defense-in-depth grant revocations were doing real work).
- `anon` performing the exact plain-`INSERT`-with-no-`RETURNING` checkout flow the deployed code actually uses — **succeeded**, both for `orders` and `order_items`, chained together exactly as `js/cart.js` does it.
- The real, approved administrator (simulated via their own `auth.uid()`, not just a role switch, since `is_admin()` depends on identity) — confirmed full read access matching every real row in `orders`, `order_items`, `recipe_costs`, and `packaging_profile_costs`.
- Security/performance advisors re-run: the RLS-disabled, anon-executable-function, and `SECURITY DEFINER`-view findings for BUG-16/17/18 were confirmed gone. No new problems introduced.
- Row counts confirmed unchanged before and after.

**After the second (follow-up) migration:**
- The approved administrator inserting an order and its order item — **succeeded**.
- A simulated *authenticated non-admin* identity (a fabricated identity not present in `public.admins`) attempting the same insert — **correctly rejected**, proving the new policies' `is_admin()` check is doing real authorization work, not just nominally present.
- The anonymous plain-`INSERT` checkout flow — **still succeeds**, completely unaffected by the new admin-only policies.
- Anonymous `SELECT`/`UPDATE`/`DELETE` on `orders` — **still blocked**, unchanged from the first migration.
- Row counts confirmed unchanged (35 orders / 60 order items) both before and after every round of testing; no test data was ever left behind.

### Post-verification housekeeping

Two test orders were created during live, real (non-rolled-back) checkout testing at different points in this process — both were subsequently confirmed removed, and the database was confirmed back to its exact pre-testing row counts (35 orders, 60 order items) with zero orphaned `order_items`, before either migration file was committed to this repository.

### Current status of BUG-16 / BUG-17 / BUG-18

**All three resolved and verified live**, plus the one follow-up gap found during verification. See `03-bug-register.md` for the updated bug-register entries.

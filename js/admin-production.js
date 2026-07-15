/* ADMIN PRODUCTION */
const CHECKLIST = [
    "Review orders",
    "Feed starter",
    "Scale ingredients",
    "Mix dough and batters",
    "Prepare inclusions",
    "Complete folds / development",
    "Bulk proof on counter",
    "Cold proof / chill",
    "Divide and shape (next day)",
    "Bake (next day)",
    "Cool completely (next day)",
    "Package and label (Sunday)"
];


const MASS={g:1,gram:1,grams:1,kg:1000,kilogram:1000,kilograms:1000,oz:28.3495,ounce:28.3495,ounces:28.3495,lb:453.592,lbs:453.592,pound:453.592,pounds:453.592};
const VOLUME={ml:1,milliliter:1,milliliters:1,l:1000,liter:1000,liters:1000,tsp:4.92892,teaspoon:4.92892,teaspoons:4.92892,tbsp:14.7868,tablespoon:14.7868,tablespoons:14.7868,cup:236.588,cups:236.588,"fl oz":29.5735,floz:29.5735};
const COUNT=["each","item","items","count","piece","pieces","unit","units"];
let data = {
    orders: [],
    menu: [],
    recipes: [],
    recipeIngredients: [],
    recipeComponents: [],
    ingredients: [],
    packagingItems: [],
    recipeCosts: [],
    packagingCosts: [],
    run: null
};
let plan=emptyPlan();

document.addEventListener("DOMContentLoaded",async()=>{await requireAuth();if(typeof setupLogout==="function")setupLogout();setDefaultDate();await loadReferenceData();await loadSelectedDate();});

async function loadReferenceData() {

    const results = await Promise.all([
        supabaseClient.from("menu_items").select("*"),
        supabaseClient.from("recipes").select("*"),
        supabaseClient.from("recipe_ingredients").select("*"),
        supabaseClient.from("recipe_components").select("*"),
        supabaseClient.from("ingredients").select("*").order("name"),
        supabaseClient.from("packaging_profile_items").select("*"),
        supabaseClient.from("recipe_costs").select("*"),
        supabaseClient.from("packaging_profile_costs").select("*"),
        supabaseClient
            .from("orders")
            .select("pickup_date,status")
            .in("status", ["pending", "confirmed", "ready"])
            .order("pickup_date")
    ]);

    const failed = results.find(result => result.error);

    if (failed) {
        console.error(failed.error);
        fatal(failed.error.message);
        return;
    }

    [
        data.menu,
        data.recipes,
        data.recipeIngredients,
        data.recipeComponents,
        data.ingredients,
        data.packagingItems,
        data.recipeCosts,
        data.packagingCosts
    ] = results.slice(0, 8).map(result => result.data || []);

    populateDates(results[8].data || []);

}

async function loadSelectedDate(){
 const date=selectedDate();if(!date)return;loading();
 const [ordersResult,runResult]=await Promise.all([
  supabaseClient.from("orders").select(`*,order_items(*)`).eq("pickup_date",date).in("status",["pending","confirmed","ready"]).order("created_at"),
  supabaseClient.from("production_runs").select("*").eq("production_date",date).maybeSingle()
 ]);
 if(ordersResult.error){console.error(ordersResult.error);fatal(ordersResult.error.message);return;}
 if(runResult.error&&runResult.error.code!=="42P01")console.error(runResult.error);
 data.orders=ordersResult.data||[];data.run=runResult.data||null;plan=buildPlan();renderAll();
}

function buildPlan() {

    const menuMap =
        new Map(
            data.menu.map(item => [
                String(item.id),
                item
            ])
        );

    const recipeMap =
        new Map(
            data.recipes.map(recipe => [
                String(recipe.id),
                recipe
            ])
        );

    const ingredientMap =
        new Map(
            data.ingredients.map(ingredient => [
                String(ingredient.id),
                ingredient
            ])
        );

    const packagingCostMap =
        new Map(
            data.packagingCosts.map(cost => [
                String(cost.id),
                cost
            ])
        );

    const products = new Map();
    const batches = new Map();
    const ingredients = new Map();
    const packaging = new Map();
    const warnings = [];

    let itemCount = 0;
    let revenue = 0;
    let packagingCost = 0;

    data.orders.forEach(order => {

        revenue += Number(order.subtotal || 0);

        (order.order_items || []).forEach(orderItem => {

            const quantity =
                Number(orderItem.quantity || 0);

            itemCount += quantity;

            const menuItem =
                menuMap.get(
                    String(orderItem.menu_item_id)
                );

            const productKey =
                String(
                    orderItem.menu_item_id ||
                    orderItem.item_name
                );

            const product =
                products.get(productKey) || {
                    name:
                        orderItem.item_name ||
                        menuItem?.name ||
                        "Unknown",
                    quantity: 0,
                    revenue: 0,
                    category:
                        menuItem?.category ||
                        "Unassigned"
                };

            product.quantity += quantity;

            product.revenue +=
                Number(orderItem.line_total || 0);

            products.set(productKey, product);

            if (!menuItem) {

                warnings.push(
                    `${orderItem.item_name} is not linked to a current menu item.`
                );

                return;

            }

            const parentRecipe =
                recipeMap.get(
                    String(menuItem.recipe_id)
                );

            if (!parentRecipe) {

                warnings.push(
                    `${menuItem.name} does not have a recipe assigned.`
                );

            } else {

                const recipeUnits =
                    quantity *
                    Number(
                        menuItem.recipe_units_used || 1
                    );

                const parentYield =
                    Number(
                        parentRecipe.yield_quantity || 1
                    );

                const parentMultiplier =
                    recipeUnits / parentYield;

                collectRecipeRequirements({
                    recipe: parentRecipe,
                    multiplier: parentMultiplier,
                    recipeUnits,
                    recipeMap,
                    ingredientMap,
                    ingredientTotals: ingredients,
                    batchTotals: batches,
                    warnings,
                    path: []
                });

            }

            if (!menuItem.packaging_profile_id) {

                warnings.push(
                    `${menuItem.name} does not have a packaging profile assigned.`
                );

            } else {

                data.packagingItems
                    .filter(item =>
                        String(item.profile_id) ===
                        String(
                            menuItem.packaging_profile_id
                        )
                    )
                    .forEach(profileItem => {

                        const ingredient =
                            ingredientMap.get(
                                String(
                                    profileItem.ingredient_id
                                )
                            );

                        if (!ingredient) return;

                        addReq(
                            packaging,
                            ingredient,
                            Number(
                                profileItem.quantity || 0
                            ) * quantity,
                            "packaging"
                        );

                    });

                packagingCost +=
                    Number(
                        packagingCostMap.get(
                            String(
                                menuItem.packaging_profile_id
                            )
                        )?.packaging_cost || 0
                    ) * quantity;

            }

        });

    });

    const ingredientRequirements =
        [...ingredients.values()]
            .sort(sortName);

    const foodCost =
        ingredientRequirements.reduce(
            (sum, requirement) =>
                sum +
                calculateRequirementCost(
                    requirement
                ),
            0
        );

    const combined =
        combine([
            ...ingredientRequirements,
            ...packaging.values()
        ]);

    const shortages =
        combined.filter(item =>
            item.shortage > 0
        );

    const profit =
        revenue -
        foodCost -
        packagingCost;

    return {
        date:
            selectedDate(),
        orders:
            data.orders,
        products:
            [...products.values()]
                .sort(
                    (a, b) =>
                        b.quantity - a.quantity
                ),
        batches:
            [...batches.values()]
                .sort(
                    (a, b) =>
                        a.name.localeCompare(b.name)
                ),
        ingredientReq:
            ingredientRequirements,
        packagingReq:
            [...packaging.values()]
                .sort(sortName),
        combined,
        shortages,
        warnings:
            [...new Set(warnings)],
        orderCount:
            data.orders.length,
        itemCount,
        revenue,
        foodCost,
        packagingCost,
        totalCost:
            foodCost + packagingCost,
        profit,
        margin:
            revenue
                ? profit / revenue * 100
                : 0
    };

}

function collectRecipeRequirements({
    recipe,
    multiplier,
    recipeUnits,
    recipeMap,
    ingredientMap,
    ingredientTotals,
    batchTotals,
    warnings,
    path
}) {

    const recipeId =
        String(recipe.id);

    if (path.includes(recipeId)) {

        const cycleNames =
            [...path, recipeId]
                .map(id =>
                    recipeMap.get(id)?.name || id
                )
                .join(" → ");

        warnings.push(
            `Circular recipe component detected: ${cycleNames}.`
        );

        return;

    }

    const nextPath =
        [...path, recipeId];

    addRecipeBatch(
        batchTotals,
        recipe,
        multiplier,
        recipeUnits
    );

    data.recipeIngredients
        .filter(item =>
            String(item.recipe_id) ===
            recipeId
        )
        .forEach(recipeIngredient => {

            const ingredient =
                ingredientMap.get(
                    String(
                        recipeIngredient.ingredient_id
                    )
                );

            if (!ingredient) {

                warnings.push(
                    `${recipe.name} contains a missing ingredient link.`
                );

                return;

            }

            addReq(
                ingredientTotals,
                ingredient,
                Number(
                    recipeIngredient.quantity || 0
                ) * multiplier,
                "ingredient"
            );

        });

    data.recipeComponents
        .filter(component =>
            String(component.parent_recipe_id) ===
            recipeId
        )
        .forEach(component => {

            const componentRecipe =
                recipeMap.get(
                    String(
                        component.component_recipe_id
                    )
                );

            if (!componentRecipe) {

                warnings.push(
                    `${recipe.name} contains a missing component recipe.`
                );

                return;

            }

            const requiredComponentAmount =
                Number(
                    component.quantity_used || 0
                ) * multiplier;

            const componentYieldUnit =
                componentRecipe.yield_unit ||
                component.quantity_unit;

            // If both are count-based units (item, piece, unit, etc.),
            // use the quantity directly instead of attempting a weight conversion.
            const convertedAmount =
                unit(component.quantity_unit) === unit(componentYieldUnit)
                    ? requiredComponentAmount
                    : convert(
                        requiredComponentAmount,
                        component.quantity_unit,
                        componentYieldUnit
                    );

            if (convertedAmount === null) {

                warnings.push(
                    `${recipe.name} uses ${componentRecipe.name} in ${component.quantity_unit}, but that cannot be converted to the component yield unit ${componentYieldUnit}.`
                );

                return;

            }

            const componentYield =
                Number(
                    componentRecipe.yield_quantity || 0
                );

            if (componentYield <= 0) {

                warnings.push(
                    `${componentRecipe.name} needs a yield quantity greater than zero.`
                );

                return;

            }

            const componentMultiplier =
                convertedAmount /
                componentYield;

            collectRecipeRequirements({
                recipe:
                    componentRecipe,
                multiplier:
                    componentMultiplier,
                recipeUnits:
                    convertedAmount,
                recipeMap,
                ingredientMap,
                ingredientTotals,
                batchTotals,
                warnings,
                path:
                    nextPath
            });

        });

}

function addRecipeBatch(
    batchTotals,
    recipe,
    multiplier,
    recipeUnits
) {

    const key =
        String(recipe.id);

    const current =
        batchTotals.get(key) || {
            id:
                recipe.id,
            name:
                recipe.name,
            notes:
                recipe.notes || "",
            yieldQuantity:
                Number(
                    recipe.yield_quantity || 1
                ),
            yieldUnit:
                recipe.yield_unit || "items",
            recipeUnits: 0,
            batches: 0
        };

    current.recipeUnits +=
        Number(recipeUnits || 0);

    current.batches +=
        Number(multiplier || 0);

    batchTotals.set(key, current);

}

function calculateRequirementCost(requirement) {

    const ingredient =
        data.ingredients.find(item =>
            String(item.id) ===
            String(requirement.ingredientId)
        );

    if (!ingredient) return 0;

    const purchaseSizeInRecipeUnits =
        convert(
            ingredient.purchase_size,
            ingredient.purchase_unit,
            ingredient.recipe_unit
        );

    if (
        purchaseSizeInRecipeUnits === null ||
        purchaseSizeInRecipeUnits <= 0
    ) {
        return 0;
    }

    const costPerRecipeUnit =
        Number(
            ingredient.purchase_price || 0
        ) /
        purchaseSizeInRecipeUnits;

    return (
        costPerRecipeUnit *
        Number(requirement.required || 0)
    );

}
function addReq(map,ing,qty,source){const k=String(ing.id),x=map.get(k)||{ingredientId:ing.id,name:ing.name,source,recipeUnit:ing.recipe_unit,purchaseUnit:ing.purchase_unit,onHandPurchase:Number(ing.quantity_on_hand||0),minimumPurchase:Number(ing.minimum_quantity||0),required:0};x.required+=qty;map.set(k,x);}
function combine(items){const m=new Map();items.forEach(x=>{const k=String(x.ingredientId),v=m.get(k)||{...x,required:0,sources:[]};v.required+=x.required;if(!v.sources.includes(x.source))v.sources.push(x.source);m.set(k,v);});return[...m.values()].map(finalize).sort(sortName);}
function finalize(x){const have=convert(x.onHandPurchase,x.purchaseUnit,x.recipeUnit),min=convert(x.minimumPurchase,x.purchaseUnit,x.recipeUnit),ok=have!==null,safe=ok?have:0,shortage=Math.max(x.required-safe,0),remaining=safe-x.required;let status="good";if(!ok)status="unknown";else if(shortage>0)status="short";else if(min!==null&&remaining<=min)status="low";return{...x,have:safe,minimum:min||0,shortage,remaining,convertible:ok,status};}

function renderAll(){renderSubtitle();renderRun();renderWarnings();setText("productionOrderCount",plan.orderCount);setText("productionItemCount",fmt(plan.itemCount));setText("productionRevenue",euro(plan.revenue));setText("productionProfit",euro(plan.profit));setText("productionShortageCount",plan.shortages.length);renderProducts();renderBatches();renderCosts();renderIngredients();renderShopping();renderPackaging();renderChecklist();renderTimeline();renderOrders();}
function renderSubtitle(){const d=parseDate(plan.date),el=document.getElementById("productionSubtitle");if(el)el.textContent=d?`Production plan for ${d.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}.`:"Select a date.";}
function renderRun(){document.getElementById("productionCompletedBanner")?.remove();const done=!!data.run?.inventory_deducted,btn=document.getElementById("finishProductionBtn");if(btn){btn.disabled=done;btn.textContent=done?"Production Completed":"Finish Production";}if(done){const b=document.createElement("div");b.id="productionCompletedBanner";b.className="production-completed-banner";b.textContent="Production is complete and inventory has already been deducted for this date.";document.querySelector(".production-kpi-grid")?.before(b);}}
function renderWarnings(){const el=document.getElementById("productionWarnings"),messages=[];if(!plan.orders.length)messages.push(["info","No pending, confirmed, or ready orders are scheduled for this date."]);plan.warnings.forEach(x=>messages.push(["warning",x]));plan.combined.filter(x=>!x.convertible).forEach(x=>messages.push(["warning",`${x.name}: ${x.purchaseUnit} cannot be converted to ${x.recipeUnit}. Correct its inventory units before finishing production.`]));if(plan.orders.length&&!plan.shortages.length&&!plan.warnings.length)messages.push(["success","All links are complete and inventory covers every calculated requirement."]);el.innerHTML=messages.map(([t,x])=>`<div class="production-warning production-warning-${t}">${esc(x)}</div>`).join("");}
function renderProducts(){const el=document.getElementById("productionTotals");el.innerHTML=plan.products.length?`<div class="production-total-grid">${plan.products.map(x=>`<article class="production-total-card"><div><h3>${esc(x.name)}</h3><small>${esc(x.category)} · ${euro(x.revenue)}</small></div><strong>${fmt(x.quantity)}</strong></article>`).join("")}</div>`:empty("No products scheduled.");}
function renderBatches(){const el=document.getElementById("recipeBatches");el.innerHTML=plan.batches.length?plan.batches.map(x=>`<article class="production-batch-card"><div class="production-batch-top"><div><h3>${esc(x.name)}</h3><p>Produces ${fmt(x.recipeUnits)} ${esc(x.yieldUnit)} from a ${fmt(x.yieldQuantity)} ${esc(x.yieldUnit)} base yield.</p></div><span class="production-batch-amount">${fmt(x.batches)}×</span></div>${x.notes?`<p>${esc(x.notes)}</p>`:""}</article>`).join(""):empty("No linked recipes for this date.");}
function renderCosts(){document.getElementById("productionCosts").innerHTML=`<div class="production-metric-list">${metric("Expected Revenue",euro(plan.revenue))}${metric("Ingredient Cost",euro(plan.foodCost))}${metric("Packaging Cost",euro(plan.packagingCost))}${metric("Total Estimated Cost",euro(plan.totalCost))}${metric("Estimated Profit",euro(plan.profit))}${metric("Estimated Margin",`${plan.margin.toFixed(1)}%`)}</div>`;}
function renderIngredients(){const el=document.getElementById("ingredientRequirements"),badge=document.getElementById("ingredientStatusBadge"),rows=plan.combined.filter(x=>x.sources.includes("ingredient"));if(!rows.length){el.innerHTML=empty("No ingredient requirements calculated.");badge.textContent="No data";return;}badge.textContent=rows.some(x=>x.status==="short")?"Shopping required":"Inventory covered";el.innerHTML=`<div class="production-list">${rows.map(reqRow).join("")}</div>`;}
function reqRow(x){const label={good:"Enough",low:"Low after bake",short:"Short",unknown:"Check units"}[x.status],cls=x.status==="short"?"production-stock-short":x.status==="low"||x.status==="unknown"?"production-stock-low":"production-stock-good";return`<div class="production-row"><div><strong>${esc(x.name)}</strong><small>Stock unit: ${esc(x.purchaseUnit)}</small></div><div class="production-row-value"><small>Need</small><strong>${displayQty(x.required,x.recipeUnit)}</strong></div><div class="production-row-value"><small>Have</small><strong>${x.convertible?displayQty(x.have,x.recipeUnit):"Unknown"}</strong></div><span class="production-stock-status ${cls}">${label}</span></div>`;}
function renderShopping(){const el=document.getElementById("shoppingList");el.innerHTML=plan.shortages.length?plan.shortages.map(x=>`<div class="production-shopping-row"><label><input type="checkbox"><span>${esc(x.name)}</span></label><strong>Buy ${displayQty(x.shortage,x.recipeUnit)}</strong></div>`).join(""):empty("Nothing needs to be purchased for this date.");}
function renderPackaging(){const el=document.getElementById("packagingRequirements"),map=new Map(plan.combined.map(x=>[String(x.ingredientId),x]));el.innerHTML=plan.packagingReq.length?plan.packagingReq.map(x=>{const f=map.get(String(x.ingredientId)),cls=f?.status==="short"?"production-stock-short":f?.status==="low"?"production-stock-low":"production-stock-good",label=f?.status==="short"?"Short":f?.status==="low"?"Low after bake":"Enough";return`<div class="production-shopping-row"><span>${esc(x.name)}</span><strong>${displayQty(x.required,x.recipeUnit)}</strong>${f?`<span class="production-stock-status ${cls}">${label}</span>`:""}</div>`;}).join(""):empty("No packaging requirements calculated.");}
function renderChecklist(){const saved=data.run?.checklist||{};document.getElementById("productionChecklist").innerHTML=`<div class="production-checklist">${CHECKLIST.map((x,i)=>`<label class="production-check-item ${saved[i]?"is-complete":""}"><input type="checkbox" ${saved[i]?"checked":""} onchange="updateChecklistItem(${i},this.checked,this)"><span>${esc(x)}</span></label>`).join("")}</div>`;}

function renderTimeline() {

    const pickupDate = parseDate(plan.date);

    if (!pickupDate) {

        document.getElementById("productionTimeline").innerHTML =
            empty("Select a production date.");

        return;

    }

    const shopDay = new Date(pickupDate);
    shopDay.setDate(shopDay.getDate() - 3);

    const doughDay = new Date(pickupDate);
    doughDay.setDate(doughDay.getDate() - 2);

    const bakeDay = new Date(pickupDate);
    bakeDay.setDate(bakeDay.getDate() - 1);

    const stages = [

        [
            day(shopDay),
            "Shop for ingredients, packaging, and any missing inventory."
        ],

        [
            day(doughDay),
            "Feed starter, scale ingredients, prepare inclusions, mix dough, complete folds, bulk proof on the counter, then refrigerate overnight."
        ],

        [
            day(bakeDay),
            "Divide and shape dough, bake all products, cool completely, and prepare for pickup."
        ],

        [
            day(pickupDate),
            "Package, label, perform final quality check, and complete customer pickups."
        ]

    ];

    document.getElementById("productionTimeline").innerHTML = `
        <div class="production-timeline">
            ${stages.map(([title, text]) => `
                <div class="production-timeline-item">
                    <strong>${esc(title)}</strong>
                    <p>${esc(text)}</p>
                </div>
            `).join("")}
        </div>
    `;

}


function renderOrders(){const el=document.getElementById("includedOrders");el.innerHTML=plan.orders.length?plan.orders.map(o=>`<article class="production-order-card"><div class="production-order-header"><div><h3>${esc(o.customer_name)}</h3><small>${cap(o.status)} · ${o.order_type==="custom"?"Custom Order":"Weekly Pickup"}</small></div><strong>${euro(o.subtotal)}</strong></div><div class="production-order-items">${(o.order_items||[]).map(i=>`<div class="production-order-item"><span>${esc(i.item_name)}</span><strong>${i.quantity}×</strong></div>`).join("")}</div>${o.notes?`<p><strong>Notes:</strong> ${esc(o.notes)}</p>`:""}</article>`).join(""):empty("No active orders are included.");}

async function updateChecklistItem(i,checked,input){input?.closest(".production-check-item")?.classList.toggle("is-complete",checked);const checklist={...(data.run?.checklist||{}),[i]:checked};const {data:run,error}=await supabaseClient.from("production_runs").upsert({production_date:selectedDate(),checklist,status:checked?"in_progress":data.run?.status||"planned",updated_at:new Date().toISOString()},{onConflict:"production_date"}).select().single();if(error){console.error(error);alert("Checklist could not be saved. Run production-setup.sql first.");return;}data.run=run;}
async function finishProduction(){if(!plan.orders.length){alert("There are no active orders to finish for this date.");return;}if(data.run?.inventory_deducted){alert("Inventory has already been deducted for this date.");return;}if(plan.combined.some(x=>!x.convertible)){alert("Correct incompatible inventory units before finishing production.");return;}if(!confirm("Finish production and deduct all calculated ingredient and packaging quantities from inventory?\n\nThis can only run once for this date."))return;const deductions=plan.combined.map(x=>({ingredient_id:x.ingredientId,quantity_purchase_units:convert(x.required,x.recipeUnit,x.purchaseUnit)||0}));const snapshot={generated_at:new Date().toISOString(),production_date:plan.date,order_ids:plan.orders.map(x=>x.id),products:plan.products,recipes:plan.batches,requirements:plan.combined,revenue:plan.revenue,food_cost:plan.foodCost,packaging_cost:plan.packagingCost,profit:plan.profit};const {data:run,error}=await supabaseClient.rpc("complete_production",{p_production_date:plan.date,p_snapshot:snapshot,p_deductions:deductions});if(error){console.error(error);alert(error.message);return;}data.run=run;await loadReferenceData();await loadSelectedDate();}

function setDefaultDate(){document.getElementById("productionDate").value=dateValue(nextSunday(new Date()));}
function changeProductionDate(){loadSelectedDate();}
function moveProductionDate(n){const d=parseDate(selectedDate())||new Date();d.setDate(d.getDate()+n);document.getElementById("productionDate").value=dateValue(d);loadSelectedDate();}
function selectToday(){document.getElementById("productionDate").value=dateValue(new Date());loadSelectedDate();}
function selectActiveDate(){const v=document.getElementById("activeDateSelect").value;if(v){document.getElementById("productionDate").value=v;loadSelectedDate();}}
function populateDates(orders){const dates=[...new Set(orders.map(x=>x.pickup_date).filter(Boolean))].sort();document.getElementById("activeDateSelect").innerHTML=`<option value="">Upcoming order dates</option>${dates.map(x=>`<option value="${x}">${parseDate(x)?.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})||x}</option>`).join("")}`;}
async function refreshProduction(){await loadReferenceData();await loadSelectedDate();}

function convert(q,from,to){const a=Number(q||0),f=unit(from),t=unit(to);if(f===t)return a;if(MASS[f]&&MASS[t])return a*MASS[f]/MASS[t];if(VOLUME[f]&&VOLUME[t])return a*VOLUME[f]/VOLUME[t];if(COUNT.includes(f)&&COUNT.includes(t))return a;return null;}


function displayQty(quantity, unit) {

    return `${fmt(quantity)} ${esc(unit || "")}`.trim();

}


function unit(x){return String(x||"").trim().toLowerCase().replace(/\./g,"").replace(/\s+/g," ");}
function emptyPlan(){return{date:"",orders:[],products:[],batches:[],ingredientReq:[],packagingReq:[],combined:[],shortages:[],warnings:[],orderCount:0,itemCount:0,revenue:0,foodCost:0,packagingCost:0,totalCost:0,profit:0,margin:0};}
function loading(){["productionTotals","recipeBatches","productionCosts","ingredientRequirements","shoppingList","packagingRequirements","productionChecklist","productionTimeline","includedOrders"].forEach(id=>{const e=document.getElementById(id);if(e)e.innerHTML=empty("Loading...");});}
function fatal(x){document.getElementById("productionWarnings").innerHTML=`<div class="production-warning production-warning-error">Unable to load production: ${esc(x)}</div>`;}
function metric(a,b){return`<div class="production-metric"><span>${esc(a)}</span><strong>${esc(b)}</strong></div>`;}
function empty(x){return`<p class="production-empty">${esc(x)}</p>`;}
function euro(x){return new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"}).format(Number(x||0));}
function fmt(x){return Number(x||0).toFixed(2).replace(/\.00$/,"").replace(/(\.\d)0$/,"$1");}
function selectedDate(){return document.getElementById("productionDate")?.value||"";}
function nextSunday(d){const x=new Date(d);x.setDate(x.getDate()+(7-x.getDay())%7);return x;}
function parseDate(v){if(!v)return null;const [y,m,d]=String(v).split("-").map(Number);return y&&m&&d?new Date(y,m-1,d):null;}
function dateValue(d){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function day(d){return d.toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"});}
function sortName(a,b){return a.name.localeCompare(b.name);}
function cap(x){x=String(x||"");return x?x[0].toUpperCase()+x.slice(1):"";}
function setText(id,x){const e=document.getElementById(id);if(e)e.textContent=x;}
function esc(x){return String(x??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
window.changeProductionDate=changeProductionDate;window.moveProductionDate=moveProductionDate;window.selectToday=selectToday;window.selectActiveDate=selectActiveDate;window.refreshProduction=refreshProduction;window.updateChecklistItem=updateChecklistItem;window.finishProduction=finishProduction;
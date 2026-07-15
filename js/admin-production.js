/* ADMIN PRODUCTION */
const CHECKLIST=["Review included orders","Feed starter","Scale ingredients","Mix dough and batters","Complete folds / development","Prepare inclusions","Divide and shape","Cold proof / chill","Bake","Cool completely","Package and label","Mark orders ready"];
const MASS={g:1,gram:1,grams:1,kg:1000,kilogram:1000,kilograms:1000,oz:28.3495,ounce:28.3495,ounces:28.3495,lb:453.592,lbs:453.592,pound:453.592,pounds:453.592};
const VOLUME={ml:1,milliliter:1,milliliters:1,l:1000,liter:1000,liters:1000,tsp:4.92892,teaspoon:4.92892,teaspoons:4.92892,tbsp:14.7868,tablespoon:14.7868,tablespoons:14.7868,cup:236.588,cups:236.588,"fl oz":29.5735,floz:29.5735};
const COUNT=["each","item","items","count","piece","pieces","unit","units"];
let data={orders:[],menu:[],recipes:[],recipeIngredients:[],ingredients:[],packagingItems:[],recipeCosts:[],packagingCosts:[],run:null};
let plan=emptyPlan();

document.addEventListener("DOMContentLoaded",async()=>{await requireAuth();if(typeof setupLogout==="function")setupLogout();setDefaultDate();await loadReferenceData();await loadSelectedDate();});

async function loadReferenceData(){
 const results=await Promise.all([
  supabaseClient.from("menu_items").select("*"),
  supabaseClient.from("recipes").select("*"),
  supabaseClient.from("recipe_ingredients").select("*"),
  supabaseClient.from("ingredients").select("*").order("name"),
  supabaseClient.from("packaging_profile_items").select("*"),
  supabaseClient.from("recipe_costs").select("*"),
  supabaseClient.from("packaging_profile_costs").select("*"),
  supabaseClient.from("orders").select("pickup_date,status").in("status",["pending","confirmed","ready"]).order("pickup_date")
 ]);
 const failed=results.find(r=>r.error);if(failed){console.error(failed.error);fatal(failed.error.message);return;}
 [data.menu,data.recipes,data.recipeIngredients,data.ingredients,data.packagingItems,data.recipeCosts,data.packagingCosts]=results.slice(0,7).map(r=>r.data||[]);
 populateDates(results[7].data||[]);
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

function buildPlan(){
 const menuMap=new Map(data.menu.map(x=>[String(x.id),x]));
 const recipeMap=new Map(data.recipes.map(x=>[String(x.id),x]));
 const ingredientMap=new Map(data.ingredients.map(x=>[String(x.id),x]));
 const recipeCostMap=new Map(data.recipeCosts.map(x=>[String(x.id),x]));
 const packagingCostMap=new Map(data.packagingCosts.map(x=>[String(x.id),x]));
 const products=new Map(),batches=new Map(),ingredients=new Map(),packaging=new Map(),warnings=[];
 let itemCount=0,revenue=0,foodCost=0,packagingCost=0;
 data.orders.forEach(order=>{
  revenue+=Number(order.subtotal||0);
  (order.order_items||[]).forEach(oi=>{
   const qty=Number(oi.quantity||0);itemCount+=qty;
   const mi=menuMap.get(String(oi.menu_item_id));const key=String(oi.menu_item_id||oi.item_name);
   const prod=products.get(key)||{name:oi.item_name||mi?.name||"Unknown",quantity:0,revenue:0,category:mi?.category||"Unassigned"};prod.quantity+=qty;prod.revenue+=Number(oi.line_total||0);products.set(key,prod);
   if(!mi){warnings.push(`${oi.item_name} is not linked to a current menu item.`);return;}
   const recipeUnits=qty*Number(mi.recipe_units_used||1);const recipe=recipeMap.get(String(mi.recipe_id));
   if(!recipe)warnings.push(`${mi.name} does not have a recipe assigned.`);else{
    const yieldQty=Number(recipe.yield_quantity||1),multiplier=recipeUnits/yieldQty;
    const batch=batches.get(String(recipe.id))||{id:recipe.id,name:recipe.name,notes:recipe.notes||"",yieldQuantity:yieldQty,yieldUnit:recipe.yield_unit||"items",recipeUnits:0,batches:0};batch.recipeUnits+=recipeUnits;batch.batches+=multiplier;batches.set(String(recipe.id),batch);
    data.recipeIngredients.filter(x=>String(x.recipe_id)===String(recipe.id)).forEach(ri=>{const ing=ingredientMap.get(String(ri.ingredient_id));if(ing)addReq(ingredients,ing,Number(ri.quantity||0)*multiplier,"ingredient");});
    foodCost+=Number(recipeCostMap.get(String(recipe.id))?.cost_per_yield_item||0)*recipeUnits;
   }
   if(!mi.packaging_profile_id)warnings.push(`${mi.name} does not have a packaging profile assigned.`);else{
    data.packagingItems.filter(x=>String(x.profile_id)===String(mi.packaging_profile_id)).forEach(pi=>{const ing=ingredientMap.get(String(pi.ingredient_id));if(ing)addReq(packaging,ing,Number(pi.quantity||0)*qty,"packaging");});
    packagingCost+=Number(packagingCostMap.get(String(mi.packaging_profile_id))?.packaging_cost||0)*qty;
   }
  });
 });
 const combined=combine([...ingredients.values(),...packaging.values()]);const shortages=combined.filter(x=>x.shortage>0);const profit=revenue-foodCost-packagingCost;
 return{date:selectedDate(),orders:data.orders,products:[...products.values()].sort((a,b)=>b.quantity-a.quantity),batches:[...batches.values()].sort((a,b)=>a.name.localeCompare(b.name)),ingredientReq:[...ingredients.values()].sort(sortName),packagingReq:[...packaging.values()].sort(sortName),combined,shortages,warnings:[...new Set(warnings)],orderCount:data.orders.length,itemCount,revenue,foodCost,packagingCost,totalCost:foodCost+packagingCost,profit,margin:revenue?profit/revenue*100:0};
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
function renderTimeline(){const d=parseDate(plan.date);if(!d){document.getElementById("productionTimeline").innerHTML=empty("Select a valid date.");return;}const d1=new Date(d),d2=new Date(d);d1.setDate(d1.getDate()-1);d2.setDate(d2.getDate()-2);const stages=[[day(d2),"Review orders, inventory, packaging, and shortages. Feed or strengthen starter."],[day(d1),"Scale ingredients, prepare inclusions, mix, bulk ferment, shape, and begin cold proofing."],[day(d),"Bake, cool, package, label, quality-check, and mark orders ready."]];document.getElementById("productionTimeline").innerHTML=`<div class="production-timeline">${stages.map(([a,b])=>`<div class="production-timeline-item"><strong>${esc(a)}</strong><p>${esc(b)}</p></div>`).join("")}</div>`;}
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
function displayQty(q,u){const a=Number(q||0),n=unit(u);if(MASS[n]===1&&a>=1000)return`${fmt(a/1000)} kg`;if(VOLUME[n]===1&&a>=1000)return`${fmt(a/1000)} L`;return`${fmt(a)} ${esc(u||"")}`.trim();}
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

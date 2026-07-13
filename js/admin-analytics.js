/* ADMIN ANALYTICS */
let analyticsOrders=[];
let currentAnalyticsRange='all';
let ordersChart=null;
let popularityChart=null;

document.addEventListener('DOMContentLoaded',async()=>{
  await requireAuth();
  if(typeof setupLogout==='function') setupLogout();
  try{
    await ensureChartJs();
    bindAnalyticsFilters();
    await loadAnalytics();
  }catch(error){console.error('Analytics failed to initialize:',error);}
});

function ensureChartJs(){
  if(window.Chart) return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const existing=document.querySelector('script[src*="chart.js"]');
    if(existing){existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',reject,{once:true});return;}
    const script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/chart.js';
    script.onload=resolve;
    script.onerror=()=>reject(new Error('Chart.js could not be loaded.'));
    document.head.appendChild(script);
  });
}

function bindAnalyticsFilters(){
  const buttons=document.querySelectorAll('.analytics-filters .filter-btn,.analytics-filters button,.analytics-filter-btn');
  buttons.forEach(button=>button.addEventListener('click',()=>{
    buttons.forEach(item=>item.classList.remove('active'));
    button.classList.add('active');
    currentAnalyticsRange=normalizeAnalyticsRange(button.textContent);
    renderAnalytics();
  }));
}

async function loadAnalytics(){
  const {data,error}=await supabaseClient.from('orders').select(`*,order_items(*)`).order('created_at',{ascending:false});
  if(error){console.error('Unable to load analytics:',error);showAnalyticsError('Unable to load analytics data.');return;}
  analyticsOrders=(data||[]).map(order=>({...order,subtotal:Number(order.subtotal)||0,order_items:Array.isArray(order.order_items)?order.order_items:[]}));
  renderAnalytics();
}

function renderAnalytics(){
  const completed=analyticsOrders.filter(order=>order.status==='completed');
  const filtered=filterOrdersByRange(completed,currentAnalyticsRange);
  updateOverview(filtered);
  renderOrdersOverTime(filtered);
  renderProductPopularity(filtered);
  renderProductRankings(filtered);
  renderCustomerInsights(filtered);
  renderPickupTrends(filtered);
  renderBakeryInsights(filtered);
  renderTopCustomers(filtered);
  renderProductBreakdown(filtered);
}

function updateOverview(orders){
  const customerKeys=new Set(orders.map(getCustomerKey).filter(Boolean));
  const totalItems=orders.reduce((sum,order)=>sum+order.order_items.reduce((s,item)=>s+Number(item.quantity||0),0),0);
  setText('totalCustomers',customerKeys.size);
  setText('returningCustomers',getReturningCustomers(orders));
  setText('itemsSold',totalItems);
  setText('averageItems',orders.length?(totalItems/orders.length).toFixed(1):'0');
}

function renderOrdersOverTime(orders){
  const container=findElement(['ordersOverTime','ordersOverTimeChart','orderTrend','ordersChart']);
  if(!container||!window.Chart) return;
  const canvas=prepareCanvas(container,'ordersOverTimeCanvas');
  const grouped=new Map();
  orders.forEach(order=>{const date=new Date(order.created_at);const key=date.toISOString().split('T')[0];if(!grouped.has(key)) grouped.set(key,{label:date.toLocaleDateString('en-US',{month:'short',day:'numeric'}),count:0});grouped.get(key).count+=1;});
  const points=[...grouped.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([,v])=>v);
  if(ordersChart) ordersChart.destroy();
  ordersChart=new Chart(canvas,{type:'line',data:{labels:points.length?points.map(p=>p.label):['No completed orders'],datasets:[{label:'Orders',data:points.length?points.map(p=>p.count):[0],borderWidth:2,tension:.3,fill:false}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true,ticks:{precision:0}}},plugins:{legend:{display:false}}}});
}

function renderProductPopularity(orders){
  const container=findElement(['productPopularity','productPopularityChart','popularityChart']);
  if(!container||!window.Chart) return;
  const entries=Object.entries(getProductTotals(orders)).sort((a,b)=>b[1]-a[1]).slice(0,8);
  if(!entries.length){container.innerHTML='<p>No completed orders yet.</p>';return;}
  const canvas=prepareCanvas(container,'productPopularityCanvas');
  if(popularityChart) popularityChart.destroy();
  popularityChart=new Chart(canvas,{type:'doughnut',data:{labels:entries.map(([n])=>n),datasets:[{data:entries.map(([,q])=>q),borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'},tooltip:{callbacks:{label:c=>`${c.label}: ${c.parsed} sold`}}}}});
}

function renderProductRankings(orders){
  const container=document.getElementById('productRankings');if(!container)return;
  const ranking=Object.entries(getProductTotals(orders)).sort((a,b)=>b[1]-a[1]);
  if(!ranking.length){container.innerHTML='<p>No completed orders yet.</p>';return;}
  container.innerHTML=ranking.slice(0,10).map(([name,qty],i)=>`<div class="ranking-row"><strong>${i+1}. ${escapeHtml(name)}</strong><span>${qty} sold</span></div>`).join('');
}

function renderCustomerInsights(orders){
  const container=document.getElementById('customerInsights');if(!container)return;
  const customerKeys=new Set(orders.map(getCustomerKey).filter(Boolean));
  const returning=getReturningCustomers(orders);
  const repeatRate=customerKeys.size?Math.round(returning/customerKeys.size*100):0;
  const totalRevenue=sumRevenue(orders);
  const averageOrder=orders.length?totalRevenue/orders.length:0;
  container.innerHTML=`<div class="analytics-stat-list"><p>Total Customers <strong>${customerKeys.size}</strong></p><p>Returning Customers <strong>${returning}</strong></p><p>Repeat Rate <strong>${repeatRate}%</strong></p><p>Average Order <strong>${euro(averageOrder)}</strong></p></div>`;
}

function renderPickupTrends(orders){
  const container=document.getElementById('pickupTrends');if(!container)return;
  const weekly=orders.filter(o=>o.order_type==='weekly').length;
  const custom=orders.filter(o=>o.order_type==='custom').length;
  container.innerHTML=`<div class="analytics-stat-list"><p>Weekly Pickup <strong>${weekly}</strong></p><p>Custom Orders <strong>${custom}</strong></p></div>`;
}

function renderBakeryInsights(orders){
  const container=document.getElementById('bakeryInsights');if(!container)return;
  if(!orders.length){container.innerHTML='<p>No completed orders yet.</p>';return;}
  const largest=[...orders].sort((a,b)=>b.subtotal-a.subtotal)[0];
  const totalRevenue=sumRevenue(orders);
  const averageOrder=totalRevenue/orders.length;
  const topProduct=getTopProduct(orders);
  container.innerHTML=`<div class="analytics-stat-list"><p>Largest Order <strong>${euro(largest.subtotal)}</strong></p><p>Average Order <strong>${euro(averageOrder)}</strong></p><p>Revenue <strong>${euro(totalRevenue)}</strong></p>${topProduct?`<p>Top Product <strong>${escapeHtml(topProduct.name)} (${topProduct.quantity})</strong></p>`:''}</div>`;
}

function renderTopCustomers(orders){
  const container=document.getElementById('topCustomers');if(!container)return;
  const totals={};
  orders.forEach(order=>{const key=getCustomerKey(order)||order.id;if(!totals[key]) totals[key]={name:order.customer_name||'Unknown Customer',total:0,orders:0,lastOrder:order.created_at};totals[key].total+=Number(order.subtotal||0);totals[key].orders+=1;if(new Date(order.created_at)>new Date(totals[key].lastOrder)) totals[key].lastOrder=order.created_at;});
  const customers=Object.values(totals).sort((a,b)=>b.total-a.total).slice(0,5);
  if(!customers.length){container.innerHTML='<p>No customers yet.</p>';return;}
  container.innerHTML=customers.map((customer,index)=>{const medal=index===0?'🥇':index===1?'🥈':index===2?'🥉':'';const average=customer.total/customer.orders;return `<div class="customer-card"><div class="customer-header"><strong>${medal} ${escapeHtml(customer.name)}</strong><span>${euro(customer.total)}</span></div><div class="customer-details"><span>${customer.orders} order${customer.orders===1?'':'s'}</span><span>Avg ${euro(average)}</span><span>Last: ${formatDate(customer.lastOrder)}</span></div></div>`;}).join('');
}

function renderProductBreakdown(orders){
  const container=document.getElementById('productBreakdown');if(!container)return;
  const totals=getProductTotals(orders);const totalItems=Object.values(totals).reduce((s,q)=>s+q,0);const ranking=Object.entries(totals).sort((a,b)=>b[1]-a[1]);
  if(!ranking.length){container.innerHTML='<p>No completed orders yet.</p>';return;}
  container.innerHTML=ranking.map(([name,qty],i)=>{const share=totalItems?Math.round(qty/totalItems*100):0;return `<div class="ranking-row"><strong>${i+1}. ${escapeHtml(name)}</strong><span>${qty} sold · ${share}%</span></div>`;}).join('');
}

function filterOrdersByRange(orders,range){if(range==='all') return orders.slice();const now=new Date();return orders.filter(order=>{const date=new Date(order.created_at);const days=(now-date)/(1000*60*60*24);if(range==='30')return days<=30;if(range==='90')return days<=90;if(range==='year')return date.getFullYear()===now.getFullYear();return true;});}
function normalizeAnalyticsRange(text){const v=String(text||'').trim().toLowerCase();if(v.includes('30'))return'30';if(v.includes('90'))return'90';if(v.includes('year'))return'year';return'all';}
function getProductTotals(orders){const totals={};orders.forEach(order=>order.order_items.forEach(item=>{const name=item.item_name||'Unknown Item';totals[name]=(totals[name]||0)+Number(item.quantity||0);}));return totals;}
function getTopProduct(orders){const top=Object.entries(getProductTotals(orders)).sort((a,b)=>b[1]-a[1])[0];return top?{name:top[0],quantity:top[1]}:null;}
function getCustomerKey(order){const name=String(order.customer_name||'').trim().toLowerCase();const email=String(order.customer_email||'').trim().toLowerCase();const phone=String(order.customer_phone||'').replace(/\D/g,'');return name||email||phone||'';}
function getReturningCustomers(orders){const counts={};orders.forEach(order=>{const key=getCustomerKey(order);if(!key)return;counts[key]=(counts[key]||0)+1;});return Object.values(counts).filter(c=>c>1).length;}
function sumRevenue(orders){return orders.reduce((sum,order)=>sum+Number(order.subtotal||0),0);}
function findElement(ids){for(const id of ids){const el=document.getElementById(id);if(el)return el;}return null;}
function prepareCanvas(element,canvasId){if(element.tagName==='CANVAS'){const wrapper=element.parentElement;if(wrapper){wrapper.style.position='relative';wrapper.style.height='320px';wrapper.style.overflow='hidden';}return element;}element.innerHTML=`<div style="position:relative;height:320px;overflow:hidden;"><canvas id="${canvasId}"></canvas></div>`;return document.getElementById(canvasId);}
function setText(id,value){const el=document.getElementById(id);if(el)el.textContent=value;}
function euro(value){return new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(Number(value)||0);}
function formatDate(date){return new Date(date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}
function showAnalyticsError(message){['productRankings','customerInsights','pickupTrends','bakeryInsights','topCustomers','productBreakdown'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=`<p>${escapeHtml(message)}</p>`;});}
function escapeHtml(text){return String(text??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');}
window.loadAnalytics=loadAnalytics;
window.renderAnalytics=renderAnalytics;

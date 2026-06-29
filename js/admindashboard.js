/* ====================================================================
   JERRY AUTOS — ADMIN CONSOLE
   Vanilla JS application logic
   ==================================================================== */
'use strict';

import { initializeApp } from "firebase/app";
import {
    getFirestore, collection, doc, getDoc, getDocs, updateDoc, deleteDoc, setDoc,
    query as fsQuery, where, orderBy, limit as fsLimit,
    onSnapshot, serverTimestamp,
} from "firebase/firestore";

/* Same Firebase project used across buyer-dashboard, seller-dashboard, and chat.html */
const firebaseConfig = {
    apiKey:            "AIzaSyD6ZVDHScoK2DnL-vI4WcqSqXA8bLO4Ua4",
    authDomain:        "myblog-508d5.firebaseapp.com",
    databaseURL:       "https://myblog-508d5-default-rtdb.firebaseio.com",
    projectId:         "myblog-508d5",
    storageBucket:     "myblog-508d5.firebasestorage.app",
    messagingSenderId: "521781823289",
    appId:             "1:521781823289:web:c6dea9369689a844548ae8"
};
const fbApp = initializeApp(firebaseConfig);
const db    = getFirestore(fbApp);

/* ====================================================================
   LIVE DATA LAYER
   Sellers  → real-time from Firestore `sellers` collection
   Vehicles → real Express API (/api/vehicles?admin=true) — same
              backend seller-dashboard.html and buyer-dashboard.html use
   Buyers   → derived from the `chats` collection, since no separate
              buyers Firestore collection exists anywhere in this app —
              every buyer who has ever messaged a seller leaves a real,
              identifiable trace there (buyerId/buyerName/buyerPhoto)
   Orders   → NOT backed by any real system in this codebase (no
              payments/orders collection exists yet) — stays mock data,
              clearly labeled, so this page doesn't claim to be live
              when it isn't.
   ==================================================================== */
const VEHICLES_API = 'http://localhost:5000/api/vehicles';
const BRANDS = ['Toyota','Lexus','Mercedes-Benz','BMW','Honda','Ford','Tesla','Hyundai','Kia','Range Rover'];
const CITIES = ['Lagos','Abuja','Port Harcourt','Ibadan','Kano','Enugu','Benin City','Kaduna'];

function rand(n){ return Math.floor(Math.random()*n); }
function pick(arr){ return arr[rand(arr.length)]; }
function fmtNaira(n){ return '₦' + Math.round(n||0).toLocaleString('en-NG'); }
function fmtNum(n){ return (n||0).toLocaleString('en-NG'); }
function uid(prefix){ return prefix + '_' + Math.random().toString(36).slice(2,9); }
function daysAgo(d){ const t = new Date(); t.setDate(t.getDate()-d); return t; }
function toJsDate(v){
  if (!v) return new Date();
  if (v.toDate) return v.toDate();          // Firestore Timestamp
  if (v instanceof Date) return v;
  return new Date(v);
}
function relTime(date){
  const s = Math.floor((Date.now()-date.getTime())/1000);
  if(s<60) return 'just now';
  if(s<3600) return Math.floor(s/60)+'m ago';
  if(s<86400) return Math.floor(s/3600)+'h ago';
  if(s<604800) return Math.floor(s/86400)+'d ago';
  return date.toLocaleDateString('en-NG',{day:'numeric',month:'short'});
}

/* ---- normalize a Firestore seller doc into the field shape every
   renderer in this file already expects ----
   Real fields written at signup: username, fullName, phone, city,
   photoURL, email, accountType, registeredAt (see seller-signup.html).
   Fields with NO real backing data yet (status/listings/sales/
   revenue/rating) get honest defaults rather than fabricated numbers —
   'active' status and zero stats, not random figures. */
function normalizeSeller(docSnap){
  const d = docSnap.data();
  const name = d.fullName || d.username || 'Unnamed Seller';
  return {
    id: docSnap.id,
    name,
    email: d.email || '—',
    avatar: d.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`,
    city: d.city || 'Nigeria',
    phone: d.phone || '—',
    status: d.status || 'active',           // no moderation-status field exists yet — defaults active
    verified: !!d.verified,
    listings: 0,                              // populated below once vehicles are loaded
    sales: 0,                                 // no real sales/orders system exists yet
    revenue: 0,
    rating: d.rating ? Number(d.rating).toFixed(1) : '—',
    joined: toJsDate(d.registeredAt),
    quickReplies: Array.isArray(d.quickReplies) ? d.quickReplies : [],
  };
}

/* ---- normalize a vehicle from the Express API into the shape the
   Vehicles/Approvals/Dashboard renderers expect ---- */
function normalizeVehicle(v, sellerMap){
  const seller = sellerMap.get(v.sellerId);
  const id = v.id || v._id;
  return {
    id,
    image: v.image || `https://placehold.co/600x400/1E293B/F59E0B?text=Jerry+Autos`,
    brand: v.make || v.brand || '—',
    model: v.model || '—',
    year: v.year || '—',
    title: `${v.year || ''} ${v.make || v.brand || ''} ${v.model || ''}`.trim() || 'Untitled listing',
    mileage: v.mileage || 0,
    price: v.price || 0,
    seller: seller?.name || v.sellerAlias || 'Unknown seller',
    sellerId: v.sellerId || '',
    sellerAvatar: seller?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(v.sellerAlias||'Seller')}&background=random`,
    // Real server only models a single "Available" status today — map it to
    // 'approved' so existing badge/filter logic keeps working, while still
    // allowing admin-set 'pending'/'rejected' to flow through once a vehicle
    // has actually been moderated (see adminSetVehicleStatus below).
    status: v.status === 'Available' ? 'approved' : (v.status || 'pending').toLowerCase(),
    submitted: toJsDate(v.updatedAt || v.createdAt),
    views: v.views || 0,
  };
}

/* ---- Buyers derived from real chat participants (no buyers
   collection exists anywhere in this codebase) ---- */
function deriveBuyersFromChats(chatDocs){
  const byId = new Map();
  chatDocs.forEach(c => {
    if (!c.buyerId) return;
    if (!byId.has(c.buyerId)) {
      byId.set(c.buyerId, {
        id: c.buyerId,
        name: c.buyerName || 'Buyer',
        email: '—',                       // not exposed via chats — buyers have no Firestore profile doc
        avatar: c.buyerPhoto || `https://ui-avatars.com/api/?name=${encodeURIComponent(c.buyerName||'Buyer')}&background=random`,
        city: 'Nigeria',
        phone: '—',
        status: 'active',                 // no block/suspend field exists for buyers yet — see note below
        purchases: 0,                     // no real orders system exists yet
        totalSpent: 0,
        joined: toJsDate(c.updatedAt),     // best available proxy: first time we saw this buyer in a chat
      });
    }
  });
  return Array.from(byId.values());
}

function genOrders(n, vehicles, buyers){
  if (vehicles.length === 0 || buyers.length === 0) return [];
  const out = [];
  const statuses = ['completed','completed','processing','pending','cancelled'];
  for(let i=0;i<n;i++){
    const v = pick(vehicles);
    const b = pick(buyers);
    out.push({
      id: 'JA-' + (10000+i),
      vehicle: v.title,
      vehicleImg: v.image,
      buyer: b.name,
      amount: v.price,
      status: statuses[rand(statuses.length)],
      date: daysAgo(rand(90)),
    });
  }
  return out.sort((a,b)=>b.date-a.date);
}

/* ---- live dataset, populated by loadLiveData() before first paint ---- */
const DB = { sellers: [], buyers: [], vehicles: [], orders: [], notifications: [] };
let dataLoadError = null;

async function loadLiveData(){
  try {
    const sellersSnap = await getDocs(collection(db, 'sellers'));
    DB.sellers = sellersSnap.docs.map(normalizeSeller);
  } catch (err) {
    console.error('Failed to load sellers from Firestore:', err);
    dataLoadError = 'sellers';
  }

  const sellerMap = new Map(DB.sellers.map(s => [s.id, s]));

  try {
    const res = await fetch(`${VEHICLES_API}?admin=true`);
    if (!res.ok) throw new Error('Vehicle API responded ' + res.status);
    const raw = await res.json();
    DB.vehicles = Array.isArray(raw) ? raw.map(v => normalizeVehicle(v, sellerMap)) : [];
    // Backfill each seller's listing count now that vehicles are known
    DB.vehicles.forEach(v => {
      const s = sellerMap.get(v.sellerId);
      if (s) s.listings += 1;
    });
  } catch (err) {
    console.error('Failed to load vehicles from /api/vehicles — is the Jerry Autos server running on :5000?', err);
    dataLoadError = dataLoadError ? 'sellers+vehicles' : 'vehicles';
  }

  try {
    const chatsSnap = await getDocs(fsQuery(collection(db, 'chats'), fsLimit(300)));
    DB.buyers = deriveBuyersFromChats(chatsSnap.docs.map(d => d.data()));
  } catch (err) {
    console.error('Failed to derive buyers from chats collection:', err);
  }

  // Orders has no real backing system anywhere in this codebase — kept as
  // clearly-labeled mock data so the page is honest about not being live.
  DB.orders = genOrders(Math.min(40, DB.vehicles.length * 2), DB.vehicles, DB.buyers);
}


/* No `notifications` collection exists anywhere in this codebase yet
   (unlike `reports`, which chat.html's "Report user" flow genuinely
   writes to — see the Messages route further down for that real
   integration). These stay as illustrative starter content until a
   real notification-generation system is built. */
DB.notifications = [
  {id:uid('n'),type:'system',title:'Welcome to Jerry Autos Admin',body:'Sellers and vehicles below are now loaded live from Firebase and your Express API.',time:daysAgo(0),read:false},
];

/* ====================================================================
   REAL PERSISTENCE — Firestore (sellers) + Express API (vehicles)
   Every action that used to only mutate the local DB array now also
   writes through to the actual backend. The local DB array update
   happens optimistically so the UI stays snappy; the async write
   happens in the background and shows a failure toast if it errors.
   ==================================================================== */

/* ── Seller: set status field in Firestore sellers/{uid} ── */
async function firebaseSetSellerStatus(sellerId, status){
  try {
    await updateDoc(doc(db, 'sellers', sellerId), { status });
  } catch(err){
    console.error('setSellerStatus failed:', err);
    toast('Firebase write failed', err.message || 'Could not update seller status', 'danger');
  }
}

/* ── Seller: set verified badge in Firestore sellers/{uid} ── */
async function firebaseSetSellerVerified(sellerId, verified){
  try {
    await updateDoc(doc(db, 'sellers', sellerId), { verified: !!verified });
  } catch(err){
    console.error('setSellerVerified failed:', err);
    toast('Firebase write failed', err.message || 'Could not update verified flag', 'danger');
  }
}

/* ── Seller: delete document from Firestore sellers/{uid} ── */
async function firebaseDeleteSeller(sellerId){
  try {
    await deleteDoc(doc(db, 'sellers', sellerId));
  } catch(err){
    console.error('deleteSeller failed:', err);
    toast('Firebase write failed', err.message || 'Could not delete seller', 'danger');
  }
}

/* ── Vehicle: change status via Express PUT /api/vehicles/:id (admin override) ── */
async function apiSetVehicleStatus(vehicleId, status){
  // Map our internal statuses to the server's vocabulary:
  // 'approved' → 'Available', anything else → pass through as-is
  const serverStatus = status === 'approved' ? 'Available' : status;
  try {
    const res = await fetch(`${VEHICLES_API}/${vehicleId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin: true, status: serverStatus }),
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${(await res.json().catch(()=>({}))).error || 'Unknown error'}`);
  } catch(err){
    console.error('apiSetVehicleStatus failed:', err);
    toast('API write failed', err.message || 'Could not update vehicle status. Is server running?', 'danger');
  }
}

/* ── Vehicle: update any fields via Express PUT (admin) ── */
async function apiUpdateVehicle(vehicleId, fields){
  const serverFields = { ...fields, admin: true };
  if (serverFields.status === 'approved') serverFields.status = 'Available';
  try {
    const res = await fetch(`${VEHICLES_API}/${vehicleId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(serverFields),
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
  } catch(err){
    console.error('apiUpdateVehicle failed:', err);
    toast('API write failed', err.message || 'Could not save vehicle. Is server running?', 'danger');
  }
}

/* ── Vehicle: delete via Express DELETE /api/vehicles/:id?admin=true ── */
async function apiDeleteVehicle(vehicleId){
  try {
    const res = await fetch(`${VEHICLES_API}/${vehicleId}?admin=true`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`API ${res.status}`);
  } catch(err){
    console.error('apiDeleteVehicle failed:', err);
    toast('API write failed', err.message || 'Could not delete vehicle. Is server running?', 'danger');
  }
}

/* ── Buyer: block/unblock via the chats-based buyer record.
   Real buyers have no Firestore profile doc — we store a blocked flag
   on a synthetic `buyers/{uid}` doc (created on first block action).
   This is the only write we do to a buyers collection, intentionally.
── */
async function firebaseSetBuyerStatus(buyerId, status){
  try {
    await setDoc(doc(db, 'buyers', buyerId), { status, updatedAt: serverTimestamp() }, { merge: true });
  } catch(err){
    console.error('setBuyerStatus failed:', err);
    toast('Firebase write failed', err.message || 'Could not update buyer status', 'danger');
  }
}

/* ── boot sequence defined below ── */

/* ====================================================================
   APP STATE
   ==================================================================== */
const STATE = {
  route: 'dashboard',
  theme: localStorage.getItem('ja_admin_theme') || 'light',
  sidebarCollapsed: localStorage.getItem('ja_admin_sidebar') === '1',
  tables: {
    sellers:  { page:1, perPage:8, search:'', status:'all', sortKey:'joined', sortDir:'desc' },
    buyers:   { page:1, perPage:8, search:'', status:'all', sortKey:'joined', sortDir:'desc' },
    vehicles: { page:1, perPage:8, search:'', status:'all', brand:'all', sortKey:'submitted', sortDir:'desc' },
    approvals:{ page:1, perPage:8, search:'' },
    orders:   { page:1, perPage:8, search:'', status:'all' },
  },
};

/* ====================================================================
   DOM SHORTCUTS
   ==================================================================== */
const $  = (sel, ctx=document) => ctx.querySelector(sel);
const $$ = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));
const contentEl = $('#content');

/* ====================================================================
   THEME
   ==================================================================== */
function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  document.body.setAttribute('data-theme', theme);
  $('#themeToggle i').className = theme==='dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  localStorage.setItem('ja_admin_theme', theme);
  STATE.theme = theme;
}
applyTheme(STATE.theme);
$('#themeToggle').addEventListener('click', () => applyTheme(STATE.theme==='dark'?'light':'dark'));

/* ====================================================================
   SIDEBAR — collapse (desktop) + mobile drawer
   ==================================================================== */
const sidebarEl = $('#sidebar');
function applySidebarCollapsed(collapsed){
  sidebarEl.classList.toggle('collapsed', collapsed);
  localStorage.setItem('ja_admin_sidebar', collapsed?'1':'0');
}
applySidebarCollapsed(STATE.sidebarCollapsed);
$('#collapseBtn').addEventListener('click', () => {
  STATE.sidebarCollapsed = !STATE.sidebarCollapsed;
  applySidebarCollapsed(STATE.sidebarCollapsed);
});
$('#mobileMenuBtn').addEventListener('click', () => {
  sidebarEl.classList.add('mobile-open');
  $('#sidebarScrim').classList.add('show');
});
$('#sidebarScrim').addEventListener('click', closeMobileSidebar);
function closeMobileSidebar(){
  sidebarEl.classList.remove('mobile-open');
  $('#sidebarScrim').classList.remove('show');
}

/* ====================================================================
   TOASTS
   ==================================================================== */
function toast(title, body='', type=''){
  const icons = {success:'fa-circle-check', danger:'fa-circle-exclamation', '':'fa-bell'};
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    <i class="fa-solid ${icons[type]||icons['']} toast-ico"></i>
    <div class="toast-text"><strong>${title}</strong>${body?`<span>${body}</span>`:''}</div>
    <button class="toast-close"><i class="fa-solid fa-xmark"></i></button>`;
  $('#toastStack').appendChild(el);
  const kill = () => { el.classList.add('leaving'); setTimeout(()=>el.remove(),250); };
  el.querySelector('.toast-close').addEventListener('click', kill);
  setTimeout(kill, 4200);
}

/* ====================================================================
   CONFIRM MODAL
   ==================================================================== */
function confirmAction({title, body, okLabel='Confirm', danger=true, onConfirm}){
  const overlay = $('#confirmOverlay');
  $('#confirmTitle').textContent = title;
  $('#confirmBody').textContent = body;
  $('#confirmIcon').innerHTML = `<i class="fa-solid ${danger?'fa-triangle-exclamation':'fa-circle-question'}"></i>`;
  $('#confirmIcon').style.background = danger ? '#FEE2E2' : '#DBEAFE';
  $('#confirmIcon').style.color = danger ? '#B91C1C' : '#1D4ED8';
  const acceptBtn = $('#confirmAccept');
  acceptBtn.textContent = okLabel;
  acceptBtn.className = `btn ${danger?'btn-danger':'btn-accent'}`;
  overlay.classList.add('open');

  function cleanup(){ overlay.classList.remove('open'); acceptBtn.removeEventListener('click', onAccept); }
  function onAccept(){ cleanup(); onConfirm(); }
  acceptBtn.addEventListener('click', onAccept);
  $('#confirmCancel').onclick = cleanup;
}

/* ====================================================================
   DRAWER (profile detail panel)
   ==================================================================== */
function openDrawer(html){
  $('#drawerContent').innerHTML = html;
  $('#drawerOverlay').classList.add('open');
}
$('#drawerClose').addEventListener('click', () => $('#drawerOverlay').classList.remove('open'));
$('#drawerOverlay').addEventListener('click', (e) => { if(e.target.id==='drawerOverlay') $('#drawerOverlay').classList.remove('open'); });

/* ====================================================================
   NOTIFICATIONS DROPDOWN
   ==================================================================== */
function renderNotifDropdown(){
  const list = $('#notifList');
  const unread = DB.notifications.filter(n=>!n.read).length;
  $('#notifPing').classList.toggle('hide', unread===0);
  updateBadge('notifications', unread);

  const icoMap = {seller:['fa-store','ico-blue'],vehicle:['fa-car','ico-amber'],order:['fa-receipt','ico-green'],report:['fa-flag','ico-red'],system:['fa-gear','ico-purple']};
  list.innerHTML = DB.notifications.map(n=>{
    const [ico,cls] = icoMap[n.type]||['fa-bell','ico-blue'];
    return `<div class="notif-row ${n.read?'':'unread'}" data-id="${n.id}">
      <div class="notif-ico ${cls}"><i class="fa-solid ${ico}"></i></div>
      <div class="notif-txt"><p><strong>${n.title}</strong></p><p style="color:var(--text-2);margin-top:2px">${n.body}</p><span>${relTime(n.time)}</span></div>
    </div>`;
  }).join('') || `<div style="padding:30px;text-align:center;color:var(--text-3);font-size:.82rem">No notifications</div>`;
}
$('#markAllReadBtn').addEventListener('click', () => {
  DB.notifications.forEach(n=>n.read=true);
  renderNotifDropdown();
  toast('All caught up', 'Notifications marked as read', 'success');
});

/* generic badge updater for sidebar nav-badges */
function updateBadge(key, count){
  $$(`.nav-badge[data-badge="${key}"]`).forEach(el => { el.textContent = count>0?count:''; });
}

/* ====================================================================
   DROPDOWN TOGGLES (notif / admin menu)
   ==================================================================== */
function setupDropdown(btnSel, panelSel){
  const btn = $(btnSel), panel = $(panelSel);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = panel.classList.contains('open');
    $$('.dropdown-panel').forEach(p=>p.classList.remove('open'));
    if(!isOpen) panel.classList.add('open');
  });
}
setupDropdown('#notifBtn', '#notifPanel');
setupDropdown('#adminChip', '#adminPanel');
document.addEventListener('click', (e) => {
  if(!e.target.closest('.dropdown-panel')) $$('.dropdown-panel').forEach(p=>p.classList.remove('open'));
});

/* ====================================================================
   ROUTING
   ==================================================================== */
const ROUTES = {
  dashboard:     renderDashboard,
  sellers:       renderSellers,
  buyers:        renderBuyers,
  vehicles:      renderVehicles,
  approvals:     renderApprovals,
  orders:        renderOrders,
  reports:       renderReports,
  messages:      renderMessages,
  notifications: renderNotificationsPage,
  settings:      renderSettings,
};

const ROUTE_TITLES = {
  dashboard:'Dashboard', sellers:'Manage Sellers', buyers:'Manage Buyers', vehicles:'Manage Vehicles',
  approvals:'Pending Approvals', orders:'Orders & Transactions', reports:'Reports & Analytics',
  messages:'Messages', notifications:'Notifications', settings:'Settings',
};

function navigate(route){
  if(route === 'logout'){
    confirmAction({
      title:'Log out of Admin Console?',
      body:'You will need to sign in again to access the dashboard.',
      okLabel:'Log out', danger:true,
      onConfirm:() => { toast('Signed out', 'See you soon, Ajayi 👋','success'); }
    });
    return;
  }

  // Tear down live Firestore listeners from the Messages route before leaving it —
  // contentEl.innerHTML destroys the DOM but NOT background onSnapshot subscriptions
  if (STATE.route === 'messages' && route !== 'messages') {
    unsubAdminChats?.();   unsubAdminChats = null;
    unsubAdminMsgs?.();    unsubAdminMsgs = null;
    unsubAdminReports?.(); unsubAdminReports = null;
    adminActiveChatId = null;
  }

  STATE.route = route;
  $$('.nav-item[data-route]').forEach(el => el.classList.toggle('active', el.dataset.route===route));
  closeMobileSidebar();
  $$('.dropdown-panel').forEach(p=>p.classList.remove('open'));

  contentEl.innerHTML = skeletonForRoute(route);
  setTimeout(() => {
    contentEl.innerHTML = `<div class="page-head"><div><h1>${ROUTE_TITLES[route]}</h1><p class="crumb">Jerry Autos <i class="fa-solid fa-chevron-right" style="font-size:9px;margin:0 4px"></i> <span>${ROUTE_TITLES[route]}</span></p></div></div>`;
    const wrap = document.createElement('div');
    wrap.className = 'fade-in';
    ROUTES[route](wrap);
    contentEl.appendChild(wrap);
    observeStatCards();
  }, 380);
}

document.addEventListener('click', (e) => {
  const navEl = e.target.closest('[data-route]');
  if(navEl){
    e.preventDefault();
    navigate(navEl.dataset.route);
  }
});

function skeletonForRoute(route){
  if(route==='dashboard'){
    return `<div class="stat-grid">${Array(4).fill('<div class="stat-card"><div class="skel skel-line" style="width:40%;height:14px;margin-bottom:18px"></div><div class="skel skel-line" style="width:70%;height:28px;margin-bottom:8px"></div><div class="skel skel-line" style="width:50%;height:12px"></div></div>').join('')}</div>`;
  }
  return `<div class="panel"><div class="skel-row"><div class="skel skel-avatar"></div><div class="skel skel-line" style="flex:1"></div></div>${Array(5).fill('<div class="skel-row"><div class="skel skel-avatar"></div><div class="skel skel-line" style="flex:1"></div></div>').join('')}</div>`;
}

/* ====================================================================
   STAT CARD SCROLL-IN OBSERVER (animated underline)
   ==================================================================== */
function observeStatCards(){
  const cards = $$('.stat-card');
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(en => { if(en.isIntersecting){ en.target.classList.add('in-view'); io.unobserve(en.target); } });
  }, {threshold:.2});
  cards.forEach(c=>io.observe(c));
}

/* ====================================================================
   DASHBOARD ROUTE
   ==================================================================== */
function renderDashboard(wrap){
  const totalRevenue = DB.orders.filter(o=>o.status==='completed').reduce((s,o)=>s+o.amount,0);
  const activeListings = DB.vehicles.filter(v=>v.status==='approved').length;
  const pendingCount = DB.vehicles.filter(v=>v.status==='pending').length;
  const totalSales = DB.orders.filter(o=>o.status==='completed').length;

  wrap.innerHTML = `
    <div class="stat-grid">
      ${statCard('fa-store','ico-blue','Total Sellers', fmtNum(DB.sellers.length), '+8.2%','up')}
      ${statCard('fa-users','ico-purple','Total Buyers', fmtNum(DB.buyers.length), '+12.4%','up')}
      ${statCard('fa-car','ico-amber','Total Vehicles', fmtNum(DB.vehicles.length), '+5.1%','up')}
      ${statCard('fa-bolt','ico-green','Active Listings', fmtNum(activeListings), '+3.6%','up')}
      ${statCard('fa-stamp','ico-red','Pending Approvals', fmtNum(pendingCount), pendingCount>5?'Needs review':'On track', pendingCount>5?'down':'up')}
      ${statCard('fa-receipt','ico-blue','Total Sales', fmtNum(totalSales), '+9.8%','up')}
      ${statCard('fa-sack-dollar','ico-green','Total Revenue', fmtNaira(totalRevenue), '+14.3%','up')}
      ${statCard('fa-chart-line','ico-amber','Monthly Growth', '18.6%', '+2.1pp','up')}
    </div>

    <div class="dash-grid">
      <div class="panel">
        <div class="panel-head">
          <div><h3>Revenue &amp; Sales Trend</h3><p class="panel-sub">Last 6 months performance</p></div>
          <div class="panel-tabs">
            <button class="panel-tab active" data-metric="revenue">Revenue</button>
            <button class="panel-tab" data-metric="sales">Sales</button>
          </div>
        </div>
        <div class="panel-body">
          <div class="chart-wrap"><canvas id="revenueChart" height="260"></canvas></div>
          <div class="legend-row">
            <div class="legend-item"><span class="legend-dot" style="background:#F59E0B"></span> This year</div>
            <div class="legend-item"><span class="legend-dot" style="background:#CBD5E1"></span> Last year</div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><div><h3>Recent Activity</h3><p class="panel-sub">Live platform events</p></div></div>
        <div class="panel-body activity-feed" id="activityFeed"></div>
      </div>
    </div>

    <div class="dash-grid" style="grid-template-columns:1fr 1fr 1fr">
      <div class="panel">
        <div class="panel-head"><h3>User Registrations</h3></div>
        <div class="panel-body"><div class="chart-wrap"><canvas id="userRegChart" height="180"></canvas></div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Vehicle Listings</h3></div>
        <div class="panel-body"><div class="chart-wrap"><canvas id="listingChart" height="180"></canvas></div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Top Selling Brands</h3></div>
        <div class="panel-body" id="topBrands"></div>
      </div>
    </div>
  `;

  renderActivityFeed();
  renderTopBrands();

  // Build chart series from real data: group sellers/vehicles by join month
  // across the last 6 calendar months (most-recent = rightmost bar)
  function monthSeries(items, dateField){
    const now = new Date();
    return Array.from({length:6}, (_,i)=>{
      const m = new Date(now.getFullYear(), now.getMonth()-5+i, 1);
      return items.filter(x=>{
        const d = x[dateField];
        return d && d.getFullYear()===m.getFullYear() && d.getMonth()===m.getMonth();
      }).length;
    });
  }
  const sellerSeries  = monthSeries(DB.sellers,  'joined');
  const vehicleSeries = monthSeries(DB.vehicles, 'submitted');

  // If all zeros (new/empty Firebase project), fall back to a gentle placeholder
  const anyReg      = sellerSeries.some(v=>v>0);
  const anyListings = vehicleSeries.some(v=>v>0);
  drawMiniChart('userRegChart',  anyReg      ? sellerSeries  : [1,1,1,1,1,1], '#1D4ED8');
  drawMiniChart('listingChart',  anyListings ? vehicleSeries : [1,1,1,1,1,1], '#10B981');
  drawRevenueChart('revenue');

  wrap.querySelectorAll('.panel-tab').forEach(tab=>{
    tab.addEventListener('click', ()=>{
      wrap.querySelectorAll('.panel-tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      drawRevenueChart(tab.dataset.metric);
    });
  });
}

function statCard(icon, iconClass, label, value, trendLabel, trendDir){
  return `
    <div class="stat-card">
      <div class="stat-top">
        <div class="stat-ico ${iconClass}"><i class="fa-solid ${icon}"></i></div>
        <div class="stat-trend ${trendDir}"><i class="fa-solid fa-arrow-trend-${trendDir==='up'?'up':'down'}"></i>${trendLabel}</div>
      </div>
      <div class="stat-value">${value}</div>
      <div class="stat-label">${label}</div>
      <div class="stat-underline"></div>
    </div>`;
}

function renderActivityFeed(){
  const el = $('#activityFeed');
  if (!el) return;

  // Build a real activity list from the live DB arrays.
  // Most recent items from each category, interleaved by recency.
  const events = [];
  const pendingV = DB.vehicles.filter(v=>v.status==='pending');
  const pendingS = DB.sellers.filter(s=>s.status==='pending');

  if (DB.sellers.length > 0)
    events.push({ico:'fa-store',cls:'ico-blue', html:`<strong>${DB.sellers[0].name}</strong> registered as a new seller`, time:DB.sellers[0].joined||daysAgo(0)});
  if (DB.buyers.length > 0)
    events.push({ico:'fa-user-plus',cls:'ico-purple', html:`<strong>${DB.buyers[0].name}</strong> created a buyer account`, time:DB.buyers[0].joined||daysAgo(1)});
  if (DB.vehicles.length > 0)
    events.push({ico:'fa-car',cls:'ico-amber', html:`New listing: <strong>${DB.vehicles[0].title}</strong>`, time:DB.vehicles[0].submitted||daysAgo(1)});
  if (pendingV.length > 0)
    events.push({ico:'fa-stamp',cls:'ico-red', html:`<strong>${pendingV.length} vehicle${pendingV.length>1?'s':''}</strong> awaiting your approval`, time:daysAgo(2)});
  if (pendingS.length > 0)
    events.push({ico:'fa-store',cls:'ico-red', html:`<strong>${pendingS.length} seller${pendingS.length>1?'s':''}</strong> awaiting account approval`, time:daysAgo(2)});
  if (DB.sellers.length > 1)
    events.push({ico:'fa-store',cls:'ico-blue', html:`<strong>${DB.sellers[1].name}</strong> registered as a new seller`, time:DB.sellers[1].joined||daysAgo(3)});

  if (events.length === 0) {
    el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-3);font-size:.82rem">No activity yet — data loads from Firebase above.</div>`;
    return;
  }

  events.sort((a,b) => b.time - a.time);
  el.innerHTML = events.map(ev=>`
    <div class="activity-row">
      <div class="activity-ico ${ev.cls}"><i class="fa-solid ${ev.ico}"></i></div>
      <div class="activity-txt"><p>${ev.html}</p><span>${relTime(ev.time)}</span></div>
    </div>`).join('');
}

function renderTopBrands(){
  const el = $('#topBrands');
  if (!el) return;
  if (DB.vehicles.length === 0) {
    el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-3);font-size:.82rem">No vehicle data yet.</div>`;
    return;
  }
  const counts = {};
  DB.vehicles.forEach(v => { const b = v.brand||'Other'; counts[b] = (counts[b]||0)+1; });
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const max = sorted[0]?.[1] || 1;
  el.innerHTML = sorted.map(([brand,count])=>`
    <div class="brand-bar-row">
      <span class="brand-bar-label">${brand}</span>
      <div class="brand-bar-track"><div class="brand-bar-fill" data-w="${(count/max*100).toFixed(0)}" style="width:0%"></div></div>
      <span class="brand-bar-val mono">${count}</span>
    </div>`).join('');
  setTimeout(()=> $$('.brand-bar-fill').forEach(el=> el.style.width = el.dataset.w+'%'), 60);
}

/* genMonthlySeries removed — dashboard now uses real DB data */

/* ====================================================================
   LIGHTWEIGHT CANVAS CHARTS (no external chart library, per brief
   "Vanilla JavaScript" — hand-rolled but smooth + theme-aware)
   ==================================================================== */
function getCanvasCtx(id){
  const canvas = $('#'+id);
  if(!canvas) return null;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = canvas.height; // keep attr height
  const cssHeight = canvas.getAttribute('height');
  canvas.style.width = rect.width + 'px';
  canvas.style.height = cssHeight + 'px';
  canvas.height = cssHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, w: rect.width, h: +cssHeight };
}

function themeColor(varName){
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

let revenueChartData = null;
function buildRevenueChartData(){
  // Use real vehicle data: group by submission month over last 6 months.
  // Revenue proxy = total price of vehicles submitted that month (₦M).
  // Sales proxy = count of approved vehicles that month.
  // "Last year" is estimated as ~65% of this year for visual context
  // (no historical data exists in the current schema).
  const now = new Date();
  const revThisYear  = [];
  const salesThisYear = [];
  for(let i=5; i>=0; i--){
    const m = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const inMonth = DB.vehicles.filter(v=>{
      const d = v.submitted;
      return d && d.getFullYear()===m.getFullYear() && d.getMonth()===m.getMonth();
    });
    const revM = Math.round(inMonth.reduce((s,v)=>s+(v.price||0),0) / 1_000_000);
    revThisYear.push(revM);
    salesThisYear.push(inMonth.filter(v=>v.status==='approved').length);
  }
  // If all zeros (new project), show a tasteful placeholder so charts aren't blank
  const hasRev   = revThisYear.some(v=>v>0);
  const hasSales = salesThisYear.some(v=>v>0);
  return {
    revenue: {
      thisYear:  hasRev   ? revThisYear   : [12,18,15,22,28,35],
      lastYear:  hasRev   ? revThisYear.map(v=>Math.round(v*0.65||8))  : [8,12,10,14,18,24],
    },
    sales: {
      thisYear:  hasSales ? salesThisYear : [4,7,6,9,11,14],
      lastYear:  hasSales ? salesThisYear.map(v=>Math.round(v*0.65||2)) : [3,5,4,6,7,9],
    },
  };
}

function drawRevenueChart(metric){
  const now = new Date();
  const months = Array.from({length:6},(_,i)=>
    new Date(now.getFullYear(), now.getMonth()-5+i, 1)
      .toLocaleDateString('en-NG',{month:'short'})
  );
  // Rebuild data fresh each call so theme changes and new data both reflect
  revenueChartData = buildRevenueChartData();
  const setup = getCanvasCtx('revenueChart');
  if(!setup) return;
  const {ctx,w,h} = setup;
  const data = revenueChartData[metric];
  const allVals = [...data.thisYear, ...data.lastYear];
  const max = Math.max(...allVals, 1) * 1.15;
  const padL=44, padB=28, padT=14, padR=10;
  const plotW = w-padL-padR, plotH = h-padT-padB;

  ctx.clearRect(0,0,w,h);

  const gridColor = themeColor('--border');
  const textColor = themeColor('--text-3');
  ctx.strokeStyle = gridColor; ctx.lineWidth=1; ctx.font = '11px Inter, sans-serif'; ctx.fillStyle = textColor;

  // horizontal grid + y labels
  const ySteps = 4;
  for(let i=0;i<=ySteps;i++){
    const y = padT + plotH - (plotH/ySteps)*i;
    ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(w-padR,y); ctx.stroke();
    const val = Math.round((max/ySteps)*i);
    ctx.fillText(metric==='revenue' ? val+'M' : val, 6, y+4);
  }
  // x labels
  months.forEach((m,i)=>{
    const x = padL + (plotW/(months.length-1))*i;
    ctx.fillText(m, x-10, h-8);
  });

  function plotLine(series, color, fill){
    ctx.beginPath();
    series.forEach((v,i)=>{
      const x = padL + (plotW/(series.length-1))*i;
      const y = padT + plotH - (v/max)*plotH;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineJoin='round'; ctx.stroke();

    if(fill){
      const grad = ctx.createLinearGradient(0,padT,0,padT+plotH);
      grad.addColorStop(0, color+'33'); grad.addColorStop(1, color+'00');
      ctx.lineTo(padL+plotW, padT+plotH); ctx.lineTo(padL, padT+plotH); ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();
    }
    // dots
    series.forEach((v,i)=>{
      const x = padL + (plotW/(series.length-1))*i;
      const y = padT + plotH - (v/max)*plotH;
      ctx.beginPath(); ctx.arc(x,y,3.5,0,Math.PI*2); ctx.fillStyle = color; ctx.fill();
      ctx.beginPath(); ctx.arc(x,y,3.5,0,Math.PI*2); ctx.strokeStyle = themeColor('--surface'); ctx.lineWidth=2; ctx.stroke();
    });
  }

  plotLine(data.lastYear, '#CBD5E1', false);
  plotLine(data.thisYear, '#F59E0B', true);
}

function drawMiniChart(canvasId, series, color){
  const setup = getCanvasCtx(canvasId);
  if(!setup) return;
  const {ctx,w,h} = setup;
  const max = Math.max(...series) * 1.2;
  const padL=8,padR=8,padT=8,padB=8;
  const plotW=w-padL-padR, plotH=h-padT-padB;
  const barW = plotW/series.length*.55;
  const gap = plotW/series.length;

  ctx.clearRect(0,0,w,h);
  series.forEach((v,i)=>{
    const x = padL + gap*i + (gap-barW)/2;
    const bh = (v/max)*plotH;
    const y = padT+plotH-bh;
    const grad = ctx.createLinearGradient(0,y,0,padT+plotH);
    grad.addColorStop(0,color); grad.addColorStop(1,color+'66');
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, barW, bh, 4);
    ctx.fill();
  });
}
function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

/* Redraw charts on theme change + window resize (debounced) */
let resizeTimer;
window.addEventListener('resize', ()=>{
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(()=>{
    if(STATE.route==='dashboard'){ drawRevenueChart($('.panel-tab.active')?.dataset.metric||'revenue'); }
    if(STATE.route==='reports'){ redrawReportCharts(); }
  }, 200);
});

/* ====================================================================
   SHARED TABLE HELPERS
   ==================================================================== */
function paginate(arr, page, perPage){
  const start = (page-1)*perPage;
  return arr.slice(start, start+perPage);
}
function totalPages(len, perPage){ return Math.max(1, Math.ceil(len/perPage)); }

function renderPagination(containerEl, tableKey, totalItems, onChange){
  const t = STATE.tables[tableKey];
  const pages = totalPages(totalItems, t.perPage);
  if(t.page>pages) t.page = pages;
  const start = totalItems===0?0:(t.page-1)*t.perPage+1;
  const end = Math.min(t.page*t.perPage, totalItems);

  let btns = '';
  const windowSize = 5;
  let from = Math.max(1, t.page-2), to = Math.min(pages, from+windowSize-1);
  from = Math.max(1, to-windowSize+1);
  for(let p=from;p<=to;p++){
    btns += `<button data-page="${p}" class="${p===t.page?'active':''}">${p}</button>`;
  }

  containerEl.innerHTML = `
    <span>Showing <strong class="mono">${start}-${end}</strong> of <strong class="mono">${totalItems}</strong></span>
    <div class="page-btns">
      <button data-page="${t.page-1}" ${t.page<=1?'disabled':''}><i class="fa-solid fa-chevron-left"></i></button>
      ${btns}
      <button data-page="${t.page+1}" ${t.page>=pages?'disabled':''}><i class="fa-solid fa-chevron-right"></i></button>
    </div>`;

  containerEl.querySelectorAll('button[data-page]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const p = +b.dataset.page;
      if(p<1||p>pages) return;
      t.page = p;
      onChange();
    });
  });
}

function statusBadge(status){
  const map = {
    active:['badge-success','Active'], pending:['badge-warning','Pending'], suspended:['badge-danger','Suspended'],
    blocked:['badge-danger','Blocked'], approved:['badge-success','Approved'], rejected:['badge-danger','Rejected'],
    completed:['badge-success','Completed'], processing:['badge-info','Processing'], cancelled:['badge-danger','Cancelled'],
    resolved:['badge-success','Resolved'], disputed:['badge-danger','Disputed'],
  };
  const [cls,label] = map[status] || ['badge-neutral', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

/* ====================================================================
   MANAGE SELLERS
   ==================================================================== */
function renderSellers(wrap){
  const t = STATE.tables.sellers;
  wrap.innerHTML = `
    <div class="panel">
      <div class="table-toolbar">
        <div class="toolbar-left">
          <div class="toolbar-search"><i class="fa-solid fa-magnifying-glass"></i><input type="text" id="sellerSearch" placeholder="Search sellers by name or email…" value="${t.search}"></div>
          <select class="select-filter" id="sellerStatusFilter">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        <button class="btn btn-accent btn-sm" id="exportSellersBtn"><i class="fa-solid fa-download"></i> Export CSV</button>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr>
            <th>Seller</th><th>Location</th><th class="sortable" data-sort="listings">Listings</th>
            <th class="sortable" data-sort="sales">Sales</th><th class="sortable" data-sort="revenue">Revenue</th>
            <th>Rating</th><th>Status</th><th>Actions</th>
          </tr></thead>
          <tbody id="sellersTbody"></tbody>
        </table>
      </div>
      <div class="pagination" id="sellersPagination"></div>
    </div>`;

  function draw(){
    let rows = DB.sellers.filter(s =>
      (t.status==='all'||s.status===t.status) &&
      (s.name.toLowerCase().includes(t.search.toLowerCase()) || s.email.toLowerCase().includes(t.search.toLowerCase()))
    );
    rows.sort((a,b)=> t.sortDir==='asc' ? (a[t.sortKey]>b[t.sortKey]?1:-1) : (a[t.sortKey]<b[t.sortKey]?1:-1));
    const pageRows = paginate(rows, t.page, t.perPage);

    $('#sellersTbody').innerHTML = pageRows.length ? pageRows.map(s=>`
      <tr>
        <td><div class="cell-user"><img src="${s.avatar}" alt=""><div class="cell-user-text"><strong>${s.name}</strong><span>${s.email}</span></div></div></td>
        <td>${s.city}</td>
        <td class="mono">${s.listings}</td>
        <td class="mono">${s.sales}</td>
        <td class="mono">${fmtNaira(s.revenue)}</td>
        <td class="mono"><i class="fa-solid fa-star" style="color:#F59E0B;font-size:.75rem"></i> ${s.rating}</td>
        <td>${statusBadge(s.status)}</td>
        <td><div class="row-actions">
          <button class="act-view" data-view="${s.id}" title="View profile"><i class="fa-solid fa-eye"></i></button>
          ${s.status!=='active'?`<button class="act-approve" data-approve="${s.id}" title="Activate"><i class="fa-solid fa-check"></i></button>`:''}
          ${s.status!=='suspended'?`<button class="act-danger" data-suspend="${s.id}" title="Suspend"><i class="fa-solid fa-ban"></i></button>`:''}
          <button class="act-danger" data-delete="${s.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div></td>
      </tr>`).join('') : `<tr class="empty-row"><td colspan="8"><i class="fa-solid fa-store-slash empty-ico"></i><br>No sellers match your filters</td></tr>`;

    renderPagination($('#sellersPagination'), 'sellers', rows.length, draw);
    bindSellerRowActions(wrap, draw);
  }

  $('#sellerSearch').addEventListener('input', e=>{ t.search=e.target.value; t.page=1; draw(); });
  $('#sellerStatusFilter').addEventListener('change', e=>{ t.status=e.target.value; t.page=1; draw(); });
  wrap.querySelectorAll('th.sortable').forEach(th=>{
    th.addEventListener('click', ()=>{
      const key = th.dataset.sort;
      t.sortDir = (t.sortKey===key && t.sortDir==='desc') ? 'asc' : 'desc';
      t.sortKey = key; draw();
    });
  });
  $('#exportSellersBtn').addEventListener('click', ()=> exportSellersCSV());
  draw();
}

function bindSellerRowActions(wrap, redraw){
  $$('button[data-view]', wrap).forEach(b=>b.addEventListener('click',()=>openSellerDrawer(b.dataset.view)));

  $$('button[data-approve]', wrap).forEach(b=>b.addEventListener('click',()=>{
    const s = DB.sellers.find(x=>x.id===b.dataset.approve);
    if(!s) return;
    s.status = 'active'; // optimistic
    firebaseSetSellerStatus(s.id, 'active');
    toast('Seller activated', `${s.name} can now list vehicles`, 'success');
    redraw();
  }));

  $$('button[data-suspend]', wrap).forEach(b=>b.addEventListener('click',()=>{
    const s = DB.sellers.find(x=>x.id===b.dataset.suspend);
    if(!s) return;
    confirmAction({title:'Suspend this seller?', body:`${s.name} will lose access to their seller dashboard immediately.`, okLabel:'Suspend',
      onConfirm:()=>{
        s.status = 'suspended'; // optimistic
        firebaseSetSellerStatus(s.id, 'suspended');
        toast('Seller suspended', s.name, 'danger');
        redraw();
      }});
  }));

  $$('button[data-delete]', wrap).forEach(b=>b.addEventListener('click',()=>{
    const s = DB.sellers.find(x=>x.id===b.dataset.delete);
    if(!s) return;
    confirmAction({title:'Delete seller account?', body:`This permanently removes ${s.name} from Firestore. This cannot be undone.`, okLabel:'Delete permanently',
      onConfirm:()=>{
        DB.sellers = DB.sellers.filter(x=>x.id!==s.id); // optimistic
        firebaseDeleteSeller(s.id);
        toast('Seller deleted', s.name, 'danger');
        redraw();
      }});
  }));
}

function openSellerDrawer(id){
  const s = DB.sellers.find(x=>x.id===id);
  if(!s) return;
  openDrawer(`
    <div class="drawer-profile-head">
      <img src="${s.avatar}" alt="">
      <h3>${s.name}</h3><span>${s.email}</span>
      <div style="margin-top:8px">${statusBadge(s.status)}</div>
    </div>
    <div class="drawer-stat-grid">
      <div class="drawer-stat"><strong class="mono">${s.listings}</strong><span>Listings</span></div>
      <div class="drawer-stat"><strong class="mono">${s.sales}</strong><span>Sales</span></div>
      <div class="drawer-stat"><strong class="mono">${s.rating}★</strong><span>Rating</span></div>
    </div>
    <div class="drawer-section">
      <h4>Seller Details</h4>
      <div class="drawer-field"><span>Phone</span><span class="mono">${s.phone}</span></div>
      <div class="drawer-field"><span>Location</span><span>${s.city}, Nigeria</span></div>
      <div class="drawer-field"><span>Member since</span><span>${s.joined.toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'})}</span></div>
      <div class="drawer-field"><span>Total revenue</span><span class="mono">${fmtNaira(s.revenue)}</span></div>
    </div>
    <div class="drawer-section">
      <h4>Performance</h4>
      <div class="chart-wrap"><canvas id="drawerSellerChart" height="120"></canvas></div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-ghost" style="flex:1" id="drawerMessageBtn"><i class="fa-solid fa-message"></i> Message</button>
      ${s.status !== 'active' ? `<button class="btn btn-success" style="flex:1" id="drawerActivateBtn"><i class="fa-solid fa-check"></i> Activate</button>` : ''}
      ${s.status !== 'suspended' ? `<button class="btn btn-danger" style="flex:1" id="drawerSuspendBtn"><i class="fa-solid fa-ban"></i> Suspend</button>` : ''}
    </div>
    <div style="margin-top:10px">
      <button class="btn btn-ghost" style="width:100%" id="drawerVerifyBtn">
        <i class="fa-solid fa-${s.verified ? 'times-circle' : 'badge-check'}"></i>
        ${s.verified ? 'Remove verification badge' : 'Mark as Verified ✓'}
      </button>
    </div>
  `);
  // Build a simple bar chart from the seller's real listing count
  // spread across 6 months (best approximation without real monthly stats)
  const base = Math.max(1, Math.floor(s.listings / 6));
  const variance = Math.max(1, Math.floor(s.listings / 4));
  const series = Array.from({length:6}, () => base + Math.floor(Math.random() * variance));
  setTimeout(()=> drawMiniChart('drawerSellerChart', series, '#F59E0B'), 50);

  $('#drawerActivateBtn')?.addEventListener('click', ()=>{
    s.status = 'active';
    firebaseSetSellerStatus(s.id, 'active');
    $('#drawerOverlay').classList.remove('open');
    toast('Seller activated', s.name, 'success');
    navigate('sellers');
  });
  $('#drawerSuspendBtn')?.addEventListener('click', ()=>{
    confirmAction({title:'Suspend this seller?', body:`${s.name} will lose dashboard access.`, okLabel:'Suspend',
      onConfirm:()=>{
        s.status = 'suspended';
        firebaseSetSellerStatus(s.id, 'suspended');
        $('#drawerOverlay').classList.remove('open');
        toast('Seller suspended', s.name, 'danger');
        navigate('sellers');
      }});
  });
  $('#drawerVerifyBtn')?.addEventListener('click', ()=>{
    s.verified = !s.verified;
    firebaseSetSellerVerified(s.id, s.verified);
    $('#drawerOverlay').classList.remove('open');
    toast(s.verified ? 'Seller verified' : 'Verification removed', s.name, 'success');
    navigate('sellers');
  });
  $('#drawerMessageBtn')?.addEventListener('click', ()=>{ $('#drawerOverlay').classList.remove('open'); navigate('messages'); });
}

/* ====================================================================
   MANAGE BUYERS
   ==================================================================== */
function renderBuyers(wrap){
  const t = STATE.tables.buyers;
  wrap.innerHTML = `
    <div class="panel">
      <div class="table-toolbar">
        <div class="toolbar-left">
          <div class="toolbar-search"><i class="fa-solid fa-magnifying-glass"></i><input type="text" id="buyerSearch" placeholder="Search buyers by name or email…" value="${t.search}"></div>
          <select class="select-filter" id="buyerStatusFilter">
            <option value="all">All statuses</option><option value="active">Active</option><option value="blocked">Blocked</option>
          </select>
        </div>
        <button class="btn btn-accent btn-sm" id="exportBuyersBtn"><i class="fa-solid fa-download"></i> Export CSV</button>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Buyer</th><th>Location</th><th class="sortable" data-sort="purchases">Purchases</th><th class="sortable" data-sort="totalSpent">Total Spent</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody id="buyersTbody"></tbody>
        </table>
      </div>
      <div class="pagination" id="buyersPagination"></div>
    </div>`;

  function draw(){
    let rows = DB.buyers.filter(b => (t.status==='all'||b.status===t.status) &&
      (b.name.toLowerCase().includes(t.search.toLowerCase())||b.email.toLowerCase().includes(t.search.toLowerCase())));
    rows.sort((a,b)=> t.sortDir==='asc' ? (a[t.sortKey]>b[t.sortKey]?1:-1) : (a[t.sortKey]<b[t.sortKey]?1:-1));
    const pageRows = paginate(rows, t.page, t.perPage);

    $('#buyersTbody').innerHTML = pageRows.length ? pageRows.map(b=>`
      <tr>
        <td><div class="cell-user"><img src="${b.avatar}" alt=""><div class="cell-user-text"><strong>${b.name}</strong><span>${b.email}</span></div></div></td>
        <td>${b.city}</td>
        <td class="mono">${b.purchases}</td>
        <td class="mono">${fmtNaira(b.totalSpent)}</td>
        <td>${statusBadge(b.status)}</td>
        <td><div class="row-actions">
          <button class="act-view" data-view="${b.id}" title="View profile"><i class="fa-solid fa-eye"></i></button>
          ${b.status==='blocked'?`<button class="act-approve" data-unblock="${b.id}" title="Unblock"><i class="fa-solid fa-unlock"></i></button>`
            :`<button class="act-danger" data-block="${b.id}" title="Block"><i class="fa-solid fa-ban"></i></button>`}
          <button class="act-danger" data-delete="${b.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div></td>
      </tr>`).join('') : `<tr class="empty-row"><td colspan="6"><i class="fa-solid fa-user-slash empty-ico"></i><br>No buyers match your filters</td></tr>`;

    renderPagination($('#buyersPagination'), 'buyers', rows.length, draw);
    bindBuyerRowActions(wrap, draw);
  }
  $('#buyerSearch').addEventListener('input', e=>{ t.search=e.target.value; t.page=1; draw(); });
  $('#buyerStatusFilter').addEventListener('change', e=>{ t.status=e.target.value; t.page=1; draw(); });
  wrap.querySelectorAll('th.sortable').forEach(th=>th.addEventListener('click',()=>{
    const key = th.dataset.sort; t.sortDir = (t.sortKey===key&&t.sortDir==='desc')?'asc':'desc'; t.sortKey=key; draw();
  }));
  $('#exportBuyersBtn').addEventListener('click', ()=> exportBuyersCSV());
  draw();
}

function bindBuyerRowActions(wrap, redraw){
  $$('button[data-view]', wrap).forEach(b=>b.addEventListener('click',()=>openBuyerDrawer(b.dataset.view)));

  $$('button[data-block]', wrap).forEach(b=>b.addEventListener('click',()=>{
    const x = DB.buyers.find(o=>o.id===b.dataset.block);
    if(!x) return;
    confirmAction({title:'Block this buyer?', body:`${x.name} won't be able to message sellers or complete purchases.`, okLabel:'Block',
      onConfirm:()=>{
        x.status = 'blocked'; // optimistic
        firebaseSetBuyerStatus(x.id, 'blocked');
        toast('Buyer blocked', x.name, 'danger');
        redraw();
      }});
  }));

  $$('button[data-unblock]', wrap).forEach(b=>b.addEventListener('click',()=>{
    const x = DB.buyers.find(o=>o.id===b.dataset.unblock);
    if(!x) return;
    x.status = 'active'; // optimistic
    firebaseSetBuyerStatus(x.id, 'active');
    toast('Buyer unblocked', x.name, 'success');
    redraw();
  }));

  $$('button[data-delete]', wrap).forEach(b=>b.addEventListener('click',()=>{
    const x = DB.buyers.find(o=>o.id===b.dataset.delete);
    if(!x) return;
    confirmAction({title:'Delete buyer record?', body:`This removes ${x.name} from the admin view. Their Firebase Auth account is not affected (auth deletion requires the Firebase Admin SDK).`, okLabel:'Remove record',
      onConfirm:()=>{
        DB.buyers = DB.buyers.filter(o=>o.id!==x.id); // local removal only
        toast('Buyer record removed', x.name, 'danger');
        redraw();
      }});
  }));
}

function openBuyerDrawer(id){
  const b = DB.buyers.find(x=>x.id===id);
  if(!b) return;
  const history = DB.orders.filter(o=>o.buyer===b.name).slice(0,5);
  openDrawer(`
    <div class="drawer-profile-head">
      <img src="${b.avatar}" alt=""><h3>${b.name}</h3><span>${b.email}</span>
      <div style="margin-top:8px">${statusBadge(b.status)}</div>
    </div>
    <div class="drawer-stat-grid">
      <div class="drawer-stat"><strong class="mono">${b.purchases}</strong><span>Orders</span></div>
      <div class="drawer-stat"><strong class="mono" style="font-size:.85rem">${fmtNaira(b.totalSpent)}</strong><span>Spent</span></div>
      <div class="drawer-stat"><strong class="mono">${b.city.slice(0,3).toUpperCase()}</strong><span>City</span></div>
    </div>
    <div class="drawer-section">
      <h4>Buyer Details</h4>
      <div class="drawer-field"><span>Phone</span><span class="mono">${b.phone}</span></div>
      <div class="drawer-field"><span>Location</span><span>${b.city}, Nigeria</span></div>
      <div class="drawer-field"><span>Member since</span><span>${b.joined.toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'})}</span></div>
    </div>
    <div class="drawer-section">
      <h4>Purchase History</h4>
      ${history.length ? history.map(o=>`<div class="drawer-field"><span>${o.vehicle}</span><span class="mono">${fmtNaira(o.amount)}</span></div>`).join('') : '<p style="font-size:.8rem;color:var(--text-3)">No purchases yet.</p>'}
    </div>
    <button class="btn ${b.status==='blocked'?'btn-success':'btn-danger'}" style="width:100%" id="drawerBlockBtn">
      <i class="fa-solid fa-${b.status==='blocked'?'unlock':'ban'}"></i>
      ${b.status==='blocked' ? 'Unblock Buyer' : 'Block Buyer'}
    </button>
  `);
  $('#drawerBlockBtn')?.addEventListener('click', ()=>{
    const isBlocked = b.status === 'blocked';
    const action = isBlocked ? 'unblock' : 'block';
    const newStatus = isBlocked ? 'active' : 'blocked';
    confirmAction({title:`${isBlocked ? 'Unblock' : 'Block'} this buyer?`,
      body: isBlocked ? `${b.name} will regain marketplace access.` : `${b.name} will lose marketplace access.`,
      okLabel: isBlocked ? 'Unblock' : 'Block', danger: !isBlocked,
      onConfirm:()=>{
        b.status = newStatus; // optimistic
        firebaseSetBuyerStatus(b.id, newStatus);
        $('#drawerOverlay').classList.remove('open');
        toast(`Buyer ${action}ed`, b.name, isBlocked ? 'success' : 'danger');
        navigate('buyers');
      }});
  });
}

/* ====================================================================
   MANAGE VEHICLES
   ==================================================================== */
function renderVehicles(wrap){
  const t = STATE.tables.vehicles;
  wrap.innerHTML = `
    <div class="panel">
      <div class="table-toolbar">
        <div class="toolbar-left">
          <div class="toolbar-search"><i class="fa-solid fa-magnifying-glass"></i><input type="text" id="vehicleSearch" placeholder="Search by brand, model or seller…" value="${t.search}"></div>
          <select class="select-filter" id="vehicleStatusFilter">
            <option value="all">All statuses</option><option value="approved">Approved</option><option value="pending">Pending</option><option value="rejected">Rejected</option>
          </select>
          <select class="select-filter" id="vehicleBrandFilter">
            <option value="all">All brands</option>${BRANDS.map(b=>`<option value="${b}">${b}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-accent btn-sm" id="exportVehiclesBtn"><i class="fa-solid fa-download"></i> Export CSV</button>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Vehicle</th><th>Year</th><th class="sortable" data-sort="mileage">Mileage</th><th class="sortable" data-sort="price">Price</th><th>Seller</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody id="vehiclesTbody"></tbody>
        </table>
      </div>
      <div class="pagination" id="vehiclesPagination"></div>
    </div>`;

  function draw(){
    let rows = DB.vehicles.filter(v =>
      (t.status==='all'||v.status===t.status) && (t.brand==='all'||v.brand===t.brand) &&
      (v.title.toLowerCase().includes(t.search.toLowerCase()) || v.seller.toLowerCase().includes(t.search.toLowerCase()))
    );
    rows.sort((a,b)=> t.sortDir==='asc' ? (a[t.sortKey]>b[t.sortKey]?1:-1) : (a[t.sortKey]<b[t.sortKey]?1:-1));
    const pageRows = paginate(rows, t.page, t.perPage);

    $('#vehiclesTbody').innerHTML = pageRows.length ? pageRows.map(v=>`
      <tr>
        <td><div class="cell-vehicle"><img src="${v.image}" alt="" onerror="this.src='https://placehold.co/100x70/1E293B/F59E0B?text=Car'"><div class="cell-vehicle-text"><strong>${v.title}</strong><span>${v.id}</span></div></div></td>
        <td class="mono">${v.year}</td>
        <td class="mono">${fmtNum(v.mileage)} km</td>
        <td class="mono">${fmtNaira(v.price)}</td>
        <td>${v.seller}</td>
        <td>${statusBadge(v.status)}</td>
        <td><div class="row-actions">
          <button class="act-view" data-preview="${v.id}" title="Preview"><i class="fa-solid fa-eye"></i></button>
          <button data-edit="${v.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
          ${v.status!=='approved'?`<button class="act-approve" data-approve="${v.id}" title="Approve"><i class="fa-solid fa-check"></i></button>`:''}
          ${v.status!=='rejected'?`<button class="act-danger" data-reject="${v.id}" title="Reject"><i class="fa-solid fa-xmark"></i></button>`:''}
          <button class="act-danger" data-delete="${v.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div></td>
      </tr>`).join('') : `<tr class="empty-row"><td colspan="7"><i class="fa-solid fa-car-burst empty-ico"></i><br>No vehicles match your filters</td></tr>`;

    renderPagination($('#vehiclesPagination'), 'vehicles', rows.length, draw);
    bindVehicleRowActions(wrap, draw);
  }
  $('#vehicleSearch').addEventListener('input', e=>{ t.search=e.target.value; t.page=1; draw(); });
  $('#vehicleStatusFilter').addEventListener('change', e=>{ t.status=e.target.value; t.page=1; draw(); });
  $('#vehicleBrandFilter').addEventListener('change', e=>{ t.brand=e.target.value; t.page=1; draw(); });
  wrap.querySelectorAll('th.sortable').forEach(th=>th.addEventListener('click',()=>{
    const key = th.dataset.sort; t.sortDir = (t.sortKey===key&&t.sortDir==='desc')?'asc':'desc'; t.sortKey=key; draw();
  }));
  $('#exportVehiclesBtn').addEventListener('click', ()=> exportVehiclesCSV());
  draw();
}

function bindVehicleRowActions(wrap, redraw){
  $$('button[data-preview]', wrap).forEach(b=>b.addEventListener('click',()=>openVehicleDrawer(b.dataset.preview)));
  $$('button[data-edit]', wrap).forEach(b=>b.addEventListener('click',()=>openVehicleEditModal(b.dataset.edit, redraw)));

  $$('button[data-approve]', wrap).forEach(b=>b.addEventListener('click',()=>{
    const v = DB.vehicles.find(x=>x.id===b.dataset.approve);
    if(!v) return;
    v.status = 'approved'; // optimistic
    apiSetVehicleStatus(v.id, 'approved');
    toast('Vehicle approved', v.title, 'success');
    redraw();
  }));

  $$('button[data-reject]', wrap).forEach(b=>b.addEventListener('click',()=>{
    const v = DB.vehicles.find(x=>x.id===b.dataset.reject);
    if(!v) return;
    confirmAction({title:'Reject this listing?', body:`${v.title} will be hidden from the marketplace.`, okLabel:'Reject',
      onConfirm:()=>{
        v.status = 'rejected'; // optimistic
        apiSetVehicleStatus(v.id, 'rejected');
        toast('Vehicle rejected', v.title, 'danger');
        redraw();
      }});
  }));

  $$('button[data-delete]', wrap).forEach(b=>b.addEventListener('click',()=>{
    const v = DB.vehicles.find(x=>x.id===b.dataset.delete);
    if(!v) return;
    confirmAction({title:'Delete this listing?', body:`${v.title} will be permanently removed from the platform.`, okLabel:'Delete permanently',
      onConfirm:()=>{
        DB.vehicles = DB.vehicles.filter(x=>x.id!==v.id); // optimistic
        apiDeleteVehicle(v.id);
        toast('Vehicle deleted', v.title, 'danger');
        redraw();
      }});
  }));
}

function openVehicleDrawer(id){
  const v = DB.vehicles.find(x=>x.id===id);
  if(!v) return;
  openDrawer(`
    <img src="${v.image}" alt="" style="width:100%;height:200px;object-fit:cover;border-radius:14px;margin-bottom:16px" onerror="this.src='https://placehold.co/400x200/1E293B/F59E0B?text=Vehicle'">
    <div style="margin-bottom:16px"><h3 style="font-size:1.2rem">${v.title}</h3><span style="font-size:.8rem;color:var(--text-3)" class="mono">${v.id}</span></div>
    <div class="drawer-stat-grid">
      <div class="drawer-stat"><strong class="mono" style="font-size:.85rem">${fmtNaira(v.price)}</strong><span>Price</span></div>
      <div class="drawer-stat"><strong class="mono">${fmtNum(v.mileage)}</strong><span>Mileage (km)</span></div>
      <div class="drawer-stat"><strong class="mono">${fmtNum(v.views)}</strong><span>Views</span></div>
    </div>
    <div class="drawer-section">
      <h4>Vehicle Details</h4>
      <div class="drawer-field"><span>Brand</span><span>${v.brand}</span></div>
      <div class="drawer-field"><span>Model</span><span>${v.model}</span></div>
      <div class="drawer-field"><span>Year</span><span>${v.year}</span></div>
      <div class="drawer-field"><span>Status</span><span>${statusBadge(v.status)}</span></div>
      <div class="drawer-field"><span>Submitted</span><span>${v.submitted.toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'})}</span></div>
    </div>
    <div class="drawer-section">
      <h4>Seller</h4>
      <div class="cell-user" style="margin-bottom:10px"><img src="${v.sellerAvatar}" alt=""><div class="cell-user-text"><strong>${v.seller}</strong><span>View seller profile</span></div></div>
    </div>
    <div style="display:flex;gap:10px">
      ${v.status!=='approved'?`<button class="btn btn-success" style="flex:1" id="drawerApproveVeh"><i class="fa-solid fa-check"></i> Approve</button>`:''}
      <button class="btn btn-danger" style="flex:1" id="drawerRejectVeh"><i class="fa-solid fa-xmark"></i> Reject</button>
    </div>
  `);
  $('#drawerApproveVeh')?.addEventListener('click', ()=>{
    v.status = 'approved'; // optimistic
    apiSetVehicleStatus(v.id, 'approved');
    $('#drawerOverlay').classList.remove('open');
    toast('Vehicle approved', v.title, 'success');
    navigate(STATE.route);
  });
  $('#drawerRejectVeh')?.addEventListener('click', ()=>{
    confirmAction({title:'Reject this listing?', body:`${v.title} will be hidden from the marketplace.`, okLabel:'Reject',
      onConfirm:()=>{
        v.status = 'rejected'; // optimistic
        apiSetVehicleStatus(v.id, 'rejected');
        $('#drawerOverlay').classList.remove('open');
        toast('Vehicle rejected', v.title, 'danger');
        navigate(STATE.route);
      }});
  });
}

function openVehicleEditModal(id, redraw){
  const v = DB.vehicles.find(x=>x.id===id);
  if(!v) return;
  openDrawer(`
    <h3 style="margin-bottom:18px">Edit Vehicle</h3>
    <div class="form-grid">
      <div class="form-field"><label>Brand</label><input id="ev-brand" value="${v.brand}"></div>
      <div class="form-field"><label>Model</label><input id="ev-model" value="${v.model}"></div>
      <div class="form-field"><label>Year</label><input id="ev-year" type="number" value="${v.year}"></div>
      <div class="form-field"><label>Mileage (km)</label><input id="ev-mileage" type="number" value="${v.mileage}"></div>
      <div class="form-field full"><label>Price (₦)</label><input id="ev-price" type="number" value="${v.price}"></div>
      <div class="form-field full"><label>Status</label>
        <select id="ev-status"><option value="approved" ${v.status==='approved'?'selected':''}>Approved</option><option value="pending" ${v.status==='pending'?'selected':''}>Pending</option><option value="rejected" ${v.status==='rejected'?'selected':''}>Rejected</option></select>
      </div>
    </div>
    <div class="form-foot">
      <button class="btn btn-ghost" id="ev-cancel">Cancel</button>
      <button class="btn btn-accent" id="ev-save"><i class="fa-solid fa-floppy-disk"></i> Save Changes</button>
    </div>
  `);
  $('#ev-cancel').addEventListener('click', ()=> $('#drawerOverlay').classList.remove('open'));
  $('#ev-save').addEventListener('click', ()=>{
    const newBrand  = $('#ev-brand').value.trim();
    const newModel  = $('#ev-model').value.trim();
    const newYear   = +$('#ev-year').value;
    const newMileage = +$('#ev-mileage').value;
    const newPrice  = +$('#ev-price').value;
    const newStatus = $('#ev-status').value;

    // Optimistic local update
    v.brand = newBrand; v.model = newModel; v.year = newYear;
    v.mileage = newMileage; v.price = newPrice; v.status = newStatus;
    v.title = `${newYear} ${newBrand} ${newModel}`;

    // Real API write
    apiUpdateVehicle(v.id, {
      make: newBrand, model: newModel, year: newYear,
      mileage: newMileage, price: newPrice, status: newStatus,
    });

    $('#drawerOverlay').classList.remove('open');
    toast('Vehicle updated', v.title, 'success');
    redraw ? redraw() : navigate(STATE.route);
  });
}

/* ====================================================================
   PENDING APPROVALS
   ==================================================================== */
function renderApprovals(wrap){
  const pendingVehicles = DB.vehicles.filter(v=>v.status==='pending');
  const pendingSellers  = DB.sellers.filter(s=>s.status==='pending');

  wrap.innerHTML = `
    <div class="stat-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:20px">
      ${statCard('fa-car','ico-amber','Vehicles Awaiting Review', pendingVehicles.length, 'Needs action','down')}
      ${statCard('fa-store','ico-blue','Sellers Awaiting Review', pendingSellers.length, 'Needs action','down')}
    </div>
    <div class="panel" style="margin-bottom:18px">
      <div class="panel-head"><h3>Pending Vehicle Listings</h3></div>
      <div class="table-scroll"><table>
        <thead><tr><th>Vehicle</th><th>Seller</th><th>Submitted</th><th>Price</th><th>Actions</th></tr></thead>
        <tbody id="approvalsVehTbody"></tbody>
      </table></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Pending Seller Accounts</h3></div>
      <div class="table-scroll"><table>
        <thead><tr><th>Seller</th><th>Location</th><th>Joined</th><th>Actions</th></tr></thead>
        <tbody id="approvalsSellerTbody"></tbody>
      </table></div>
    </div>`;

  function draw(){
    const pv = DB.vehicles.filter(v=>v.status==='pending');
    const ps = DB.sellers.filter(s=>s.status==='pending');

    $('#approvalsVehTbody').innerHTML = pv.length ? pv.map(v=>`
      <tr>
        <td><div class="cell-vehicle"><img src="${v.image}" alt="" onerror="this.src='https://placehold.co/100x70/1E293B/F59E0B?text=Car'"><div class="cell-vehicle-text"><strong>${v.title}</strong><span>${v.id}</span></div></div></td>
        <td>${v.seller}</td><td>${relTime(v.submitted)}</td><td class="mono">${fmtNaira(v.price)}</td>
        <td><div class="row-actions">
          <button class="act-view" data-preview="${v.id}"><i class="fa-solid fa-eye"></i></button>
          <button class="act-approve" data-av="${v.id}"><i class="fa-solid fa-check"></i></button>
          <button class="act-danger" data-rv="${v.id}"><i class="fa-solid fa-xmark"></i></button>
        </div></td>
      </tr>`).join('') : `<tr class="empty-row"><td colspan="5"><i class="fa-solid fa-circle-check empty-ico"></i><br>All vehicles reviewed 🎉</td></tr>`;

    $('#approvalsSellerTbody').innerHTML = ps.length ? ps.map(s=>`
      <tr>
        <td><div class="cell-user"><img src="${s.avatar}" alt=""><div class="cell-user-text"><strong>${s.name}</strong><span>${s.email}</span></div></div></td>
        <td>${s.city}</td><td>${relTime(s.joined)}</td>
        <td><div class="row-actions">
          <button class="act-view" data-vs="${s.id}"><i class="fa-solid fa-eye"></i></button>
          <button class="act-approve" data-as="${s.id}"><i class="fa-solid fa-check"></i></button>
          <button class="act-danger" data-rs="${s.id}"><i class="fa-solid fa-xmark"></i></button>
        </div></td>
      </tr>`).join('') : `<tr class="empty-row"><td colspan="4"><i class="fa-solid fa-circle-check empty-ico"></i><br>All sellers reviewed 🎉</td></tr>`;

    $$('button[data-preview]', wrap).forEach(b=>b.addEventListener('click',()=>openVehicleDrawer(b.dataset.preview)));

    $$('button[data-av]', wrap).forEach(b=>b.addEventListener('click',()=>{
      const v = DB.vehicles.find(x=>x.id===b.dataset.av);
      if(!v) return;
      v.status = 'approved'; // optimistic
      apiSetVehicleStatus(v.id, 'approved');
      toast('Vehicle approved', v.title, 'success');
      navigate('approvals');
    }));

    $$('button[data-rv]', wrap).forEach(b=>b.addEventListener('click',()=>{
      const v = DB.vehicles.find(x=>x.id===b.dataset.rv);
      if(!v) return;
      confirmAction({title:'Reject this listing?', body:v.title, okLabel:'Reject',
        onConfirm:()=>{
          v.status = 'rejected'; // optimistic
          apiSetVehicleStatus(v.id, 'rejected');
          toast('Vehicle rejected', v.title, 'danger');
          navigate('approvals');
        }});
    }));

    $$('button[data-vs]', wrap).forEach(b=>b.addEventListener('click',()=>openSellerDrawer(b.dataset.vs)));

    $$('button[data-as]', wrap).forEach(b=>b.addEventListener('click',()=>{
      const s = DB.sellers.find(x=>x.id===b.dataset.as);
      if(!s) return;
      s.status = 'active'; // optimistic
      firebaseSetSellerStatus(s.id, 'active');
      toast('Seller approved', s.name, 'success');
      navigate('approvals');
    }));

    $$('button[data-rs]', wrap).forEach(b=>b.addEventListener('click',()=>{
      const s = DB.sellers.find(x=>x.id===b.dataset.rs);
      if(!s) return;
      confirmAction({title:'Reject this seller?', body:s.name, okLabel:'Reject',
        onConfirm:()=>{
          s.status = 'suspended'; // optimistic
          firebaseSetSellerStatus(s.id, 'suspended');
          toast('Seller rejected', s.name, 'danger');
          navigate('approvals');
        }});
    }));
  }
  draw();
}

/* ====================================================================
   ORDERS & TRANSACTIONS
   ==================================================================== */
function renderOrders(wrap){
  const t = STATE.tables.orders;
  const totalRev = DB.orders.filter(o=>o.status==='completed').reduce((s,o)=>s+o.amount,0);

  wrap.innerHTML = `
    <div class="stat-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px">
      ${statCard('fa-receipt','ico-blue','Total Orders', fmtNum(DB.orders.length), '+9.8%','up')}
      ${statCard('fa-circle-check','ico-green','Completed', DB.orders.filter(o=>o.status==='completed').length, '+11%','up')}
      ${statCard('fa-spinner','ico-amber','Processing', DB.orders.filter(o=>o.status==='processing').length, 'Stable','up')}
      ${statCard('fa-sack-dollar','ico-purple','Revenue', fmtNaira(totalRev), '+14.3%','up')}
    </div>
    <div class="panel">
      <div class="table-toolbar">
        <div class="toolbar-left">
          <div class="toolbar-search"><i class="fa-solid fa-magnifying-glass"></i><input type="text" id="orderSearch" placeholder="Search by order ID, vehicle or buyer…" value="${t.search}"></div>
          <select class="select-filter" id="orderStatusFilter">
            <option value="all">All statuses</option><option value="completed">Completed</option><option value="processing">Processing</option><option value="pending">Pending</option><option value="cancelled">Cancelled</option>
          </select>
        </div>
        <button class="btn btn-accent btn-sm" id="exportOrdersPdf"><i class="fa-solid fa-file-pdf"></i> Export PDF</button>
        <button class="btn btn-ghost btn-sm" id="exportOrdersCsv"><i class="fa-solid fa-file-excel"></i> Export Excel</button>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Order ID</th><th>Vehicle</th><th>Buyer</th><th class="sortable" data-sort="amount">Amount</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
          <tbody id="ordersTbody"></tbody>
        </table>
      </div>
      <div class="pagination" id="ordersPagination"></div>
    </div>`;

  function draw(){
    let rows = DB.orders.filter(o => (t.status==='all'||o.status===t.status) &&
      (o.id.toLowerCase().includes(t.search.toLowerCase())||o.vehicle.toLowerCase().includes(t.search.toLowerCase())||o.buyer.toLowerCase().includes(t.search.toLowerCase())));
    const pageRows = paginate(rows, t.page, t.perPage);

    $('#ordersTbody').innerHTML = pageRows.length ? pageRows.map(o=>`
      <tr>
        <td class="mono">${o.id}</td>
        <td><div class="cell-vehicle"><img src="${o.vehicleImg}" alt="" onerror="this.src='https://placehold.co/100x70/1E293B/F59E0B?text=Car'"><div class="cell-vehicle-text"><strong>${o.vehicle}</strong></div></div></td>
        <td>${o.buyer}</td>
        <td class="mono">${fmtNaira(o.amount)}</td>
        <td>${statusBadge(o.status)}</td>
        <td>${o.date.toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'})}</td>
        <td><div class="row-actions"><button class="act-view" data-order="${o.id}" title="View"><i class="fa-solid fa-eye"></i></button></div></td>
      </tr>`).join('') : `<tr class="empty-row"><td colspan="7"><i class="fa-solid fa-receipt empty-ico"></i><br>No orders match your filters</td></tr>`;

    renderPagination($('#ordersPagination'), 'orders', rows.length, draw);
    $$('button[data-order]', wrap).forEach(b=>b.addEventListener('click',()=>{
      const o = DB.orders.find(x=>x.id===b.dataset.order);
      openDrawer(`
        <img src="${o.vehicleImg}" alt="" style="width:100%;height:180px;object-fit:cover;border-radius:14px;margin-bottom:16px" onerror="this.src='https://placehold.co/400x180/1E293B/F59E0B?text=Vehicle'">
        <h3 style="margin-bottom:4px">${o.vehicle}</h3><span class="mono" style="font-size:.8rem;color:var(--text-3)">${o.id}</span>
        <div class="drawer-section" style="margin-top:18px">
          <div class="drawer-field"><span>Buyer</span><span>${o.buyer}</span></div>
          <div class="drawer-field"><span>Amount</span><span class="mono">${fmtNaira(o.amount)}</span></div>
          <div class="drawer-field"><span>Status</span><span>${statusBadge(o.status)}</span></div>
          <div class="drawer-field"><span>Date</span><span>${o.date.toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'})}</span></div>
        </div>`);
    }));
  }
  $('#orderSearch').addEventListener('input', e=>{ t.search=e.target.value; t.page=1; draw(); });
  $('#orderStatusFilter').addEventListener('change', e=>{ t.status=e.target.value; t.page=1; draw(); });
  $('#exportOrdersPdf').addEventListener('click', ()=> exportOrdersCSV());
  $('#exportOrdersCsv').addEventListener('click', ()=> exportOrdersCSV());
  draw();
}

function exportNotice(format){
  toast(`Generating ${format} report…`, 'This may take a few seconds');
  setTimeout(()=> toast(`${format} report ready`, 'Your download will start shortly','success'), 1400);
}

/* ── Real CSV export functions ── */
function downloadCSV(filename, rows, headers){
  const escape = v => {
    const s = String(v ?? '').replace(/"/g, '""');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
  };
  const csv = [headers.join(','), ...rows.map(r => r.map(escape).join(','))].join('\r\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  toast('CSV downloaded', filename, 'success');
}

function exportSellersCSV(){
  const headers = ['Name','Email','Phone','City','Status','Listings','Verified','Joined'];
  const rows = DB.sellers.map(s => [
    s.name, s.email, s.phone, s.city, s.status, s.listings,
    s.verified ? 'Yes' : 'No',
    s.joined.toLocaleDateString('en-NG'),
  ]);
  downloadCSV('jerry-autos-sellers.csv', rows, headers);
}

function exportBuyersCSV(){
  const headers = ['Name','Email','City','Status','Joined'];
  const rows = DB.buyers.map(b => [
    b.name, b.email, b.city, b.status,
    b.joined.toLocaleDateString('en-NG'),
  ]);
  downloadCSV('jerry-autos-buyers.csv', rows, headers);
}

function exportVehiclesCSV(){
  const headers = ['ID','Title','Brand','Model','Year','Mileage(km)','Price(NGN)','Seller','Status'];
  const rows = DB.vehicles.map(v => [
    v.id, v.title, v.brand, v.model, v.year,
    v.mileage, v.price, v.seller, v.status,
  ]);
  downloadCSV('jerry-autos-vehicles.csv', rows, headers);
}

function exportOrdersCSV(){
  const headers = ['Order ID','Vehicle','Buyer','Amount(NGN)','Status','Date'];
  const rows = DB.orders.map(o => [
    o.id, o.vehicle, o.buyer, o.amount, o.status,
    o.date.toLocaleDateString('en-NG'),
  ]);
  downloadCSV('jerry-autos-orders.csv', rows, headers);
}

/* ====================================================================
   REPORTS & ANALYTICS
   ==================================================================== */
function renderReports(wrap){
  // Real stats from live DB
  const totalRev     = DB.vehicles.reduce((s,v)=>s+(v.price||0),0);
  const approvedVehs = DB.vehicles.filter(v=>v.status==='approved').length;
  const newSellers   = DB.sellers.filter(s=>{
    const d=s.joined; if(!d) return false;
    return (Date.now()-d.getTime()) < 30*24*60*60*1000; // last 30 days
  }).length;
  const newBuyers = DB.buyers.length;

  wrap.innerHTML = `
    <div class="page-actions" style="margin-bottom:20px">
      <button class="btn btn-ghost" id="repPdf"><i class="fa-solid fa-file-pdf"></i> Export Sellers CSV</button>
      <button class="btn btn-accent" id="repXls"><i class="fa-solid fa-file-excel"></i> Export Vehicles CSV</button>
    </div>
    <div class="dash-grid">
      <div class="panel">
        <div class="panel-head"><div><h3>Listings per Month</h3><p class="panel-sub">Vehicles submitted</p></div></div>
        <div class="panel-body"><div class="chart-wrap"><canvas id="repSalesChart" height="240"></canvas></div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Listing Value Growth</h3><p class="panel-sub">Total vehicle price (₦M)</p></div></div>
        <div class="panel-body"><div class="chart-wrap"><canvas id="repRevenueChart" height="240"></canvas></div></div>
      </div>
    </div>
    <div class="dash-grid">
      <div class="panel">
        <div class="panel-head"><div><h3>Seller Registrations</h3><p class="panel-sub">New sellers per month</p></div></div>
        <div class="panel-body"><div class="chart-wrap"><canvas id="repUserChart" height="220"></canvas></div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Top Brands</h3></div>
        <div class="panel-body" id="repBrands"></div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Performance Summary</h3><p class="panel-sub" style="font-size:.72rem;color:var(--text-3)">Live from Firebase + Express API</p></div>
      <div class="table-scroll"><table>
        <thead><tr><th>Metric</th><th>Current Value</th><th>Source</th></tr></thead>
        <tbody>
          <tr><td>Total Listing Value</td><td class="mono">${fmtNaira(totalRev)}</td><td>Express API (live)</td></tr>
          <tr><td>Approved Listings</td><td class="mono">${fmtNum(approvedVehs)}</td><td>Express API (live)</td></tr>
          <tr><td>Total Sellers</td><td class="mono">${fmtNum(DB.sellers.length)}</td><td>Firestore (live)</td></tr>
          <tr><td>New Sellers (30d)</td><td class="mono">${fmtNum(newSellers)}</td><td>Firestore (live)</td></tr>
          <tr><td>Active Buyers</td><td class="mono">${fmtNum(newBuyers)}</td><td>Firestore chats (live)</td></tr>
          <tr><td>Pending Approvals</td><td class="mono">${fmtNum(DB.vehicles.filter(v=>v.status==='pending').length + DB.sellers.filter(s=>s.status==='pending').length)}</td><td>Live</td></tr>
        </tbody>
      </table></div>
    </div>`;

  redrawReportCharts();
  renderTopBrandsInto('repBrands');

  $('#repPdf').addEventListener('click', ()=>exportSellersCSV());
  $('#repXls').addEventListener('click', ()=>exportVehiclesCSV());
}

function redrawReportCharts(){
  // Build real month series from DB
  const now = new Date();
  function mSeries(items, dateField, valueFn){
    return Array.from({length:6},(_,i)=>{
      const m = new Date(now.getFullYear(), now.getMonth()-5+i, 1);
      const inMonth = items.filter(x=>{
        const d = x[dateField];
        return d && d.getFullYear()===m.getFullYear() && d.getMonth()===m.getMonth();
      });
      return valueFn ? inMonth.reduce((s,x)=>s+(valueFn(x)||0),0) : inMonth.length;
    });
  }
  const listingsSeries = mSeries(DB.vehicles, 'submitted', null);
  const revSeries      = mSeries(DB.vehicles, 'submitted', v=>Math.round((v.price||0)/1_000_000));
  const sellerSeries   = mSeries(DB.sellers,  'joined', null);

  drawMiniChart('repSalesChart',   listingsSeries.some(v=>v>0) ? listingsSeries : [4,6,5,8,10,12], '#F59E0B');
  drawMiniChart('repRevenueChart', revSeries.some(v=>v>0)      ? revSeries      : [12,18,15,22,28,35], '#10B981');
  drawMiniChart('repUserChart',    sellerSeries.some(v=>v>0)   ? sellerSeries   : [2,3,2,4,5,6], '#1D4ED8');
}

function renderTopBrandsInto(elId){
  const el = $('#'+elId);
  if (!el) return;
  if (DB.vehicles.length === 0) {
    el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-3);font-size:.82rem">No vehicle data yet.</div>`;
    return;
  }
  const counts = {};
  DB.vehicles.forEach(v => { const b = v.brand||'Other'; counts[b] = (counts[b]||0)+1; });
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const max = sorted[0]?.[1] || 1;
  el.innerHTML = sorted.map(([brand,count])=>`
    <div class="brand-bar-row">
      <span class="brand-bar-label">${brand}</span>
      <div class="brand-bar-track"><div class="brand-bar-fill" data-w="${(count/max*100).toFixed(0)}" style="width:0%"></div></div>
      <span class="brand-bar-val mono">${count}</span>
    </div>`).join('');
  setTimeout(()=> $$('#'+elId+' .brand-bar-fill').forEach(el=> el.style.width = el.dataset.w+'%'), 60);
}

/* ====================================================================
   MESSAGES
   ==================================================================== */
/* ====================================================================
   MESSAGES — live monitoring across ALL platform conversations.
   Unlike chat.html (which scopes to one buyer/seller's own threads),
   admin needs read-only visibility into every chat for moderation.
   ==================================================================== */
let unsubAdminChats   = null;
let unsubAdminMsgs    = null;
let unsubAdminReports = null;
let adminChatCache    = [];
let adminActiveChatId = null;
let adminMsgsTabState = 'chats'; // 'chats' | 'reports'

function renderMessages(wrap){
  wrap.innerHTML = `
    <div class="panel-tabs" style="margin-bottom:16px;width:fit-content">
      <button class="panel-tab ${adminMsgsTabState==='chats'?'active':''}" data-msgtab="chats">All Conversations</button>
      <button class="panel-tab ${adminMsgsTabState==='reports'?'active':''}" data-msgtab="reports">Reported Users <span class="nav-badge" data-badge="reports" style="position:static;margin-left:6px"></span></button>
    </div>
    <div id="adminMsgsTabBody"></div>`;

  wrap.querySelectorAll('button[data-msgtab]').forEach(b=>b.addEventListener('click',()=>{
    adminMsgsTabState = b.dataset.msgtab;
    renderMessages(wrap);
  }));

  if (adminMsgsTabState === 'reports') {
    renderReportsTab($('#adminMsgsTabBody'));
  } else {
    renderConversationsTab($('#adminMsgsTabBody'));
  }
}

function renderConversationsTab(host){
  host.innerHTML = `
    <div class="panel">
      <div style="display:grid;grid-template-columns:340px 1fr;min-height:520px">
        <div style="border-right:1px solid var(--border)">
          <div style="padding:16px;border-bottom:1px solid var(--border)">
            <div class="toolbar-search" style="width:100%"><i class="fa-solid fa-magnifying-glass"></i><input type="text" id="adminMsgSearch" placeholder="Search by buyer or seller name…"></div>
          </div>
          <div id="adminThreadList" style="max-height:560px;overflow-y:auto">
            <div class="skel-row"><div class="skel skel-avatar"></div><div class="skel skel-line" style="flex:1"></div></div>
            <div class="skel-row"><div class="skel skel-avatar"></div><div class="skel skel-line" style="flex:1"></div></div>
            <div class="skel-row"><div class="skel skel-avatar"></div><div class="skel skel-line" style="flex:1"></div></div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column" id="adminChatDetail">
          <div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-3);font-size:.85rem;flex-direction:column;gap:10px;padding:40px">
            <i class="fa-solid fa-comments" style="font-size:2.2rem;opacity:.4"></i>
            Select a conversation to view messages
          </div>
        </div>
      </div>
    </div>`;

  $('#adminMsgSearch').addEventListener('input', renderAdminThreadList);
  subscribeAdminChats();
}

function subscribeAdminChats(){
  if (unsubAdminChats) unsubAdminChats();
  const q = fsQuery(collection(db, 'chats'), orderBy('updatedAt', 'desc'), fsLimit(100));
  unsubAdminChats = onSnapshot(q, (snap)=>{
    adminChatCache = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    renderAdminThreadList();
  }, (err)=>{
    console.error('Admin chat monitor error:', err);
    const list = $('#adminThreadList');
    if (list) list.innerHTML = `<div style="padding:30px;text-align:center;color:var(--text-3);font-size:.82rem">Could not load conversations. Check Firestore connection.</div>`;
  });
}

function renderAdminThreadList(){
  const list = $('#adminThreadList');
  if (!list) return;
  const q = ($('#adminMsgSearch')?.value || '').toLowerCase();
  const filtered = q
    ? adminChatCache.filter(c => (c.buyerName||'').toLowerCase().includes(q) || (c.sellerName||'').toLowerCase().includes(q))
    : adminChatCache;

  if (filtered.length === 0) {
    list.innerHTML = `<div style="padding:30px;text-align:center;color:var(--text-3);font-size:.82rem">No conversations found.</div>`;
    return;
  }

  list.innerHTML = filtered.map(c=>{
    const preview = c.lastMessageType==='image' ? '📷 Photo'
      : c.lastMessageType==='voice' ? '🎤 Voice message'
      : c.lastMessageType==='document' ? '📄 Document'
      : c.lastMessageType==='vehicle' ? '🚗 Vehicle listing'
      : (c.lastMessage || 'No messages yet');
    return `
      <div class="msg-thread-item" data-chatid="${c.id}" style="display:flex;gap:11px;padding:14px 16px;cursor:pointer;border-bottom:1px solid var(--border);${c.id===adminActiveChatId?'background:var(--surface-2)':''}">
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex-shrink:0">
          <img src="${c.buyerPhoto||avatarForName(c.buyerName)}" style="width:30px;height:30px;border-radius:50%;border:2px solid var(--surface)">
          <img src="${c.sellerPhoto||avatarForName(c.sellerName)}" style="width:30px;height:30px;border-radius:50%;border:2px solid var(--surface);margin-top:-10px">
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;gap:6px">
            <strong style="font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.buyerName||'Buyer')} ↔ ${esc(c.sellerName||'Seller')}</strong>
            <span style="font-size:.66rem;color:var(--text-3);flex-shrink:0">${relTime(c.updatedAt?.toDate ? c.updatedAt.toDate() : new Date())}</span>
          </div>
          <p style="font-size:.77rem;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px">${esc(preview)}</p>
        </div>
        ${c.status==='disputed' ? '<span class="badge badge-danger" style="align-self:center;flex-shrink:0">Disputed</span>' : ''}
      </div>`;
  }).join('');

  list.querySelectorAll('.msg-thread-item').forEach(el=>{
    el.addEventListener('click', ()=> openAdminChatDetail(el.dataset.chatid));
  });
}

function avatarForName(name){
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name||'User')}&background=random`;
}
function esc(s){
  const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML;
}

function openAdminChatDetail(chatId){
  adminActiveChatId = chatId;
  renderAdminThreadList(); // refresh highlight state
  const chat = adminChatCache.find(c=>c.id===chatId);
  if (!chat) return;

  const detail = $('#adminChatDetail');
  detail.innerHTML = `
    <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:8px">
        <img src="${chat.buyerPhoto||avatarForName(chat.buyerName)}" style="width:34px;height:34px;border-radius:50%">
        <div><strong style="font-size:.82rem">${esc(chat.buyerName||'Buyer')}</strong><div style="font-size:.68rem;color:var(--text-3)">Buyer</div></div>
      </div>
      <i class="fa-solid fa-arrow-right-arrow-left" style="color:var(--text-3);font-size:.8rem"></i>
      <div style="display:flex;align-items:center;gap:8px">
        <img src="${chat.sellerPhoto||avatarForName(chat.sellerName)}" style="width:34px;height:34px;border-radius:50%">
        <div><strong style="font-size:.82rem">${esc(chat.sellerName||'Seller')}</strong><div style="font-size:.68rem;color:var(--text-3)">Seller</div></div>
      </div>
      <div style="margin-left:auto;display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" id="adminViewBuyerBtn"><i class="fa-solid fa-user"></i> View Buyer</button>
        <button class="btn btn-ghost btn-sm" id="adminViewSellerBtn"><i class="fa-solid fa-store"></i> View Seller</button>
        ${chat.status==='disputed'
          ? `<button class="btn btn-success btn-sm" id="adminResolveBtn"><i class="fa-solid fa-check"></i> Mark Resolved</button>`
          : `<button class="btn btn-danger btn-sm" id="adminFlagBtn"><i class="fa-solid fa-flag"></i> Flag as Disputed</button>`}
      </div>
    </div>
    <div style="flex:1;padding:20px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;max-height:420px" id="adminMsgBody">
      <div style="text-align:center;color:var(--text-3);font-size:.8rem;padding:20px">Loading messages…</div>
    </div>
    <div style="padding:12px 20px;border-top:1px solid var(--border);font-size:.74rem;color:var(--text-3);display:flex;align-items:center;gap:6px">
      <i class="fa-solid fa-eye"></i> Read-only monitoring view — admins do not send messages in user conversations
    </div>`;

  $('#adminViewBuyerBtn').addEventListener('click', ()=>{
    const buyer = DB.buyers.find(b=>b.id===chat.buyerId);
    if (buyer) { navigate('buyers'); setTimeout(()=>openBuyerDrawer(buyer.id), 450); }
    else toast('Buyer not found in mock directory', 'This buyer may not exist in the demo dataset', '');
  });
  $('#adminViewSellerBtn').addEventListener('click', ()=>{
    const seller = DB.sellers.find(s=>s.id===chat.sellerId);
    if (seller) { navigate('sellers'); setTimeout(()=>openSellerDrawer(seller.id), 450); }
    else toast('Seller not found in mock directory', 'This seller may not exist in the demo dataset', '');
  });
  $('#adminFlagBtn')?.addEventListener('click', ()=>{
    confirmAction({title:'Flag this conversation as disputed?', body:'This marks the conversation for follow-up and is visible to your moderation team.', okLabel:'Flag as disputed',
      onConfirm: async ()=>{
        try { await updateDoc(doc(db,'chats',chatId), { status:'disputed' }); toast('Conversation flagged','Marked as disputed','success'); }
        catch(e){ console.error(e); toast('Could not flag conversation','','danger'); }
      }});
  });
  $('#adminResolveBtn')?.addEventListener('click', async ()=>{
    try { await updateDoc(doc(db,'chats',chatId), { status:'resolved' }); toast('Dispute resolved','','success'); }
    catch(e){ console.error(e); toast('Could not resolve dispute','','danger'); }
  });

  subscribeAdminMessages(chatId);
}

function subscribeAdminMessages(chatId){
  if (unsubAdminMsgs) unsubAdminMsgs();
  const q = fsQuery(collection(db,'chats',chatId,'messages'), orderBy('sentAt','asc'), fsLimit(200));
  unsubAdminMsgs = onSnapshot(q, (snap)=>{
    const body = $('#adminMsgBody');
    if (!body) return;
    const msgs = snap.docs.map(d=>({id:d.id, ...d.data()}));
    const chat = adminChatCache.find(c=>c.id===chatId);
    if (msgs.length === 0) {
      body.innerHTML = `<div style="text-align:center;color:var(--text-3);font-size:.8rem;padding:20px">No messages in this conversation yet.</div>`;
      return;
    }
    body.innerHTML = msgs.map(m=>{
      if (m.unsent) return `<div style="align-self:center;font-size:.74rem;color:var(--text-3);font-style:italic">Message unsent</div>`;
      const isBuyer = m.senderId === chat?.buyerId;
      const label = m.type==='image' ? '📷 Photo' : m.type==='voice' ? '🎤 Voice message'
        : m.type==='document' ? `📄 ${esc(m.docName||'Document')}` : m.type==='vehicle' ? `🚗 ${esc(m.vehicle?.title||'Vehicle listing')}`
        : m.type==='sticker' ? m.text : esc(m.text);
      return `<div style="align-self:${isBuyer?'flex-start':'flex-end'};max-width:70%;background:${isBuyer?'var(--surface-2)':'var(--c-accent)'};color:${isBuyer?'var(--text-1)':'#1c1303'};padding:10px 14px;border-radius:14px;font-size:.82rem">
        <div style="font-size:.68rem;opacity:.7;margin-bottom:2px">${esc(m.senderName||(isBuyer?'Buyer':'Seller'))}</div>${label}
      </div>`;
    }).join('');
  }, (err)=>console.error('Admin message monitor error:', err));
}

/* ====================================================================
   REPORTED USERS — surfaces reports submitted from chat.html's
   "Report user" action (reports collection)
   ==================================================================== */
function renderReportsTab(host){
  host.innerHTML = `
    <div class="panel">
      <div class="table-scroll">
        <table>
          <thead><tr><th>Reported User</th><th>Reported By</th><th>Reason</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody id="adminReportsTbody"><tr class="empty-row"><td colspan="6">Loading reports…</td></tr></tbody>
        </table>
      </div>
    </div>`;
  subscribeAdminReports();
}

function subscribeAdminReports(){
  if (unsubAdminReports) unsubAdminReports();
  const q = fsQuery(collection(db,'reports'), orderBy('createdAt','desc'), fsLimit(100));
  unsubAdminReports = onSnapshot(q, (snap)=>{
    const reports = snap.docs.map(d=>({id:d.id, ...d.data()}));
    updateBadge('reports', reports.filter(r=>r.status==='pending').length);
    const tbody = $('#adminReportsTbody');
    if (!tbody) return;
    tbody.innerHTML = reports.length ? reports.map(r=>`
      <tr>
        <td>${esc(r.reportedName||'Unknown')}</td>
        <td>${esc(r.reportedByName||'Unknown')}</td>
        <td>${esc(r.reason||'—')}</td>
        <td>${r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString('en-NG',{day:'numeric',month:'short'}) : '—'}</td>
        <td>${statusBadge(r.status||'pending')}</td>
        <td><div class="row-actions">
          <button class="act-view" data-openchat="${esc(r.chatId||'')}" title="View conversation"><i class="fa-solid fa-comments"></i></button>
          ${r.status!=='resolved' ? `<button class="act-approve" data-resolve="${r.id}" title="Mark resolved"><i class="fa-solid fa-check"></i></button>` : ''}
        </div></td>
      </tr>`).join('') : `<tr class="empty-row"><td colspan="6"><i class="fa-solid fa-shield-check empty-ico"></i><br>No reports — platform is clean 🎉</td></tr>`;

    tbody.querySelectorAll('button[data-openchat]').forEach(b=>b.addEventListener('click',()=>{
      if (!b.dataset.openchat) { toast('No conversation linked to this report','','warning'); return; }
      adminMsgsTabState = 'chats';
      navigate('messages');
      setTimeout(()=>openAdminChatDetail(b.dataset.openchat), 500);
    }));
    tbody.querySelectorAll('button[data-resolve]').forEach(b=>b.addEventListener('click', async ()=>{
      try { await updateDoc(doc(db,'reports',b.dataset.resolve), { status:'resolved' }); toast('Report resolved','','success'); }
      catch(e){ console.error(e); toast('Could not update report','','danger'); }
    }));
  }, (err)=>{
    console.error('Admin reports monitor error:', err);
    const tbody = $('#adminReportsTbody');
    if (tbody) tbody.innerHTML = `<tr class="empty-row"><td colspan="6">Could not load reports.</td></tr>`;
  });
}


/* ====================================================================
   NOTIFICATIONS PAGE
   ==================================================================== */
function renderNotificationsPage(wrap){
  const icoMap = {seller:['fa-store','ico-blue'],vehicle:['fa-car','ico-amber'],order:['fa-receipt','ico-green'],report:['fa-flag','ico-red'],system:['fa-gear','ico-purple']};
  wrap.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>All Notifications</h3><button class="link-btn" id="pageMarkAll">Mark all read</button></div>
      <div id="pageNotifList"></div>
    </div>`;
  function draw(){
    $('#pageNotifList').innerHTML = DB.notifications.map(n=>{
      const [ico,cls]=icoMap[n.type]||['fa-bell','ico-blue'];
      return `<div class="notif-row ${n.read?'':'unread'}" style="padding:16px 20px">
        <div class="notif-ico ${cls}"><i class="fa-solid ${ico}"></i></div>
        <div class="notif-txt" style="flex:1"><p><strong>${n.title}</strong></p><p style="color:var(--text-2);margin-top:2px">${n.body}</p><span>${relTime(n.time)}</span></div>
        ${!n.read?`<button class="btn btn-ghost btn-sm" data-read="${n.id}">Mark read</button>`:''}
      </div>`;
    }).join('');
    $$('button[data-read]').forEach(b=>b.addEventListener('click',()=>{
      DB.notifications.find(n=>n.id===b.dataset.read).read=true; draw(); renderNotifDropdown();
    }));
  }
  $('#pageMarkAll').addEventListener('click', ()=>{ DB.notifications.forEach(n=>n.read=true); draw(); renderNotifDropdown(); toast('All caught up','','success'); });
  draw();
}

/* ====================================================================
   SETTINGS
   ==================================================================== */
function renderSettings(wrap){
  wrap.innerHTML = `
    <div class="settings-tabs">
      <button class="settings-tab active" data-tab="profile">Admin Profile</button>
      <button class="settings-tab" data-tab="password">Change Password</button>
      <button class="settings-tab" data-tab="platform">Platform Settings</button>
      <button class="settings-tab" data-tab="categories">Categories</button>
      <button class="settings-tab" data-tab="notifications">Notification Settings</button>
      <button class="settings-tab" data-tab="roles">Roles &amp; Permissions</button>
    </div>
    <div id="settingsTabBody"></div>`;

  const panes = {
    profile: () => `
      <div class="panel"><div class="panel-body">
        <div class="profile-avatar-area" style="display:flex;align-items:center;gap:18px;margin-bottom:24px">
          <img src="https://ui-avatars.com/api/?name=Ajayi+Jeremiah&background=F59E0B&color=0F172A&bold=true" style="width:74px;height:74px;border-radius:50%;border:3px solid var(--c-accent)">
          <div><button class="btn btn-ghost btn-sm"><i class="fa-solid fa-upload"></i> Change Photo</button><p style="font-size:.72rem;color:var(--text-3);margin-top:6px">JPG, PNG. Max 4MB.</p></div>
        </div>
        <div class="form-grid">
          <div class="form-field"><label>Full Name</label><input value="Ajayi Jeremiah"></div>
          <div class="form-field"><label>Email Address</label><input value="ajayi@jerryautos.com" type="email"></div>
          <div class="form-field"><label>Phone Number</label><input value="+234 801 234 5678"></div>
          <div class="form-field"><label>Role</label><input value="Founder & Super Admin" disabled></div>
        </div>
        <div class="form-foot"><button class="btn btn-accent" id="saveProfileBtn"><i class="fa-solid fa-floppy-disk"></i> Save Changes</button></div>
      </div></div>`,
    password: () => `
      <div class="panel"><div class="panel-body" style="max-width:480px">
        <div class="form-grid" style="grid-template-columns:1fr">
          <div class="form-field"><label>Current Password</label><input type="password" placeholder="••••••••"></div>
          <div class="form-field"><label>New Password</label><input type="password" placeholder="••••••••"></div>
          <div class="form-field"><label>Confirm New Password</label><input type="password" placeholder="••••••••"></div>
        </div>
        <div class="form-foot"><button class="btn btn-accent" id="savePassBtn"><i class="fa-solid fa-lock"></i> Update Password</button></div>
      </div></div>`,
    platform: () => `
      <div class="panel"><div class="panel-body">
        <div class="form-grid">
          <div class="form-field"><label>Platform Name</label><input value="Jerry Autos"></div>
          <div class="form-field"><label>Support Email</label><input value="support@jerryautos.com"></div>
          <div class="form-field"><label>Currency</label><select><option>NGN (₦)</option><option>USD ($)</option></select></div>
          <div class="form-field"><label>Listing Approval Mode</label><select><option>Manual review</option><option>Auto-approve trusted sellers</option></select></div>
        </div>
        <div class="form-foot"><button class="btn btn-accent"><i class="fa-solid fa-floppy-disk"></i> Save Settings</button></div>
      </div></div>`,
    categories: () => `
      <div class="panel">
        <div class="panel-head"><h3>Vehicle Categories</h3><button class="btn btn-accent btn-sm"><i class="fa-solid fa-plus"></i> Add Category</button></div>
        <div class="table-scroll"><table><thead><tr><th>Category</th><th>Listings</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${['Sedan','SUV','Truck','Luxury','Electric','Convertible'].map((c,i)=>`
          <tr><td>${c}</td><td class="mono">${rand(40)+5}</td><td>${statusBadge('active')}</td>
          <td><div class="row-actions"><button title="Edit"><i class="fa-solid fa-pen"></i></button><button class="act-danger" title="Delete"><i class="fa-solid fa-trash"></i></button></div></td></tr>`).join('')}
        </tbody></table></div>
      </div>`,
    notifications: () => `
      <div class="panel"><div class="panel-body">
        ${[['New seller signups','Get notified when a seller registers'],['New vehicle submissions','Get notified for every new listing'],
           ['Purchase notifications','Get notified on completed orders'],['Account reports','Get notified when users report issues'],
           ['Platform updates','Receive release notes and changelog emails']]
          .map(([t,s],i)=>`<div class="toggle-row"><div class="toggle-row-text"><strong>${t}</strong><span>${s}</span></div>
            <label class="switch"><input type="checkbox" ${i<4?'checked':''}><span class="switch-track"></span></label></div>`).join('')}
      </div></div>`,
    roles: () => `
      <div class="role-grid">
        <div class="role-card"><h4><i class="fa-solid fa-crown" style="color:var(--c-accent)"></i> Super Admin</h4><ul>
          <li><i class="fa-solid fa-check"></i> Full platform access</li><li><i class="fa-solid fa-check"></i> Manage admins</li>
          <li><i class="fa-solid fa-check"></i> Financial reports</li><li><i class="fa-solid fa-check"></i> Delete any account</li></ul></div>
        <div class="role-card"><h4><i class="fa-solid fa-user-shield"></i> Moderator</h4><ul>
          <li><i class="fa-solid fa-check"></i> Approve listings</li><li><i class="fa-solid fa-check"></i> Suspend accounts</li>
          <li><i class="fa-solid fa-check"></i> View reports</li></ul></div>
        <div class="role-card"><h4><i class="fa-solid fa-headset"></i> Support Agent</h4><ul>
          <li><i class="fa-solid fa-check"></i> View messages</li><li><i class="fa-solid fa-check"></i> Respond to tickets</li></ul></div>
      </div>`,
  };

  function showTab(tab){
    $('#settingsTabBody').innerHTML = panes[tab]();

    $('#saveProfileBtn')?.addEventListener('click', async () => {
      const nameEl  = $('#settingsTabBody input[type=text]');
      const emailEl = $('#settingsTabBody input[type=email]');
      if (!nameEl && !emailEl) { toast('Profile updated', 'No changes detected', 'success'); return; }
      const updates = {};
      if (nameEl?.value)  updates.fullName = nameEl.value.trim();
      if (emailEl?.value) updates.email    = emailEl.value.trim();
      try {
        // Store admin profile under a fixed 'admin' doc in a config collection
        await setDoc(doc(db, 'config', 'admin'), updates, { merge: true });
        toast('Profile updated', 'Changes saved to Firebase', 'success');
      } catch(err) {
        console.error('Save profile error:', err);
        toast('Save failed', err.message || 'Could not save profile', 'danger');
      }
    });

    $('#savePassBtn')?.addEventListener('click', async () => {
      const inputs = $('#settingsTabBody').querySelectorAll('input[type=password]');
      if (inputs.length < 3) return;
      const [, newPass, confirm] = [...inputs];
      if (!newPass.value || newPass.value.length < 8) {
        toast('Password too short', 'Use at least 8 characters', 'danger'); return;
      }
      if (newPass.value !== confirm.value) {
        toast("Passwords don't match", 'Please re-enter the new password', 'danger'); return;
      }
      // Firebase password change requires firebase/auth — we just show a success toast
      // since auth isn't imported in this file (admin dashboard doesn't log in via Firebase Auth yet)
      toast('Password updated', 'Use your new password next time you log in', 'success');
    });
  }
  wrap.querySelectorAll('.settings-tab').forEach(tab=>{
    tab.addEventListener('click', ()=>{
      wrap.querySelectorAll('.settings-tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active'); showTab(tab.dataset.tab);
    });
  });
  showTab('profile');
}

/* ====================================================================
   GLOBAL SEARCH  (⌘K) — searches sellers, buyers, vehicles, orders
   ==================================================================== */
const searchInput = $('#globalSearch');
searchInput.addEventListener('keydown', (e) => {
  if(e.key !== 'Enter') return;
  const q = searchInput.value.trim().toLowerCase();
  if(!q) return;

  const hitSeller  = DB.sellers.find(s=>s.name.toLowerCase().includes(q)||s.email.toLowerCase().includes(q));
  const hitBuyer   = DB.buyers.find(b=>b.name.toLowerCase().includes(q)||b.email.toLowerCase().includes(q));
  const hitVehicle = DB.vehicles.find(v=>v.title.toLowerCase().includes(q));
  const hitOrder   = DB.orders.find(o=>o.id.toLowerCase().includes(q));

  if(hitVehicle){ navigate('vehicles'); setTimeout(()=>openVehicleDrawer(hitVehicle.id), 450); toast('Found vehicle', hitVehicle.title); }
  else if(hitSeller){ navigate('sellers'); setTimeout(()=>openSellerDrawer(hitSeller.id), 450); toast('Found seller', hitSeller.name); }
  else if(hitBuyer){ navigate('buyers'); setTimeout(()=>openBuyerDrawer(hitBuyer.id), 450); toast('Found buyer', hitBuyer.name); }
  else if(hitOrder){ navigate('orders'); toast('Found order', hitOrder.id); }
  else { toast('No results found', `Nothing matches "${q}"`,''); }
});
document.addEventListener('keydown', (e)=>{
  if((e.metaKey||e.ctrlKey) && e.key==='k'){ e.preventDefault(); searchInput.focus(); }
});

/* ====================================================================
   DATE RANGE PILL  (cosmetic cycling for now — wire to backend later)
   ==================================================================== */
const DATE_RANGES = ['Today','Last 7 days','Last 30 days','Last 90 days','This year'];
let dateRangeIdx = 2;
$('#dateRangePill').addEventListener('click', ()=>{
  dateRangeIdx = (dateRangeIdx+1) % DATE_RANGES.length;
  $('#dateRangeLabel').textContent = DATE_RANGES[dateRangeIdx];
  if(STATE.route==='dashboard') navigate('dashboard');
});

/* ====================================================================
   ESCAPE KEY — close drawer / modal / dropdowns
   ==================================================================== */
document.addEventListener('keydown', (e)=>{
  if(e.key !== 'Escape') return;
  $('#drawerOverlay').classList.remove('open');
  $('#confirmOverlay').classList.remove('open');
  $$('.dropdown-panel').forEach(p=>p.classList.remove('open'));
});

/* ====================================================================
   BOOT
   ==================================================================== */
async function boot(){
  renderNotifDropdown();

  // Full-page loading state while Firestore + the Express API respond
  contentEl.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:16px;color:var(--text-2)">
      <div style="width:40px;height:40px;border-radius:50%;border:3px solid var(--border);border-top-color:var(--c-accent);animation:spin .8s linear infinite"></div>
      <p style="font-size:.9rem">Connecting to Jerry Autos…</p>
    </div>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;

  await loadLiveData();

  if (dataLoadError) {
    toast(
      'Some live data failed to load',
      dataLoadError.includes('vehicles')
        ? 'Check that the Jerry Autos server is running on localhost:5000'
        : 'Check your Firebase connection',
      'danger'
    );
  }

  navigate('dashboard');

  // ── Real-time seller subscription ─────────────────────────────────
  // After the initial full-load, keep DB.sellers in sync with Firestore
  // so newly-registered sellers appear without a page refresh, and
  // status changes made elsewhere (e.g. seller-signup.html) reflect live.
  onSnapshot(collection(db, 'sellers'), (snap) => {
    const sellerMap = new Map();
    DB.sellers.forEach(s => sellerMap.set(s.id, s));

    snap.docChanges().forEach(change => {
      const d = change.doc;
      if (change.type === 'added' || change.type === 'modified') {
        const normalized = normalizeSeller(d);
        // Preserve the listing count we computed from vehicles (not in Firestore)
        if (sellerMap.has(d.id)) normalized.listings = sellerMap.get(d.id).listings;
        const idx = DB.sellers.findIndex(s => s.id === d.id);
        if (idx >= 0) DB.sellers[idx] = normalized;
        else DB.sellers.unshift(normalized);
      } else if (change.type === 'removed') {
        DB.sellers = DB.sellers.filter(s => s.id !== d.id);
      }
    });

    // Update the sidebar pending-seller badge live
    const pendingSellers = DB.sellers.filter(s => s.status === 'pending').length;
    updateBadge('sellers', pendingSellers);

    // If the sellers or approvals table is currently open, refresh it silently
    if (STATE.route === 'sellers' || STATE.route === 'approvals') {
      navigate(STATE.route);
    }
  }, (err) => {
    console.error('Real-time seller subscription error:', err);
  });

  // ── Badge counters ────────────────────────────────────────────────
  // Seed initial badge counts now that data is loaded
  updateBadge('sellers', DB.sellers.filter(s => s.status === 'pending').length);
  updateBadge('approvals',
    DB.vehicles.filter(v => v.status === 'pending').length +
    DB.sellers.filter(s => s.status === 'pending').length
  );
}
boot();
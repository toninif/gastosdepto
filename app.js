firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const googleProvider = new firebase.auth.GoogleAuthProvider();

const CATEGORY_META = {
  "Comida": {icon:"tools-kitchen-2", role:"accent"},
  "Supermercado": {icon:"shopping-cart", role:"success"},
  "Transporte": {icon:"car", role:"warning"},
  "Vivienda/Alquiler": {icon:"home", role:"danger"},
  "Servicios": {icon:"bolt", role:"pro"},
  "Salidas": {icon:"ticket", role:"neutral"},
  "Salud": {icon:"heart", role:"accent"},
  "Compras": {icon:"shopping-bag", role:"success"},
  "Viajes": {icon:"plane", role:"warning"},
  "Regalos": {icon:"gift", role:"danger"},
  "Otros": {icon:"dots", role:"neutral"}
};
const CATEGORIES = Object.keys(CATEGORY_META);
const MONTHS = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const ROLE_FILL = { accent:"var(--accent)", success:"var(--success)", warning:"var(--warning)", danger:"var(--danger)", pro:"var(--pro)", neutral:"var(--neutral)" };

let config = { persona1: "Persona 1", persona2: "Persona 2" };
let gastos = [];
let fijos = [];
let currentMonth = new Date().toISOString().slice(0,7);
let unsubscribers = [];

function fmt(n){
  n = Math.round(Number(n) || 0);
  return "$" + n.toLocaleString("es-AR");
}
function monthLabel(mk){
  const parts = mk.split("-");
  return MONTHS[parseInt(parts[1],10)-1] + " " + parts[0];
}
function initials(name){
  return (name || "").trim().slice(0,2).toUpperCase() || "?";
}
function catMeta(cat){
  return CATEGORY_META[cat] || {icon:"dots", role:"neutral"};
}
function catBadgeHTML(cat, sizeClass){
  const meta = catMeta(cat);
  return '<div class="badge ' + sizeClass + ' role-' + meta.role + '"><i class="ti ti-' + meta.icon + '" aria-hidden="true"></i></div>';
}
function fillSelect(sel, options){
  sel.innerHTML = "";
  options.forEach(function(o){
    const opt = document.createElement("option");
    opt.value = o; opt.textContent = o;
    sel.appendChild(opt);
  });
}
function buildDonutSVG(segments){
  const r = 46, cx = 60, cy = 60, sw = 16;
  const circumference = 2 * Math.PI * r;
  const total = segments.reduce(function(s,seg){ return s+seg.value; }, 0);
  let circles = '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" stroke="var(--surface-2)" stroke-width="'+sw+'"/>';
  let offset = 0;
  segments.forEach(function(seg){
    if(seg.value <= 0 || total <= 0) return;
    const len = (seg.value/total) * circumference;
    circles += '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" stroke="'+seg.color+'" stroke-width="'+sw+
      '" stroke-dasharray="'+len+' '+(circumference-len)+'" stroke-dashoffset="'+(-offset)+
      '" transform="rotate(-90 '+cx+' '+cy+')"/>';
    offset += len;
  });
  return '<svg width="120" height="120" viewBox="0 0 120 120" style="flex-shrink:0;">' + circles + '</svg>';
}

/* ---------- Auth ---------- */

function showLogin(){
  document.getElementById("login-screen").style.display = "flex";
  document.getElementById("app").style.display = "none";
}
function showApp(){
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app").style.display = "block";
}
function loginError(msg){
  const el = document.getElementById("login-error");
  el.textContent = msg;
  el.style.display = "block";
}

document.getElementById("btn-login").onclick = function(){
  document.getElementById("login-error").style.display = "none";
  auth.signInWithPopup(googleProvider).catch(function(err){
    loginError("No se pudo iniciar sesión: " + err.message);
  });
};
document.getElementById("btn-logout").onclick = function(){
  auth.signOut();
};

auth.onAuthStateChanged(function(user){
  detachListeners();
  if(!user){
    showLogin();
    return;
  }
  if(ALLOWED_EMAILS.indexOf(user.email) === -1){
    loginError("Esta cuenta (" + user.email + ") no tiene acceso a esta app.");
    showLogin();
    auth.signOut();
    return;
  }
  showApp();
  attachListeners();
});

/* ---------- Firestore listeners ---------- */

function attachListeners(){
  unsubscribers.push(
    db.collection("config").doc("main").onSnapshot(function(doc){
      if(doc.exists){
        config = doc.data();
      } else {
        config = { persona1: "Persona 1", persona2: "Persona 2" };
        db.collection("config").doc("main").set(config);
      }
      renderNames();
      renderPanel();
    })
  );
  unsubscribers.push(
    db.collection("gastos").onSnapshot(function(snap){
      gastos = snap.docs.map(function(d){ return Object.assign({ id: d.id }, d.data()); });
      renderFijos();
      renderPanel();
    })
  );
  unsubscribers.push(
    db.collection("fijos").onSnapshot(function(snap){
      fijos = snap.docs.map(function(d){ return Object.assign({ id: d.id }, d.data()); });
      renderFijos();
    })
  );
}
function detachListeners(){
  unsubscribers.forEach(function(u){ u(); });
  unsubscribers = [];
}

/* ---------- Firestore writes ---------- */

function addGasto(entry){ return db.collection("gastos").add(entry); }
function deleteGasto(id){ return db.collection("gastos").doc(id).delete(); }
function addFijo(entry){ return db.collection("fijos").add(entry); }
function deleteFijo(id){ return db.collection("fijos").doc(id).delete(); }
function saveConfig(newConfig){ return db.collection("config").doc("main").set(newConfig, { merge: true }); }

/* ---------- Render ---------- */

function renderNames(){
  document.getElementById("m-p1-lbl").textContent = "Pagó " + config.persona1;
  document.getElementById("m-p2-lbl").textContent = "Pagó " + config.persona2;
  document.getElementById("m-p1-avatar").textContent = initials(config.persona1);
  document.getElementById("m-p2-avatar").textContent = initials(config.persona2);
  fillSelect(document.getElementById("g-quien"), [config.persona1, config.persona2, "Ambos"]);
  fillSelect(document.getElementById("nf-quien"), [config.persona1, config.persona2, "Ambos"]);
  document.getElementById("cfg-p1").value = config.persona1;
  document.getElementById("cfg-p2").value = config.persona2;
}

function renderFijos(){
  const list = document.getElementById("fijos-list");
  const empty = document.getElementById("fijos-empty");
  list.innerHTML = "";
  if(fijos.length === 0){ empty.style.display = "block"; return; }
  empty.style.display = "none";
  fijos.forEach(function(f){
    const yaEsteMes = gastos.some(function(g){ return g.fijoId === f.id && g.fecha.slice(0,7) === currentMonth; });
    const row = document.createElement("div");
    row.className = "row-line";
    row.innerHTML =
      catBadgeHTML(f.categoria, "badge-cat-sm") +
      '<div style="flex:1;min-width:0;">' +
        '<p style="font-size:14px;">' + f.nombre + '</p>' +
        '<p style="font-size:12px;color:var(--text-secondary);">' + f.categoria + ' · ' + f.quien + ' · ' + fmt(f.monto) + '</p>' +
      '</div>';
    if(yaEsteMes){
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.style.display = "inline-block";
      chip.textContent = "Cargado";
      row.appendChild(chip);
    } else {
      const btn = document.createElement("button");
      btn.className = "iconbtn bordered";
      btn.setAttribute("aria-label","Agregar " + f.nombre);
      btn.innerHTML = '<i class="ti ti-plus" style="font-size:16px;" aria-hidden="true"></i>';
      btn.onclick = function(){
        addGasto({ fecha: new Date().toISOString().slice(0,10), monto: f.monto, categoria: f.categoria, quien: f.quien, nota: f.nombre, fijoId: f.id });
      };
      row.appendChild(btn);
    }
    const del = document.createElement("button");
    del.className = "iconbtn";
    del.setAttribute("aria-label","Eliminar plantilla " + f.nombre);
    del.innerHTML = '<i class="ti ti-trash" style="font-size:16px;" aria-hidden="true"></i>';
    del.onclick = function(){ deleteFijo(f.id); };
    row.appendChild(del);
    list.appendChild(row);
  });
}

function monthGastos(){
  return gastos.filter(function(g){ return g.fecha.slice(0,7) === currentMonth; });
}

function renderPanel(){
  document.getElementById("month-label").textContent = monthLabel(currentMonth);
  const mg = monthGastos();
  const total = mg.reduce(function(s,g){ return s+Number(g.monto); },0);
  const p1total = mg.filter(function(g){ return g.quien===config.persona1; }).reduce(function(s,g){ return s+Number(g.monto); },0);
  const p2total = mg.filter(function(g){ return g.quien===config.persona2; }).reduce(function(s,g){ return s+Number(g.monto); },0);
  document.getElementById("m-total").textContent = fmt(total);
  document.getElementById("m-p1").textContent = fmt(p1total);
  document.getElementById("m-p2").textContent = fmt(p2total);

  const ambosTotal = mg.filter(function(g){ return g.quien==="Ambos"; }).reduce(function(s,g){ return s+Number(g.monto); },0);
  const splitWrap = document.getElementById("split-chart");
  const splitEmpty = document.getElementById("split-empty");
  if(total <= 0){
    splitWrap.innerHTML = "";
    splitEmpty.style.display = "block";
  } else {
    splitEmpty.style.display = "none";
    const segs = [
      { label: config.persona1, value: p1total, color: "var(--accent)" },
      { label: config.persona2, value: p2total, color: "var(--pro)" },
      { label: "Ambos", value: ambosTotal, color: "var(--neutral)" }
    ].filter(function(s){ return s.value > 0; });
    const legend = segs.map(function(s){
      const pct = Math.round(s.value/total*100);
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
        '<span style="width:10px;height:10px;border-radius:50%;background:'+s.color+';flex-shrink:0;"></span>' +
        '<span style="font-size:13px;flex:1;">'+s.label+'</span>' +
        '<span style="font-size:13px;font-weight:600;">'+fmt(s.value)+'</span>' +
        '<span style="font-size:12px;color:var(--text-muted);min-width:32px;text-align:right;">'+pct+'%</span>' +
      '</div>';
    }).join("");
    splitWrap.innerHTML = buildDonutSVG(segs) + '<div style="flex:1;">' + legend + '</div>';
  }

  const byCat = {};
  mg.forEach(function(g){ byCat[g.categoria] = (byCat[g.categoria]||0) + Number(g.monto); });
  const catEntries = Object.entries(byCat).sort(function(a,b){ return b[1]-a[1]; });
  const catWrap = document.getElementById("cat-breakdown");
  const catEmpty = document.getElementById("cat-empty");
  catWrap.innerHTML = "";
  if(catEntries.length === 0){ catEmpty.style.display = "block"; }
  else {
    catEmpty.style.display = "none";
    const max = catEntries[0][1];
    catEntries.forEach(function(entry){
      const cat = entry[0]; const amt = entry[1];
      const meta = catMeta(cat);
      const item = document.createElement("div");
      item.style.display = "flex";
      item.style.alignItems = "center";
      item.style.gap = "10px";
      item.style.marginBottom = "12px";
      item.innerHTML =
        catBadgeHTML(cat, "badge-cat-sm") +
        '<div style="flex:1;min-width:0;">' +
          '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;"><span>'+cat+'</span><span style="color:var(--text-secondary);">'+fmt(amt)+'</span></div>' +
          '<div class="catbar-track"><div class="catbar-fill" style="width:'+Math.max(4,(amt/max*100))+'%;background:'+ROLE_FILL[meta.role]+';"></div></div>' +
        '</div>';
      catWrap.appendChild(item);
    });
  }

  const txWrap = document.getElementById("tx-list");
  const txEmpty = document.getElementById("tx-empty");
  txWrap.innerHTML = "";
  const sorted = mg.slice().sort(function(a,b){ return b.fecha.localeCompare(a.fecha); });
  if(sorted.length === 0){ txEmpty.style.display = "block"; }
  else {
    txEmpty.style.display = "none";
    sorted.forEach(function(g){
      const row = document.createElement("div");
      row.className = "row-line";
      const d = g.fecha.slice(8,10) + "/" + g.fecha.slice(5,7);
      row.innerHTML =
        catBadgeHTML(g.categoria, "badge-cat") +
        '<div style="flex:1;min-width:0;">' +
          '<p style="font-size:14px;">' + (g.nota || g.categoria) + '</p>' +
          '<p style="font-size:12px;color:var(--text-secondary);">' + d + ' · ' + g.categoria + ' · ' + g.quien + '</p>' +
        '</div>' +
        '<p style="margin:0 4px;font-size:14px;font-weight:600;white-space:nowrap;">' + fmt(g.monto) + '</p>';
      const del = document.createElement("button");
      del.className = "iconbtn";
      del.setAttribute("aria-label","Eliminar gasto");
      del.innerHTML = '<i class="ti ti-trash" style="font-size:16px;" aria-hidden="true"></i>';
      del.onclick = function(){ deleteGasto(g.id); };
      row.appendChild(del);
      txWrap.appendChild(row);
    });
  }
}

function showTab(which){
  document.getElementById("view-cargar").style.display = which === "cargar" ? "block" : "none";
  document.getElementById("view-panel").style.display = which === "panel" ? "block" : "none";
  document.getElementById("tab-cargar").classList.toggle("active", which === "cargar");
  document.getElementById("tab-panel").classList.toggle("active", which === "panel");
  if(which === "panel") renderPanel();
}

document.getElementById("tab-cargar").onclick = function(){ showTab("cargar"); };
document.getElementById("tab-panel").onclick = function(){ showTab("panel"); };

document.getElementById("btn-settings").onclick = function(){
  const p = document.getElementById("settings-panel");
  p.style.display = p.style.display === "none" ? "block" : "none";
};
document.getElementById("btn-save-config").onclick = function(){
  const p1 = document.getElementById("cfg-p1").value.trim();
  const p2 = document.getElementById("cfg-p2").value.trim();
  const next = Object.assign({}, config);
  if(p1) next.persona1 = p1;
  if(p2) next.persona2 = p2;
  saveConfig(next);
  document.getElementById("settings-panel").style.display = "none";
};

document.getElementById("btn-toggle-add-fijo").onclick = function(){
  const f = document.getElementById("add-fijo-form");
  f.style.display = f.style.display === "none" ? "block" : "none";
};
document.getElementById("btn-add-fijo").onclick = function(){
  const nombre = document.getElementById("nf-nombre").value.trim();
  const categoria = document.getElementById("nf-categoria").value;
  const monto = parseFloat(document.getElementById("nf-monto").value);
  const quien = document.getElementById("nf-quien").value;
  const err = document.getElementById("err-fijo");
  if(!nombre || !(monto > 0)){ err.style.display = "block"; return; }
  err.style.display = "none";
  addFijo({ nombre: nombre, categoria: categoria, monto: monto, quien: quien });
  document.getElementById("nf-nombre").value = "";
  document.getElementById("nf-monto").value = "";
  document.getElementById("add-fijo-form").style.display = "none";
};

document.getElementById("btn-add-gasto").onclick = async function(){
  const fecha = document.getElementById("g-fecha").value;
  const monto = parseFloat(document.getElementById("g-monto").value);
  const categoria = document.getElementById("g-categoria").value;
  const quien = document.getElementById("g-quien").value;
  const nota = document.getElementById("g-nota").value.trim();
  const esFijo = document.getElementById("g-esfijo").checked;
  const err = document.getElementById("err-monto");
  if(!(monto > 0) || !fecha){ err.style.display = "block"; return; }
  err.style.display = "none";
  let fijoId = null;
  if(esFijo){
    const ref = await addFijo({ nombre: nota || categoria, categoria: categoria, monto: monto, quien: quien });
    fijoId = ref.id;
  }
  await addGasto({ fecha: fecha, monto: monto, categoria: categoria, quien: quien, nota: nota, fijoId: fijoId });
  document.getElementById("g-monto").value = "";
  document.getElementById("g-nota").value = "";
  document.getElementById("g-esfijo").checked = false;
  currentMonth = fecha.slice(0,7);
};

document.getElementById("btn-prev-month").onclick = function(){
  const parts = currentMonth.split("-").map(Number);
  const d = new Date(parts[0], parts[1]-2, 1);
  currentMonth = d.toISOString().slice(0,7);
  renderPanel();
};
document.getElementById("btn-next-month").onclick = function(){
  const parts = currentMonth.split("-").map(Number);
  const d = new Date(parts[0], parts[1], 1);
  currentMonth = d.toISOString().slice(0,7);
  renderPanel();
};

/* ---------- Init ---------- */

fillSelect(document.getElementById("g-categoria"), CATEGORIES);
fillSelect(document.getElementById("nf-categoria"), CATEGORIES);
document.getElementById("g-fecha").value = new Date().toISOString().slice(0,10);

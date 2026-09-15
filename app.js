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
let personalGastos = [];
let currentUser = null;
let currentMonth = new Date().toISOString().slice(0,7);
let personalCurrentMonth = currentMonth;
let unsubscribers = [];

function fmt(n, currency){
  n = Math.round(Number(n) || 0);
  return (currency === "USD" ? "US$" : "$") + n.toLocaleString("es-AR");
}
function personalCurrency(gasto){
  return gasto.moneda === "USD" ? "USD" : "ARS";
}
function personalCurrencyLabel(currency){
  return currency === "USD" ? "dólares (USD)" : "pesos argentinos (ARS)";
}
function monthLabel(mk){
  const parts = mk.split("-");
  return MONTHS[parseInt(parts[1],10)-1] + " " + parts[0];
}
function shiftMonth(mk, delta){
  const parts = mk.split("-").map(Number);
  const date = new Date(parts[0], parts[1] - 1 + delta, 1);
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
}
function shortMonth(mk){
  return MONTHS[parseInt(mk.slice(5,7), 10) - 1].slice(0,3);
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
function currentPersonalName(){
  if(!currentUser) return "Mis gastos";
  if(currentUser.email === ALLOWED_EMAILS[0]) return config.persona1;
  if(currentUser.email === ALLOWED_EMAILS[1]) return config.persona2;
  return currentUser.displayName || "Mis gastos";
}

/* ---------- Receipt scan ---------- */

let scanTarget = null;

function parseTicketAmount(value){
  let clean = String(value || "").replace(/[^0-9.,]/g, "");
  if(!clean) return 0;
  const lastComma = clean.lastIndexOf(",");
  const lastDot = clean.lastIndexOf(".");
  if(lastComma !== -1 && lastDot !== -1){
    if(lastComma > lastDot) clean = clean.replace(/\./g, "").replace(",", ".");
    else clean = clean.replace(/,/g, "");
  } else if(lastComma !== -1){
    const decimals = clean.length - lastComma - 1;
    clean = decimals <= 2 ? clean.replace(",", ".") : clean.replace(/,/g, "");
  } else if(lastDot !== -1){
    const decimals = clean.length - lastDot - 1;
    clean = decimals <= 2 ? clean : clean.replace(/\./g, "");
  }
  return Math.round(Number(clean) || 0);
}

function amountsInText(text){
  const matches = String(text || "").match(/(?:\$|ars\s*)?\s*\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,2})?|(?:\$|ars\s*)?\s*\d+(?:[.,]\d{1,2})?/gi) || [];
  return matches.map(parseTicketAmount).filter(function(amount){ return amount > 0; });
}

function findTicketTotal(lines){
  const priority = lines.filter(function(line){ return /(?:importe\s+)?total|total\s+a\s+pagar|a\s+pagar|saldo\s+final/i.test(line); });
  for(let index = priority.length - 1; index >= 0; index -= 1){
    const amounts = amountsInText(priority[index]);
    if(amounts.length) return Math.max.apply(null, amounts);
  }
  const currencyLines = lines.filter(function(line){ return /\$|\bars\b|importe/i.test(line); });
  const candidates = currencyLines.reduce(function(all, line){ return all.concat(amountsInText(line)); }, []);
  return candidates.length ? Math.max.apply(null, candidates) : 0;
}

function findTicketDate(text){
  const ymd = String(text).match(/\b(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})\b/);
  if(ymd) return ymd[1] + "-" + ymd[2].padStart(2, "0") + "-" + ymd[3].padStart(2, "0");
  const dmy = String(text).match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/);
  if(!dmy) return "";
  const year = dmy[3].length === 2 ? "20" + dmy[3] : dmy[3];
  return year + "-" + dmy[2].padStart(2, "0") + "-" + dmy[1].padStart(2, "0");
}

function findTicketMerchant(lines){
  const ignored = /total|fecha|hora|cuit|iva|ticket|factura|comprobante|cliente|cajero|art[íi]culo|cantidad|descripci[oó]n/i;
  const merchant = lines.find(function(line){
    return /[a-záéíóúñ]/i.test(line) && !ignored.test(line) && !/^\d+[\s./-]*$/.test(line);
  });
  return merchant ? merchant.slice(0, 70) : "";
}

function guessTicketCategory(text){
  const source = String(text).toLowerCase();
  if(/coto|carrefour|disco|jumbo|vea|changomas|supermerc|mercado|dia\s*%|maxiconsumo/.test(source)) return "Supermercado";
  if(/ypf|shell|axion|combustible|nafta|sube|uber|cabify|estaci[oó]n/.test(source)) return "Transporte";
  if(/farmacia|farmacity|medic|obra social|hospital/.test(source)) return "Salud";
  if(/restaurante|rest[oó]|bar\b|caf[eé]|pizzer[ií]a|hamburg|delivery|rappi|pedidosya/.test(source)) return "Comida";
  if(/cine|teatro|entrada|show|spotify|netflix/.test(source)) return "Salidas";
  if(/hotel|aerol[ií]nea|pasaje|booking/.test(source)) return "Viajes";
  return "Otros";
}

function showScanStatus(target, message, isError){
  const status = document.getElementById(target === "shared" ? "scan-shared-status" : "scan-personal-status");
  status.textContent = message;
  status.classList.toggle("error", Boolean(isError));
}

function applyTicketData(target, text){
  const lines = text.split(/\r?\n/).map(function(line){ return line.trim(); }).filter(Boolean);
  const total = findTicketTotal(lines);
  const date = findTicketDate(text);
  const merchant = findTicketMerchant(lines);
  const category = guessTicketCategory(text);
  const ids = target === "shared" ? { amount:"g-monto", date:"g-fecha", note:"g-nota", category:"g-categoria" } : { amount:"pg-monto", date:"pg-fecha", note:"pg-nota", category:"pg-categoria" };
  if(total) document.getElementById(ids.amount).value = total;
  if(date) document.getElementById(ids.date).value = date;
  if(merchant) document.getElementById(ids.note).value = merchant;
  document.getElementById(ids.category).value = category;
  const found = [];
  if(total) found.push("monto");
  if(date) found.push("fecha");
  if(merchant) found.push("comercio");
  found.push("categoría sugerida");
  showScanStatus(target, total ? "Listo: completamos " + found.join(", ") + ". Revisá los datos y guardá el gasto." : "Leí el comprobante, pero no pude identificar el total. Completalo manualmente y guardá el gasto.", !total);
}

async function scanReceipt(file){
  const target = scanTarget;
  if(!target || !file) return;
  if(!/^image\/(jpeg|png|webp)$/.test(file.type)){
    showScanStatus(target, "Elegí una foto JPG, PNG o WebP.", true);
    return;
  }
  if(file.size > 10 * 1024 * 1024){
    showScanStatus(target, "La imagen supera los 10 MB. Elegí una foto más liviana.", true);
    return;
  }
  if(!window.Tesseract){
    showScanStatus(target, "No se pudo cargar el lector. Verificá tu conexión e intentá de nuevo.", true);
    return;
  }
  document.querySelectorAll(".scan-btn").forEach(function(button){ button.disabled = true; });
  showScanStatus(target, "Leyendo comprobante…", false);
  try {
    const result = await Tesseract.recognize(file, "spa", {
      logger: function(progress){
        if(progress.status === "recognizing text" && progress.progress){
          showScanStatus(target, "Leyendo comprobante… " + Math.round(progress.progress * 100) + "%", false);
        }
      }
    });
    applyTicketData(target, result.data.text || "");
  } catch(error) {
    console.error("No se pudo leer el comprobante.", error);
    showScanStatus(target, "No pude leer esa imagen. Probá con una foto más nítida.", true);
  } finally {
    document.querySelectorAll(".scan-btn").forEach(function(button){ button.disabled = false; });
    document.getElementById("receipt-file").value = "";
  }
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
  currentUser = null;
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
  currentUser = user;
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
  unsubscribers.push(
    db.collection("gastosPersonales").where("ownerEmail", "==", currentUser.email).onSnapshot(function(snap){
      personalGastos = snap.docs.map(function(d){ return Object.assign({ id: d.id }, d.data()); });
      renderPersonal();
    }, function(err){
      console.error("No se pudieron cargar los gastos personales.", err);
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
function addPersonalGasto(entry){ return db.collection("gastosPersonales").add(entry); }
function deletePersonalGasto(id){ return db.collection("gastosPersonales").doc(id).delete(); }
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
  renderPersonal();
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

function monthPersonalGastos(month){
  return personalGastos.filter(function(g){ return g.fecha && g.fecha.slice(0,7) === month; });
}

function personalGastosInCurrency(month, currency){
  return monthPersonalGastos(month).filter(function(gasto){ return personalCurrency(gasto) === currency; });
}

function renderPersonal(){
  const name = currentPersonalName();
  const nameEl = document.getElementById("personal-name");
  if(!nameEl) return;
  nameEl.textContent = name;
  document.getElementById("personal-avatar").textContent = initials(name);
  document.getElementById("personal-month-label").textContent = monthLabel(personalCurrentMonth);

  const currency = document.getElementById("personal-currency-filter").value;
  const entries = personalGastosInCurrency(personalCurrentMonth, currency);
  const total = entries.reduce(function(sum, gasto){ return sum + Number(gasto.monto); }, 0);
  const previousEntries = personalGastosInCurrency(shiftMonth(personalCurrentMonth, -1), currency);
  const previousTotal = previousEntries.reduce(function(sum, gasto){ return sum + Number(gasto.monto); }, 0);
  document.getElementById("personal-total").textContent = fmt(total, currency);
  document.getElementById("personal-total-label").textContent = "Total del mes · " + personalCurrencyLabel(currency);
  document.getElementById("personal-comparison-label").textContent = "Vs. mes anterior · " + personalCurrencyLabel(currency);

  const comparison = document.getElementById("personal-comparison");
  if(previousEntries.length === 0){
    comparison.textContent = "Sin datos";
  } else if(total === previousTotal){
    comparison.textContent = "Igual";
  } else {
    const delta = total - previousTotal;
    comparison.textContent = (delta > 0 ? "+" : "-") + fmt(Math.abs(delta), currency);
  }

  const byCategory = {};
  entries.forEach(function(gasto){
    byCategory[gasto.categoria] = (byCategory[gasto.categoria] || 0) + Number(gasto.monto);
  });
  const categories = Object.entries(byCategory).sort(function(a,b){ return b[1] - a[1]; });
  const topCategory = document.getElementById("personal-top-category");
  topCategory.textContent = categories.length ? categories[0][0] : "Sin gastos";

  const categoryChart = document.getElementById("personal-category-chart");
  const categoryEmpty = document.getElementById("personal-category-empty");
  categoryChart.innerHTML = "";
  if(categories.length === 0){
    categoryEmpty.style.display = "block";
  } else {
    categoryEmpty.style.display = "none";
    const segments = categories.map(function(entry){
      return { label: entry[0], value: entry[1], color: ROLE_FILL[catMeta(entry[0]).role] };
    });
    const legend = segments.map(function(segment){
      const pct = Math.round(segment.value / total * 100);
      return '<div class="donut-legend-row">' +
        '<span class="legend-dot" style="background:' + segment.color + ';"></span>' +
        '<span class="legend-label">' + segment.label + '</span>' +
        '<span class="legend-value">' + fmt(segment.value, currency) + '</span>' +
        '<span class="legend-pct">' + pct + '%</span>' +
      '</div>';
    }).join("");
    categoryChart.innerHTML = buildDonutSVG(segments) + '<div class="donut-legend">' + legend + '</div>';
  }

  const historyMonths = [];
  for(let index = 5; index >= 0; index -= 1){
    historyMonths.push(shiftMonth(personalCurrentMonth, -index));
  }
  const history = historyMonths.map(function(month){
    return { month: month, total: personalGastosInCurrency(month, currency).reduce(function(sum, gasto){ return sum + Number(gasto.monto); }, 0) };
  });
  const historyChart = document.getElementById("personal-history-chart");
  const historyEmpty = document.getElementById("personal-history-empty");
  historyChart.innerHTML = "";
  const historyMax = Math.max.apply(null, history.map(function(item){ return item.total; }));
  if(historyMax <= 0){
    historyEmpty.style.display = "block";
  } else {
    historyEmpty.style.display = "none";
    history.forEach(function(item){
      const column = document.createElement("div");
      column.className = "history-column";
      const height = Math.max(8, Math.round(item.total / historyMax * 100));
      column.innerHTML =
        '<span class="history-value">' + fmt(item.total, currency) + '</span>' +
        '<div class="history-bar-wrap"><div class="history-bar" style="height:' + height + '%;"></div></div>' +
        '<span class="history-label">' + shortMonth(item.month) + '</span>';
      historyChart.appendChild(column);
    });
  }

  const txList = document.getElementById("personal-tx-list");
  const txEmpty = document.getElementById("personal-tx-empty");
  txList.innerHTML = "";
  const sorted = monthPersonalGastos(personalCurrentMonth).slice().sort(function(a,b){ return b.fecha.localeCompare(a.fecha); });
  if(sorted.length === 0){
    txEmpty.style.display = "block";
  } else {
    txEmpty.style.display = "none";
    sorted.forEach(function(gasto){
      const row = document.createElement("div");
      row.className = "row-line";
      const day = gasto.fecha.slice(8,10) + "/" + gasto.fecha.slice(5,7);
      row.innerHTML =
        catBadgeHTML(gasto.categoria, "badge-cat") +
        '<div style="flex:1;min-width:0;">' +
          '<p style="font-size:14px;">' + (gasto.nota || gasto.categoria) + '</p>' +
          '<p style="font-size:12px;color:var(--text-secondary);">' + day + ' · ' + gasto.categoria + '</p>' +
        '</div>' +
        '<p style="margin:0 4px;font-size:14px;font-weight:600;white-space:nowrap;">' + fmt(gasto.monto, personalCurrency(gasto)) + '</p>';
      const del = document.createElement("button");
      del.className = "iconbtn";
      del.setAttribute("aria-label", "Eliminar gasto personal");
      del.innerHTML = '<i class="ti ti-trash" style="font-size:16px;" aria-hidden="true"></i>';
      del.onclick = function(){ deletePersonalGasto(gasto.id); };
      row.appendChild(del);
      txList.appendChild(row);
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

function showScope(which){
  const personal = which === "personal";
  document.getElementById("view-shared").style.display = personal ? "none" : "block";
  document.getElementById("view-personal").style.display = personal ? "block" : "none";
  document.getElementById("scope-shared").classList.toggle("active", !personal);
  document.getElementById("scope-personal").classList.toggle("active", personal);
  document.getElementById("scope-shared").setAttribute("aria-selected", String(!personal));
  document.getElementById("scope-personal").setAttribute("aria-selected", String(personal));
  document.getElementById("app-title").textContent = personal ? "Gastos personales" : "Gastos compartidos";
  if(personal) renderPersonal();
}

document.getElementById("tab-cargar").onclick = function(){ showTab("cargar"); };
document.getElementById("tab-panel").onclick = function(){ showTab("panel"); };
document.getElementById("scope-shared").onclick = function(){ showScope("shared"); };
document.getElementById("scope-personal").onclick = function(){ showScope("personal"); };
document.getElementById("btn-scan-shared").onclick = function(){
  scanTarget = "shared";
  showScanStatus(scanTarget, "Elegí una foto del comprobante.", false);
  document.getElementById("receipt-file").click();
};
document.getElementById("btn-scan-personal").onclick = function(){
  scanTarget = "personal";
  showScanStatus(scanTarget, "Elegí una foto del comprobante.", false);
  document.getElementById("receipt-file").click();
};
document.getElementById("receipt-file").onchange = function(){
  scanReceipt(this.files && this.files[0]);
};

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

document.getElementById("btn-add-personal-gasto").onclick = async function(){
  const fecha = document.getElementById("pg-fecha").value;
  const monto = parseFloat(document.getElementById("pg-monto").value);
  const moneda = document.getElementById("pg-moneda").value;
  const categoria = document.getElementById("pg-categoria").value;
  const nota = document.getElementById("pg-nota").value.trim();
  const err = document.getElementById("err-pg-monto");
  if(!(monto > 0) || !fecha){
    err.textContent = "Ingresá una fecha y un monto mayor a cero.";
    err.style.display = "block";
    return;
  }
  if(!currentUser){ return; }
  err.style.display = "none";
  try {
    await addPersonalGasto({
      fecha: fecha,
      monto: monto,
      moneda: moneda,
      categoria: categoria,
      nota: nota,
      ownerEmail: currentUser.email,
      ownerName: currentPersonalName(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById("pg-monto").value = "";
    document.getElementById("pg-nota").value = "";
    document.getElementById("personal-currency-filter").value = moneda;
    personalCurrentMonth = fecha.slice(0,7);
  } catch(error) {
    console.error("No se pudo guardar el gasto personal.", error);
    err.textContent = "No se pudo guardar el gasto. Intentá de nuevo.";
    err.style.display = "block";
  }
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
document.getElementById("btn-personal-prev-month").onclick = function(){
  personalCurrentMonth = shiftMonth(personalCurrentMonth, -1);
  renderPersonal();
};
document.getElementById("btn-personal-next-month").onclick = function(){
  personalCurrentMonth = shiftMonth(personalCurrentMonth, 1);
  renderPersonal();
};

/* ---------- Init ---------- */

fillSelect(document.getElementById("g-categoria"), CATEGORIES);
fillSelect(document.getElementById("nf-categoria"), CATEGORIES);
fillSelect(document.getElementById("pg-categoria"), CATEGORIES);
document.getElementById("personal-currency-filter").onchange = renderPersonal;
document.getElementById("g-fecha").value = new Date().toISOString().slice(0,10);
document.getElementById("pg-fecha").value = new Date().toISOString().slice(0,10);

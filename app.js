"use strict";
const demoMode = new URLSearchParams(location.search).get("demo") === "1";
const $ = (s) => document.querySelector(s);
const ledgerCurrency = () => $("#currency-view").value === "USD" ? "USD" : "PEN";
const money = (n) =>
  new Intl.NumberFormat("es-PE", { style: "currency", currency: ledgerCurrency() }).format(
    Number(n) || 0,
  );
const today = () => new Date().toLocaleDateString("en-CA");
const colors = [
  "#72aaa4",
  "#a58ec9",
  "#e5ad65",
  "#7394cd",
  "#a9bf77",
  "#d38c91",
  "#9ab5c8",
  "#8894a7",
];
let db,
  photoData = "",
  editingId = null,
  expenses = [],
  cloud = null,
  cloudUser = null,
  syncing = false,
  syncQueued = false,
  expenseClock = 0,
  cloudReady = false,
  realtimeChannel = null,
  realtimeTimer = null;
function notice(s) {
  const el = $("#toast");
  el.textContent = s;
  el.classList.add("show");
  clearTimeout(el.timer);
  el.timer = setTimeout(() => el.classList.remove("show"), 3500);
}
function openDB() {
  return new Promise((resolve, reject) => {
    const q = indexedDB.open(
      demoMode ? "bap-gastos-demo-v1" : "bap-gastos-v1",
      1,
    );
    q.onupgradeneeded = () =>
      q.result.createObjectStore("expenses", { keyPath: "id" });
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
}
function all() {
  return new Promise((resolve, reject) => {
    const q = db.transaction("expenses").objectStore("expenses").getAll();
    q.onsuccess = () =>
      resolve(q.result.filter((e) => !window.BAP_SYNC.isMeta(e)));
    q.onerror = () => reject(q.error);
  });
}
function expenseStamp() {
  expenseClock=expenses.reduce((clock,e)=>Math.max(clock,(Date.parse(e.updated_at)||0)+1),Math.max(Date.now(),expenseClock+1));
  return new Date(expenseClock).toISOString();
}
function put(item) { return window.BAP_SYNC.write(db,"expenses",[item]); }
function remove(id) {
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("expenses","readwrite");tx.objectStore("expenses").delete(id);
    tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>{};
  });
}
function updateSafety() {
  const el=$("#data-safety-status"); if (!el) return;
  if (cloudReady && !cloudUser) { el.textContent="Inicia sesión para consultar tus cambios pendientes y recuperar gastos."; $("#expense-trash-list").replaceChildren(); return; }
  const owned=expenses.filter(e=>!cloudReady || e.owner_id===cloudUser?.id);
  const pending=owned.filter(e=>e.dirty).length + (window.BAP_FINANCE?.pendingCount() || 0);
  el.textContent=cloudReady ? pending ? `${pending} cambio(s) pendientes de enviar. Conserva este navegador y su almacenamiento hasta sincronizar.` : "Sin cambios locales pendientes de enviar. Descarga también tus dos respaldos: gastos y finanzas." : "Datos guardados en este navegador. Descarga los respaldos de gastos y finanzas para conservar una copia fuera del dispositivo.";
  const deleted=owned.filter(e=>e.deleted).sort((a,b)=>b.updated_at.localeCompare(a.updated_at)).slice(0,50);
  $("#expense-trash-list").innerHTML=deleted.length ? deleted.map(e=>`<div class="transaction"><div class="transaction-main"><strong>${safe(e.merchant)}</strong><small>${safe(e.date)} · ${safe(e.currency || "PEN")} ${Number(e.amount).toFixed(2)}</small></div><button type="button" class="outline" data-recover-expense="${safe(e.id)}">Recuperar gasto</button></div>`).join("") : '<p>No hay gastos eliminados para recuperar.</p>';
}
function current() {
  return expenses
    .filter(
      (e) =>
        !e.deleted &&
        (!cloudReady || e.owner_id === cloudUser?.id) &&
        e.date.slice(0, 7) === $("#month").value && (e.currency ?? "PEN") === ledgerCurrency(),
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.created.localeCompare(a.created),
    );
}
function safe(t) {
  return String(t ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function matchesSearch(values) {
  const normalize=v=>String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase();
  return normalize(values.join(" ")).includes(normalize($("#movement-search").value.trim()));
}
function render() {
  let rows = current(),
    total = rows.reduce((a, e) => a + Number(e.amount), 0),
    categories = {};
  rows.forEach(
    (e) =>
      (categories[e.category] =
        (categories[e.category] || 0) + Number(e.amount)),
  );
  let sorted = Object.entries(categories).sort((a, b) => b[1] - a[1]);
  $("#total").textContent = money(total);
  $("#count").textContent =
    `${rows.length} movimiento${rows.length === 1 ? "" : "s"} registrado${rows.length === 1 ? "" : "s"}`;
  $("#average").textContent = money(rows.length ? total / rows.length : 0);
  $("#top-category").textContent = sorted[0]?.[0] || "Sin datos";
  $("#top-category-amount").textContent = sorted.length
    ? money(sorted[0][1])
    : "Este mes";
  $("#receipt-count").textContent = rows.filter((e) => e.photo).length;
  const matchingRows=rows.filter(e=>matchesSearch([e.merchant,e.category,e.date,e.payment,e.note,e.amount]));
  $("#transactions").innerHTML = matchingRows.length
    ? matchingRows
        .map(
          (e) =>
            `<div class="transaction"><div class="transaction-icon">${e.photo ? "▧" : "◈"}</div><div class="transaction-main"><strong>${safe(e.merchant)}</strong><small>${safe(e.category)} · ${safe(e.date)} · ${safe(e.payment)}</small></div><span class="transaction-amount">${money(e.amount)}</span><button class="edit" data-id="${safe(e.id)}" title="Editar gasto" aria-label="Editar gasto">Editar</button><button class="delete" data-id="${safe(e.id)}" title="Eliminar gasto" aria-label="Eliminar gasto">×</button></div>`,
        )
        .join("")
    : $("#movement-search").value.trim() ? '<div class="empty">No hay gastos que coincidan con la búsqueda.</div>' : '<div class="empty">Aún no tienes gastos registrados este mes.<br>Agrega tu primer comprobante para empezar.</div>';
  $("#categories").innerHTML = sorted.length
    ? sorted
        .map(
          ([name, sum], i) =>
            `<div><div class="cat-head"><span>${safe(name)}</span><span>${money(sum)} · ${Math.round((sum / total) * 100)}%</span></div><div class="track"><span style="width:${(sum / total) * 100}%;background:${colors[i % colors.length]}"></span></div></div>`,
        )
        .join("")
    : '<div class="empty">Tus categorías aparecerán aquí.</div>';
  updateSafety();
  window.dispatchEvent(new Event("bap:render"));
}
function requireWrite() {
  return window.BAP_ACCESS?.requireWrite() ?? !cloudReady;
}
function show(item = null) {
  if (!requireWrite()) return;
  if (cloudReady && !cloudUser) {
    $("#account-dialog").showModal();
    notice("Inicia sesión para registrar gastos sincronizados.");
    return;
  }
  editingId = item?.id || null;
  photoData = item?.photo || "";
  $("#expense-form").reset();
  $("#expense-currency").value = item?.currency ?? ledgerCurrency();
  $("#expense-currency").disabled = !!item;
  window.BAP_FINANCE?.chooseCredit();
  $("#expense-credit").value = item?.credit_id || "";
  $("#editor-title").textContent = item ? "Editar gasto" : "Agrega un gasto";
  $("#editor-eyebrow").textContent = item
    ? "EDITAR REGISTRO"
    : "NUEVO REGISTRO";
  $("#save-expense").textContent = item ? "Guardar cambios" : "Guardar gasto";
  $("#date").value = today();
  $("#photo-title").textContent = "Fotografiar o subir boleta";
  $("#photo-subtitle").textContent =
    "JPG, PNG o HEIC si tu navegador lo admite";
  $("#scan").disabled = true;
  $("#scan-state").textContent = "La lectura necesita conexión a internet.";
  if (item) {
    $("#date").value = item.date;
    $("#amount").value = item.amount;
    $("#merchant").value = item.merchant;
    $("#category").value = item.category;
    $("#payment").value = item.payment;
    $("#note").value = item.note || "";
    if (photoData) {
      $("#photo-title").textContent = "Boleta adjunta · toca para reemplazar";
      $("#photo-subtitle").textContent =
        "La foto anterior se conserva al guardar";
      $("#scan").disabled = false;
    }
  }
  $("#editor").showModal();
}
function close() {
  $("#editor").close();
  editingId = null;
}
async function compress(file) {
  let bitmap = await createImageBitmap(file);
  if (bitmap.width * bitmap.height > 40000000) {
    bitmap.close();
    throw Error("Imagen demasiado grande");
  }
  let ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  let canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let data = canvas.toDataURL("image/jpeg", 0.76);
  if (data.length > 1048576) data = canvas.toDataURL("image/jpeg", 0.45);
  if (data.length > 1048576) throw Error("Imagen supera el límite de 1 MB");
  return data;
}
function parseReceipt(text) {
  let lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  let d = text.match(/\b(\d{2})[\/.-](\d{2})[\/.-](\d{4})\b/);
  if (d) {
    let day = `${d[3]}-${d[2]}-${d[1]}`;
    if (
      !Number.isNaN(Date.parse(day)) &&
      new Date(`${day}T12:00:00`).getDate() === Number(d[1])
    )
      $("#date").value = day;
  }
  let merchant = lines.find(
    (s) => s.length > 3 && !/RUC|BOLETA|FACTURA|\d{2}[\/.-]\d{2}/i.test(s),
  );
  if (merchant) $("#merchant").value = merchant.slice(0, 100);
  let totals = lines.filter(
    (s) =>
      /\b(?:TOTAL(?:\s+A\s+PAGAR)?|IMPORTE\s+TOTAL)\b/i.test(s) &&
      !/SUBTOTAL|IGV|DESCUENTO/i.test(s),
  );
  let target = totals.at(-1) || "";
  let numbers = target.match(/\d{1,6}(?:[.,]\d{3})*[.,]\d{2}\b/g) || [];
  let value = numbers.at(-1);
  if (value) {
    let normalized =
      value.includes(",") && value.lastIndexOf(",") > value.lastIndexOf(".")
        ? value.replaceAll(".", "").replace(",", ".")
        : value.replaceAll(",", "");
    let amount = Number(normalized);
    if (Number.isFinite(amount) && amount > 0)
      $("#amount").value = amount.toFixed(2);
  }
}
async function loadScript(src) {
  if (window.Tesseract) return;
  let s = document.createElement("script");
  s.src = src;
  let ready = new Promise((resolve, reject) => {
    s.onload = resolve;
    s.onerror = () => reject(Error("No se pudo descargar el motor OCR"));
  });
  document.head.append(s);
  await ready;
}
function download(blob, name) {
  let url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}
function excel() {
  let rows = current();
  if (!rows.length) return notice("No hay movimientos en este período.");
  download(BAP_XLSX.create(rows), `BAP_Gastos_${$("#month").value}_${ledgerCurrency()}.xlsx`);
}
function pdf() {
  let rows = current();
  if (!rows.length) return notice("No hay movimientos en este período.");
  let w = window.open("", "_blank");
  if (!w) return notice("Permite ventanas emergentes para exportar el PDF.");
  let total = rows.reduce((n, e) => n + Number(e.amount), 0);
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>BAP Gastos ${safe($("#month").value)}</title><style>body{font:13px Arial;color:#172842;margin:38px}h1{font-size:26px}p{color:#64748b}.total{background:#172842;color:white;padding:20px;border-radius:8px;font-size:22px}table{width:100%;border-collapse:collapse;margin-top:23px}td,th{padding:10px;border-bottom:1px solid #dce5ee;text-align:left}th{background:#eff3f7}td:last-child,th:last-child{text-align:right}footer{margin-top:25px;color:#94a3b8}@page{size:A4;margin:18mm}</style></head><body><h1>BAP Gastos</h1><p>Reporte mensual · ${safe($("#month").value)} · ${ledgerCurrency()} · ${rows.length} movimientos</p><div class="total">Total del mes: ${money(total)}</div><table><thead><tr><th>Fecha</th><th>Comercio</th><th>Categoría</th><th>Método</th><th>Monto</th></tr></thead><tbody>${rows.map((e) => `<tr><td>${safe(e.date)}</td><td>${safe(e.merchant)}</td><td>${safe(e.category)}</td><td>${safe(e.payment)}</td><td>${money(e.amount)}</td></tr>`).join("")}</tbody></table><footer>Generado desde BAP Gastos · Información registrada por el usuario</footer><script src="${location.origin + location.pathname.replace(/[^/]*$/, "")}print-report.js"><\/script></body></html>`,
  );
  w.document.close();
}
async function init() {
  try {
    db = await openDB();
    expenses = await all();
    $("#month").value = today().slice(0, 7);
    cloudReady = cloudConfigured();
    render();
    await initCloud();
  } catch (e) {
    notice(
      "No se pudo abrir la base local. Usa un navegador actualizado y habilita el almacenamiento.",
    );
    console.error(e);
  }
}
$("#month").addEventListener("change", render);
$("#movement-search").addEventListener("input", render);
$("#currency-view").addEventListener("change", render);
$("#expense-currency").addEventListener("change", () => window.BAP_FINANCE?.chooseCredit());
$("#add").onclick = () => show();
$("#add-inline").onclick = () => show();
$("#cancel").onclick = close;
$("#close").onclick = close;
$("#photo").addEventListener("change", async (e) => {
  let file = e.target.files[0];
  if (!file) return;
  if (file.size > 20000000)
    return notice("La imagen supera 20 MB. Usa una foto más pequeña.");
  try {
    photoData = await compress(file);
    $("#photo-title").textContent = file.name;
    $("#photo-subtitle").textContent = "Foto lista para guardar";
    $("#scan").disabled = false;
    $("#scan-state").textContent =
      "Revisa los datos después de leer la boleta.";
  } catch (error) {
    photoData = "";
    notice("No se pudo abrir esta foto. Prueba con JPG o PNG.");
  }
});
$("#scan").onclick = async () => {
  if (!photoData) return;
  let btn = $("#scan");
  btn.disabled = true;
  $("#scan-state").textContent = "Leyendo la boleta…";
  try {
    await loadScript(
      "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
    );
    let worker = await Tesseract.createWorker("spa+eng", 1, {
      logger: (m) => {
        if (m.status === "recognizing text")
          $("#scan-state").textContent =
            `Leyendo… ${Math.round(m.progress * 100)}%`;
      },
    });
    try {
      let result = await worker.recognize(photoData);
      parseReceipt(result.data.text);
      $("#scan-state").textContent =
        "Lectura lista: verifica fecha, comercio y monto.";
    } finally {
      await worker.terminate();
    }
  } catch (e) {
    $("#scan-state").textContent =
      "Lectura no disponible. Puedes completar los campos.";
    notice("No se pudo leer la boleta; revisa tu conexión.");
  } finally {
    btn.disabled = false;
  }
};
$("#expense-credit").addEventListener("change", () => {
  if ($("#expense-credit").value) $("#payment").value = "Tarjeta de crédito";
});
$("#payment").addEventListener("change", () => {
  if ($("#payment").value === "Tarjeta de crédito") {
    const options = [...$("#expense-credit").options].filter((o) => o.value);
    if (options.length === 1) $("#expense-credit").value = options[0].value;
  } else if ($("#payment").value !== "Tarjeta") $("#expense-credit").value = "";
});
let expenseSaving = false;
$("#expense-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (expenseSaving) return;
  expenseSaving = true;
  try { await saveExpense(e); }
  finally { expenseSaving = false; }
});
async function saveExpense(e) {
  let amount = Number($("#amount").value),
    date = $("#date").value;
  if (!requireWrite()) return;
  if (
    !db ||
    (cloudReady && !cloudUser) ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !date
  )
    return notice("Revisa la fecha y el monto.");
  let original = editingId
    ? expenses.find((x) => x.id === editingId && !x.deleted)
    : null;
  if (editingId && !original)
    return notice("Este gasto ya no está disponible.");
  let item = {
    ...original,
    id: original?.id || crypto.randomUUID(),
    created: original?.created || new Date().toISOString(),
    date,
    amount,
    currency: $("#expense-currency").value,
    merchant: $("#merchant").value.trim(),
    category: $("#category").value,
    payment: $("#payment").value,
    note: $("#note").value.trim(),
    photo: photoData,
    credit_id: $("#expense-credit").value || null,
    owner_id: cloudUser?.id || null,
    updated_at: expenseStamp(),
    dirty: true,
    deleted: false,
  };
  if (!["PEN", "USD"].includes(item.currency)) return notice("Selecciona soles o dólares.");
  const linkedCard = window.BAP_FINANCE?.cards().find(c => c.id === item.credit_id);
  if (item.credit_id && (!linkedCard || (linkedCard.data.currency ?? "PEN") !== item.currency)) return notice("El gasto y la tarjeta deben tener la misma moneda.");
  if (item.credit_id) item.payment = "Tarjeta de crédito";
  if (item.payment === "Tarjeta de crédito" && !item.credit_id) return notice("Selecciona la tarjeta de crédito en Origen del pago para actualizar su deuda y línea disponible.");
  const purchaseError = window.BAP_FINANCE?.validateExpenseChange(original, item);
  if (purchaseError) return notice(purchaseError);
  if (original && (original.currency ?? "PEN") !== item.currency) return notice("La moneda de un registro guardado se conserva.");
  if (!item.merchant) return notice("Escribe el comercio o la descripción.");
  try {
    await put(item);
    expenses = expenses.filter((x) => x.id !== item.id);
    expenses.push(item);
    let scheduleNotice = "";
    try { scheduleNotice = await window.BAP_FINANCE?.syncExpense(item) || ""; }
    catch { scheduleNotice = "Gasto guardado; la programación está pendiente. Revisa la tarjeta y vuelve a abrir Mis finanzas."; }
    $("#month").value = date.slice(0, 7);
    $("#currency-view").value = item.currency;
    render();
    close();
    notice(
      cloudReady
        ? "Gasto guardado. Sincronizando…"
        : "Gasto guardado en este dispositivo.",
    );
    if (scheduleNotice) notice(scheduleNotice);
    syncCloud();
  } catch (err) {
    notice("No se pudo guardar. Revisa el espacio disponible.");
  }
}
$("#transactions").addEventListener("click", async (e) => {
  let btn = e.target.closest("[data-id]");
  if (!btn) return;
  let item = expenses.find((x) => x.id === btn.dataset.id && !x.deleted);
  if (!item || (cloudReady && !cloudUser) || !requireWrite()) return;
  if (btn.classList.contains("edit")) {
    show(item);
    return;
  }
  const purchaseError = window.BAP_FINANCE?.validateExpenseChange(item, null);
  if (purchaseError) return notice(purchaseError);
  if (!confirm("¿Eliminar este gasto y su foto?")) return;
  item={...item,deleted:true,dirty:true,updated_at:expenseStamp()};
  try { await put(item); }
  catch { return notice("No se pudo guardar la eliminación; el gasto se conserva."); }
  expenses=expenses.map(e=>e.id===item.id ? item : e);
  syncCloud();
  await window.BAP_FINANCE?.syncExpense({...item, deleted:true});
  render();
  notice("Gasto enviado a la papelera; puedes recuperarlo en Reportes y respaldos.");
});
$("#excel").onclick = excel;
$("#pdf").onclick = pdf;
$("#expense-trash-list").onclick=async e=>{
  const button=e.target.closest('[data-recover-expense]');if (!button || !requireWrite()) return;
  const item=expenses.find(x=>x.id===button.dataset.recoverExpense && x.deleted && (!cloudReady || x.owner_id===cloudUser?.id));
  if (!item) return;
  const card=window.BAP_FINANCE?.cards().find(c=>c.id===item.credit_id);
  if (item.credit_id && (!card || (card.data.currency || "PEN")!==(item.currency || "PEN"))) return notice("Recupera primero la tarjeta vinculada o revisa tu respaldo financiero.");
  const restored={...item,deleted:false,dirty:true,updated_at:expenseStamp()};
  const error=window.BAP_FINANCE?.validateExpenseChange(null,restored);if (error) return notice(error);
  button.disabled=true;
  try { await put(restored); expenses=await all();render();syncCloud();notice("Gasto recuperado. Si tenía cronograma, revisa su programación en Mis finanzas."); }
  catch { notice("No se pudo recuperar el gasto; se conserva en la papelera.");button.disabled=false; }
};
$("#expense-checkpoint").onclick=async()=>{
  if (cloudReady && !cloudUser) return notice("Inicia sesión para consultar tu copia previa.");
  const copy=await window.BAP_SYNC.checkpoint(db,"expenses",cloudUser?.id || null);
  if (!copy) return notice("No hay una restauración anterior con copia local disponible.");
  try { download(new Blob([JSON.stringify(await window.BAP_BACKUP.seal({format:"bap-gastos-v1",exported:copy.exported,expenses:copy.rows}))],{type:"application/json"}),`BAP_Gastos_antes_de_restaurar_${today()}.json`); } catch(error) { notice(error.message); }
};
$("#backup").onclick = async () => {
  if (cloudReady && !cloudUser)
    return notice("Inicia sesión para descargar tus gastos.");
  let records = cloudReady
    ? expenses.filter((e) => e.owner_id === cloudUser.id)
    : expenses;
  try {
    const protectedCopy=await window.BAP_BACKUP.seal({format:"bap-gastos-v1",exported:new Date().toISOString(),expenses:records});
    download(new Blob([JSON.stringify(protectedCopy)],{type:"application/json"}),`BAP_Gastos_cifrado_${today()}.json`);
  } catch(error) { notice(error.message); }
};
$("#restore").onchange = async (e) => {
  let file = e.target.files[0];
  if (!file) return;
  if (!requireWrite()) {
    e.target.value = "";
    return;
  }
  if (file.size > 30000000) {
    notice("El respaldo supera 30 MB. Contacta al soporte.");
    e.target.value = "";
    return;
  }
  if (cloudReady && !cloudUser) {
    notice("Inicia sesión para restaurar datos.");
    e.target.value = "";
    return;
  }
  try {
    const restoreOwner=cloudUser?.id || null;
    let data = await window.BAP_BACKUP.open(await file.text());
    if (restoreOwner!==(cloudUser?.id || null)) throw Error("La sesión cambió. Inicia nuevamente la restauración.");
    if (
      data.format !== "bap-gastos-v1" ||
      !Array.isArray(data.expenses) ||
      data.expenses.length > 50000 || new Set(data.expenses.map(r=>r.id)).size !== data.expenses.length
    )
      throw Error("Formato inválido");
    if (
      !confirm(
        `¿Importar ${data.expenses.length} registros? Se actualizarán los ID coincidentes. Se guardará una copia local previa, descargable desde Reportes y respaldos.`,
      )
    )
      return;
    for (let item of data.expenses) {
      if (
        typeof item.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          item.id,
        ) ||
        !["PEN", "USD"].includes(item.currency ?? "PEN") ||
        typeof item.date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !Number.isFinite(Date.parse(item.date)) || new Date(item.date).toISOString().slice(0,10)!==item.date ||
        !Number.isFinite(Number(item.amount)) ||
        Number(item.amount) <= 0 ||
        typeof item.merchant !== "string" ||
        typeof item.category !== "string" ||
        (item.photo &&
          (typeof item.photo !== "string" ||
            item.photo.length > 1048576 ||
            !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(
              item.photo,
            ))) ||
        String(item.note || "").length > 200 ||
        item.merchant.length > 100 ||
        Number(item.amount) > 999999999
      )
        throw Error("Registro inválido");
    }
    for (const item of data.expenses) {
      const previous = expenses.find(x => x.id === item.id);
      if (previous && (previous.currency ?? "PEN") !== (item.currency ?? "PEN")) throw Error("Moneda distinta para un ID existente");
      const card = window.BAP_FINANCE?.cards().find(x => x.id === item.credit_id);
      if (!item.deleted && item.credit_id && (!card || (card.data.currency ?? "PEN") !== (item.currency ?? "PEN"))) throw Error("Tarjeta o moneda incompatible");
    }
    for (const item of data.expenses) {
      const previous=expenses.find(x=>x.id===item.id);
      const error=window.BAP_FINANCE?.validateExpenseChange(previous,item);
      if (error) throw Error(error);
    }
    const restoredRows = data.expenses.map(item => ({
        ...item,
        owner_id: cloudUser?.id || null,
        dirty: true,
        deleted: !!item.deleted,
        updated_at: expenseStamp(),
      }));
    await window.BAP_SYNC.replaceWithCheckpoint(db,"expenses",cloudUser?.id || null,restoredRows);
    expenses = await all();
    render();
    syncCloud();
    notice("Respaldo restaurado.");
  } catch (err) {
    notice(err.message === "Operación cancelada." || err.message?.startsWith("Contraseña incorrecta") || err.message?.startsWith("La sesión cambió") ? err.message : "No se restauró el archivo. Revisa su formato, la tarjeta vinculada, sus cronogramas y el espacio disponible; los datos anteriores se conservan.");
  } finally {
    e.target.value = "";
  }
};
if ("serviceWorker" in navigator && location.protocol !== "file:")
  navigator.serviceWorker.register("./sw.js").catch(() => {});
init();

window.BAP_APP = {
  state: () => ({
    user: cloudUser,
    configured: cloudReady,
    syncing: syncing || syncQueued,
    demo: demoMode,
    cloud,
    currency: ledgerCurrency(),
    expenses: expenses.filter(
      (e) => !cloudReady || e.owner_id === cloudUser?.id,
    ),
  }),
  notice,
  updateSafety,
  matchesSearch,
};
// Sincronización opcional: el navegador conserva una copia local y sube los cambios pendientes.
const config = window.BAP_CLOUD_CONFIG || {};
function cloudConfigured() {
  return !demoMode && Boolean(config.url && config.publishableKey);
}
function updateAccount() {
  let enabled = cloudConfigured();
  $("#account").textContent = demoMode
    ? "Modo de ejemplo"
    : !enabled
      ? "☁ Configurar nube"
      : cloudUser
        ? "☁ " + (syncing ? "Sincronizando…" : "Mi cuenta")
        : "☁ Iniciar sesión";
  $("#account-state").textContent = !enabled
    ? "Falta configurar el proyecto Supabase. Consulta README.md."
    : cloudUser
      ? `Sesión: ${cloudUser.email}. Los gastos se sincronizan al conectarse.`
      : "Inicia sesión para sincronizar tus gastos entre dispositivos.";
  $("#auth-form").hidden = !enabled || !!cloudUser;
  $("#sign-in-google").disabled = !enabled || !config.googleLoginEnabled || signingInGoogle;
  if (!signingInGoogle) $("#google-state").textContent = config.googleLoginEnabled
    ? "Google verifica tu identidad. BAP no recibe tu contraseña."
    : "El acceso con Google estará disponible pronto. Contacta a BAP para solicitar tu acceso.";
  $("#sign-out").hidden = !cloudUser;
  $("#delete-account").hidden = !cloudUser || !config.accountDeletion;
  $("#sync-foot").firstChild.textContent = enabled
    ? "BAP Gastos · Los cambios pendientes se guardan en este dispositivo hasta recuperar conexión. · "
    : "BAP Gastos · Los datos están únicamente en este navegador hasta configurar la nube. · ";
}
async function initCloud() {
  cloudReady = cloudConfigured();
  if (!cloudReady) {
    updateAccount();
    return;
  }
  if (!window.supabase?.createClient) {
    notice("No se pudo cargar la conexión en línea. Revisa internet.");
    updateAccount();
    return;
  }
  const authParams = new URLSearchParams(location.search),
    hashParams = new URLSearchParams(location.hash.slice(1)),
    authCallback = authParams.has("code") || authParams.has("error") || hashParams.has("error") || hashParams.has("access_token");
  cloud = window.supabase.createClient(config.url, config.publishableKey, {
    auth: { flowType: "pkce", detectSessionInUrl: true },
  });
  cloud.auth.onAuthStateChange((event, session) => {
    setTimeout(() => setUser(session?.user || null), 0);
  });
  let { data, error } = await cloud.auth.getUser();
  if (authCallback) {
    const safe = new URL(location.href);
    for (const key of ["code", "error", "error_code", "error_description", "flow_id"]) safe.searchParams.delete(key);
    safe.hash = "mi-acceso";
    history.replaceState(null, "", safe.pathname + safe.search + safe.hash);
    if (error || !data?.user) notice("No se pudo completar el acceso. Vuelve a iniciar sesión desde este navegador.");
  }
  if (!error) await setUser(data.user);
  else if (!navigator.onLine) {
    let { data: cached } = await cloud.auth.getSession();
    if (cached.session?.user) await setUser(cached.session.user);
  }
  updateAccount();
  setInterval(() => {
    if (cloudUser && navigator.onLine) syncCloud();
  }, 30000);
}
async function setUser(user) {
  const firstSession = !!user && cloudUser?.id !== user.id;
  if (cloudUser?.id !== user?.id) {
    stopRealtime(); close(); $("#expense-form").reset(); photoData="";
  }
  if (
    user &&
    localStorage.getItem("bap-gastos-owner") &&
    localStorage.getItem("bap-gastos-owner") !== user.id
  ) {
    notice(
      "Este navegador contiene datos de otra cuenta. Restaura un respaldo en un perfil separado.",
    );
    await cloud.auth.signOut();
    return;
  }
  cloudUser = user;
  await window.BAP_ACCESS?.refresh();
  if (user) {
    localStorage.setItem("bap-gastos-owner", user.id);
    for (let e of expenses.filter((x) => !x.owner_id)) {
      let updated = {
        ...e,
        owner_id: user.id,
        dirty: true,
        deleted: !!e.deleted,
        updated_at: e.updated_at || e.created || new Date().toISOString(),
      };
      await put(updated);
    }
    expenses = await all();
    await syncCloud();
    startRealtime();
  }
  render();
  updateAccount();
  if (firstSession && cloudUser?.id === user.id) {
    $("#account-dialog").close();
    const access = window.BAP_ACCESS?.snapshot();
    if (access?.is_admin || access?.status !== "active") {
      $(access?.is_admin ? "#commercial-admin" : "#mi-acceso").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
}
function stopRealtime() {
  clearTimeout(realtimeTimer);
  realtimeTimer = null;
  if (realtimeChannel && cloud) cloud.removeChannel(realtimeChannel);
  realtimeChannel = null;
}
function startRealtime() {
  if (!cloud || !cloudUser || realtimeChannel) return;
  const userId = cloudUser.id;
  realtimeChannel = cloud
    .channel(`bap-expenses-${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "expenses",
        filter: `user_id=eq.${userId}`,
      },
      () => {
        if (cloudUser?.id !== userId) return;
        clearTimeout(realtimeTimer);
        realtimeTimer = setTimeout(() => syncCloud(), 350);
      },
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR")
        console.warn(
          "Realtime temporalmente no disponible; se conserva la sincronización periódica.",
        );
    });
}
function remoteRow(e) {
  return {
    id: e.id,
    user_id: cloudUser.id,
    date: e.date,
    amount: Number(e.amount),
    currency: e.currency ?? "PEN",
    merchant: e.merchant,
    category: e.category,
    payment: e.payment,
    note: e.note || "",
    photo: e.photo || "",
    created: e.created || new Date().toISOString(),
    updated_at: e.updated_at || new Date().toISOString(),
    deleted: !!e.deleted,
    credit_id: e.credit_id || null,
  };
}
function localRow(e) {
  return {
    id: e.id,
    owner_id: e.user_id,
    date: e.date,
    amount: Number(e.amount),
    currency: e.currency ?? "PEN",
    merchant: e.merchant,
    category: e.category,
    payment: e.payment,
    note: e.note || "",
    photo: e.photo || "",
    created: e.created,
    updated_at: e.updated_at,
    deleted: e.deleted,
    credit_id: e.credit_id || null,
    dirty: false,
  };
}
async function syncCloud() {
  if (!cloud || !cloudUser || !navigator.onLine) return;
  if (syncing) { syncQueued=true; return; }
  syncing = true;
  updateAccount();
  let userId = cloudUser.id;
  try {
    let pending =
      (window.BAP_ACCESS?.canWrite() ?? false)
        ? expenses.filter((e) => e.owner_id === userId && e.dirty)
        : [];
    for (let entry of pending) {
      if (cloudUser?.id !== userId || !window.BAP_ACCESS?.canWrite()) return;
      let { data: existing, error: readError } = await cloud
        .from("expenses")
        .select("updated_at")
        .eq("id", entry.id)
        .maybeSingle();
      if (readError) throw readError;
      if (
        existing &&
        Date.parse(existing.updated_at) > Date.parse(entry.updated_at)
      ) {
        continue;
      }
      let { error } = await cloud
        .from("expenses")
        .upsert(remoteRow(entry), { onConflict: "id" });
      if (error) throw error;
      await window.BAP_SYNC.acknowledge(db,"expenses",entry);
    }
    await window.BAP_SYNC.pull({
      db,
      store: "expenses",
      userId,
      cloud,
      kind: "expenses",
      active: () => cloudUser?.id === userId,
      merge: (remote) => {
        const local = expenses.find((e) => e.id === remote.id);
        return !local ||
          !local.dirty ||
          Date.parse(remote.updated_at) > Date.parse(local.updated_at)
          ? localRow(remote)
          : null;
      },
    });
    if (cloudUser?.id !== userId) return;
    expenses = await all();
    render();
    updateAccount();
    window.BAP_FINANCE?.sync();
  } catch (err) {
    console.error("Sync error", err);
    notice(
      "Sincronización pendiente. Se reintentará al recuperar la conexión.",
    );
  } finally {
    syncing = false;
    updateAccount();
    updateSafety();
    if (syncQueued) {syncQueued=false;syncCloud();}
  }
}
$("#delete-account").onclick = async () => {
  if (!cloudUser || !config.accountDeletion || !navigator.onLine)
    return notice("Conéctate a internet para eliminar la cuenta.");
  let email = cloudUser.email || "tu cuenta";
  if (
    !confirm(
      `Se eliminarán la cuenta ${email} y sus gastos de la nube. Los respaldos descargados y las copias en otros dispositivos requieren eliminación por separado. Descarga tu respaldo antes de continuar. ¿Deseas seguir?`,
    )
  )
    return;
  if (
    prompt("Para confirmar la eliminación definitiva, escribe ELIMINAR:") !==
    "ELIMINAR"
  )
    return;
  let button = $("#delete-account");
  button.disabled = true;
  try {
    let owner = cloudUser.id;
    let { error } = await cloud.rpc("delete_my_account");
    if (error) throw error;
    let localError = false;
    try {
      await window.BAP_FINANCE?.clearOwner(owner);
    } catch (err) {
      localError = true;
      console.error("Finance cleanup error", err);
    }
    for (let entry of expenses.filter((e) => e.owner_id === owner)) {
      try {
        await remove(entry.id);
      } catch (err) {
        localError = true;
        console.error("Local cleanup error", err);
      }
    }
    try {
      await window.BAP_SYNC.clearCursor(db, "expenses", owner);
      await window.BAP_SYNC.clearCheckpoint(db,"expenses",owner);
    } catch {
      localError = true;
    }
    expenses = await all().catch(() => {
      localError = true;
      return [];
    });
    stopRealtime();
    await cloud.auth
      .signOut({ scope: "local" })
      .catch((err) => console.error("Local sign-out error", err));
    cloudUser = null;
    if (!localError) localStorage.removeItem("bap-gastos-owner");
    render();
    updateAccount();
    $("#account-dialog").close();
    notice(
      localError
        ? "Cuenta y gastos en línea eliminados. No se pudieron borrar todas las copias de este navegador; elimina los datos de este sitio en el navegador."
        : "Cuenta y gastos en línea eliminados. Borra las copias locales de otros dispositivos por separado.",
    );
  } catch (error) {
    console.error("Account deletion error", error);
    notice(
      "No se pudo confirmar la eliminación. Contacta al soporte desde Datos y privacidad.",
    );
  } finally {
    button.disabled = false;
  }
};
$("#account").onclick = () => {
  if (demoMode)
    return notice(
      "Este ejemplo guarda datos ficticios en una base separada sin sincronizar.",
    );
  $("#account-dialog").showModal();
  updateAccount();
};
$("#account-close").onclick = () => $("#account-dialog").close();
let pendingAuthEmail = null,
  verifyingCode = false,
  signingInGoogle = false;
$("#sign-in-google").onclick = async () => {
  if (demoMode || signingInGoogle || !cloud || !config.googleLoginEnabled) return;
  signingInGoogle = true;
  pendingAuthEmail = null;
  $("#otp-form").hidden = true;
  $("#auth-code").value = "";
  $("#sign-in-google").disabled = true;
  $("#google-state").textContent = "Abriendo Google…";
  try {
    const { error } = await cloud.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: location.origin + location.pathname,
        scopes: "openid email profile",
        queryParams: { prompt: "select_account" },
      },
    });
    $("#google-state").textContent = error
      ? "No se pudo iniciar el acceso con Google. Reintenta o contacta a BAP."
      : "Continúa en Google para iniciar sesión. Solicitarás tu plan al regresar.";
  } catch {
    $("#google-state").textContent = "No se pudo conectar con Google. Revisa internet y reintenta.";
  } finally {
    signingInGoogle = false;
    $("#sign-in-google").disabled = !config.googleLoginEnabled;
  }
};
$("#auth-email").addEventListener("input", () => {
  pendingAuthEmail = null;
  $("#otp-form").hidden = true;
  $("#auth-code").value = "";
});
$("#send-link").onclick = async () => {
  let email = $("#auth-email").value.trim();
  if (!email || !$("#auth-email").checkValidity())
    return notice("Escribe un correo válido.");
  if (!cloud) return notice("La conexión en línea no está configurada.");
  let button = $("#send-link");
  button.disabled = true;
  try {
    let { error } = await cloud.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (error)
      notice(
        "No se pudo enviar el acceso. Revisa tu conexión o contacta a BAP.",
      );
    else {
      pendingAuthEmail = email;
      $("#otp-form").hidden = false;
      $("#auth-code").value = "";
      $("#otp-state").textContent =
        "Si recibiste un código, escríbelo aquí. Si recibiste un enlace, ábrelo para continuar. No compartas el acceso.";
      notice(
        "Revisa tu correo y spam. La solicitud de envío no confirma la entrega.",
      );
    }
  } catch {
    notice("No se pudo enviar. Revisa tu conexión.");
  } finally {
    setTimeout(() => {
      button.disabled = false;
    }, 60000);
  }
};
$("#otp-form").onsubmit = async (event) => {
  event.preventDefault();
  if (
    !cloud ||
    verifyingCode ||
    !pendingAuthEmail ||
    !$("#auth-code").checkValidity()
  )
    return;
  verifyingCode = true;
  $("#verify-code").disabled = true;
  const email = pendingAuthEmail,
    token = $("#auth-code").value.trim();
  $("#auth-code").value = "";
  try {
    const { data, error } = await cloud.auth.verifyOtp({
      email,
      token,
      type: "email",
    });
    if (error || !data?.user) {
      $("#otp-state").textContent =
        "Código inválido o vencido. Revisa el correo o solicita uno nuevo.";
      return;
    }
    pendingAuthEmail = null;
    $("#otp-form").hidden = true;
    await setUser(data.user);
    $("#account-dialog").close();
    notice("Correo verificado. Consulta Mi acceso para ver tu autorización.");
  } catch {
    $("#otp-state").textContent = "No se pudo verificar. Revisa tu conexión.";
  } finally {
    verifyingCode = false;
    $("#verify-code").disabled = false;
  }
};
$("#sign-out").onclick = async () => {
  if (!cloud) return;
  if ((expenses.some(e=>e.owner_id===cloudUser?.id && e.dirty) || window.BAP_FINANCE?.pendingCount()) && !confirm("Hay cambios pendientes de sincronizar. Se conservarán en este navegador, pero aún pueden faltar en tus otros dispositivos. ¿Cerrar sesión de todos modos?")) return;
  stopRealtime();
  await cloud.auth.signOut();
  close(); $("#expense-form").reset(); photoData="";
  cloudUser = null;
  render();
  updateAccount();
  $("#account-dialog").close();
  notice(
    "Sesión cerrada. Los datos locales permanecen asociados a esta cuenta.",
  );
};
window.addEventListener("online", syncCloud);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) syncCloud();
});

window.BAP_APP.requireWrite = requireWrite;
window.addEventListener("bap:access", () => {
  render();
  updateAccount();
});


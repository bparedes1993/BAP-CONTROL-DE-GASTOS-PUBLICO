"use strict";
(function () {
  const $ = s => document.querySelector(s);
  const names = {yape: "Yape", plin: "Plin", transfer: "Transferencia"};
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const state = () => window.BAP_APP?.state() || {};
  const access = () => window.BAP_ACCESS?.snapshot();
  const pen = v => new Intl.NumberFormat("es-PE", {style:"currency",currency:"PEN"}).format(v);
  const qrValid = v => typeof v === "string" && v.length <= 131072 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v);
  let methods = null, owner = null, fetchedAt = 0, loading = false, selected = "", adminMethods = [];
  async function rpc(name, args) {
    if (state().demo || !state().user || !state().cloud) throw Error("Inicia sesión con tu cuenta de BAP.");
    const {data,error} = await state().cloud.rpc(name,args);
    if (error) throw error;
    return data;
  }
  function render() {
    const s = state(), snapshot = access(), select = $("#requested-method"), panel = $("#checkout-instructions");
    if (!snapshot || !s.user || s.demo) {
      panel.hidden = true;
      return;
    }
    const available = owner === s.user.id ? methods || [] : [];
    if (!available.some(m => m.method === selected)) selected = available.some(m => m.method === snapshot.requested_method) ? snapshot.requested_method : available[0]?.method || "";
    select.innerHTML = '<option value="">Selecciona un medio</option>' + Object.entries(names).map(([id,name]) => `<option value="${id}" ${available.some(m=>m.method===id) ? "" : "disabled"}>${name}${available.some(m=>m.method===id) ? "" : " · aún no disponible"}</option>`).join("");
    select.value = selected;
    $("#request-access").disabled = !available.length || !snapshot.plans?.length;
    panel.hidden = !!$("#access-request").hidden;
    if (panel.hidden) return;
    const method = available.find(m => m.method === selected);
    if (!method) {
      panel.innerHTML = `<p>${loading ? "Consultando medios de pago…" : "BAP todavía no tiene medios de cobro disponibles. Contacta al soporte para acordar tu acceso."}</p>`;
      return;
    }
    const plan = snapshot.plans.find(p => p.id === $("#requested-plan").value);
    const info = [
      ["Titular",method.payee], ["Número",method.phone], ["Banco",method.bank],
      ["Cuenta en soles",method.account], ["CCI en soles",method.cci],
    ].filter(([,value]) => value);
    panel.innerHTML = `<div class="checkout-copy"><span class="eyebrow">PAGO POR ${esc(names[method.method])}</span><h3>${plan?.price_pen == null ? "Confirma el precio con BAP antes de pagar" : esc(pen(Number(plan.price_pen)))}</h3><dl>${info.map(([label,value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>${method.instructions ? `<p>${esc(method.instructions)}</p>` : ""}<p class="commercial-help">Verifica el titular y el monto en tu aplicación de pagos. Después, envía la solicitud y la referencia de la operación. BAP revisará la recepción y activará el plan; el QR y la referencia no confirman un pago.</p>${snapshot.requested_method === selected && snapshot.requested_method_revision !== method.revision ? '<p class="finance-error">Los datos de cobro cambiaron desde tu solicitud. Si ya pagaste, contacta a BAP antes de repetir el pago.</p>' : ""}</div>${qrValid(method.qr) ? `<figure><img class="payment-qr" src="${esc(method.qr)}" alt="QR de cobro por ${esc(names[method.method])}"><figcaption>Escanea con tu aplicación de pagos.</figcaption></figure>` : ""}`;
  }
  async function ensureMethods(force = false) {
    const id = state().user?.id;
    if (owner !== id) { owner = id; methods = null; selected = ""; fetchedAt = 0; $("#requested-reference").value = ""; }
    if (!id || state().demo || loading || (!force && Date.now()-fetchedAt < 600000)) { render(); return; }
    loading = true;
    render();
    try {
      const data = await rpc("bap_checkout");
      if (state().user?.id === id) { methods = Array.isArray(data) ? data.filter(m=>names[m.method] && m.enabled) : []; fetchedAt = Date.now(); }
    } catch {
      if (state().user?.id === id) { methods = []; fetchedAt = Date.now(); }
    } finally { loading = false; render(); }
  }
  function request() {
    const m = owner === state().user?.id && methods?.find(x=>x.method === $("#requested-method").value && x.enabled);
    if (!m) throw Error("Elige un medio de pago disponible o contacta a BAP.");
    return {p_plan: $("#requested-plan").value, p_method:m.method, p_reference:$("#requested-reference").value.trim(), p_revision:m.revision};
  }
  async function loadAdmin() {
    const box = $("#payment-methods-admin"), status = $("#payment-methods-state");
    if (state().demo) { box.innerHTML = '<p class="commercial-help">Ejemplo: la demostración no contiene medios de cobro reales ni guarda configuraciones.</p>'; return; }
    if (!access()?.admin_verified) return;
    const id = state().user?.id;
    status.textContent = "Consultando configuración de cobro…";
    try {
      const data = await rpc("bap_admin_checkout_methods");
      if (id !== state().user?.id || !access()?.admin_verified) return;
      adminMethods = data;
      box.innerHTML = ["yape","plin","transfer"].map(method => {
        const m = data.find(x=>x.method === method) || {method,revision:0};
        return `<form class="payment-method-form" data-method="${method}"><h4>${names[method]}</h4><label class="payment-enabled"><input name="enabled" type="checkbox" ${m.enabled ? "checked" : ""}> Mostrar a clientes</label><label>Titular del cobro<input name="payee" maxlength="100" value="${esc(m.payee)}"></label>${method === "transfer" ? `<label>Banco<input name="bank" maxlength="80" value="${esc(m.bank)}"></label><label>Número de cuenta en soles<input name="account" inputmode="numeric" maxlength="24" pattern="[0-9]{6,24}" value="${esc(m.account)}"></label><label>CCI en soles (20 dígitos)<input name="cci" inputmode="numeric" maxlength="20" pattern="[0-9]{20}" value="${esc(m.cci)}"></label>` : `<label>Número de celular de cobro<input name="phone" inputmode="tel" maxlength="9" pattern="9[0-9]{8}" value="${esc(m.phone)}"></label>`}<label>Indicaciones, opcional<textarea name="instructions" maxlength="240">${esc(m.instructions)}</textarea></label><label>Subir o reemplazar QR<input name="qr_file" type="file" accept="image/png,image/jpeg,image/webp"></label>${qrValid(m.qr) ? `<img class="payment-qr admin-qr" alt="QR actual de ${names[method]}" src="${esc(m.qr)}"><label><input name="remove_qr" type="checkbox"> Quitar el QR guardado</label>` : '<p class="commercial-help">Sin QR. Puedes activar Yape o Plin con el número de celular.</p>'}<p class="payment-form-state commercial-help" role="status"></p><button class="outline" type="submit">Guardar ${names[method]}</button></form>`;
      }).join("");
      status.textContent = "Los cambios se guardan por medio. La activación exige titular y un destino válido.";
    } catch { status.textContent = "No se pudo cargar la configuración. Verifica tu segundo factor y conexión."; }
  }
  async function prepareQR(file) {
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>2097152) throw Error("Usa un QR PNG, JPG o WebP de hasta 2 MB.");
    const image = await createImageBitmap(file);
    try {
      if (!image.width || !image.height || image.width*image.height>20000000) throw Error("La imagen del QR es demasiado grande.");
      for (const size of [800,640,512]) {
        const scale = Math.min(1,size/Math.max(image.width,image.height)), canvas = document.createElement('canvas');
        canvas.width = Math.max(1,Math.round(image.width*scale)); canvas.height = Math.max(1,Math.round(image.height*scale));
        const context = canvas.getContext('2d'); context.fillStyle='#ffffff'; context.fillRect(0,0,canvas.width,canvas.height); context.drawImage(image,0,0,canvas.width,canvas.height);
        const data = canvas.toDataURL('image/png');
        if (qrValid(data)) return data;
      }
      throw Error("Recorta la imagen alrededor del QR para reducir su tamaño.");
    } finally { image.close(); }
  }
  $("#payment-methods-admin").addEventListener("submit", async e => {
    const form = e.target.closest('[data-method]');
    if (!form) return;
    e.preventDefault();
    if (state().demo || !access()?.admin_verified) return;
    const m = adminMethods.find(x=>x.method === form.dataset.method), status = form.querySelector('.payment-form-state'), button = form.querySelector('button');
    if (!m) return;
    const actingUser = state().user?.id;
    button.disabled = true;
    status.textContent = "Guardando…";
    try {
      const data = new FormData(form), file = form.querySelector('[name=qr_file]').files[0];
      if (file && data.has('remove_qr')) throw Error("Elige reemplazar el QR o quitarlo, una acción por vez.");
      const values = {enabled:data.has('enabled'), payee:String(data.get('payee')||'').trim(), phone:String(data.get('phone')||'').trim(), bank:String(data.get('bank')||'').trim(), account:String(data.get('account')||'').trim(), cci:String(data.get('cci')||'').trim(), instructions:String(data.get('instructions')||'').trim(), qr:file ? await prepareQR(file) : data.has('remove_qr') ? '' : m.qr || ''};
      if (state().user?.id !== actingUser || !access()?.admin_verified) throw Error("Tu sesión cambió. Vuelve a iniciar sesión antes de guardar.");
      await rpc("bap_admin_save_checkout", {p_method:m.method,p_data:values,p_revision:m.revision});
      await loadAdmin();
      await ensureMethods(true);
      $("#payment-methods-state").textContent = names[m.method] + " guardado. Comprueba el titular, monto y lectura del QR con tu aplicación antes de ofrecerlo.";
    } catch (error) { status.textContent = error.message || "No se pudo guardar el medio de cobro."; }
    finally { button.disabled = false; }
  });
  $("#requested-method").addEventListener("change", () => { selected = $("#requested-method").value; render(); });
  $("#payment-methods-load").addEventListener("click", loadAdmin);
  $("#access-refresh").addEventListener("click", () => ensureMethods(true));
  window.addEventListener("bap:access", () => ensureMethods());
  window.addEventListener("bap:render", () => { if (!state().user) { owner=null; methods=null; adminMethods=[]; $("#requested-reference").value=""; $("#payment-methods-admin").replaceChildren(); render(); } });
  window.BAP_CHECKOUT = {render,request,loadAdmin};
})();

"use strict";
(function () {
  const $ = (s) => document.querySelector(s),
    escape = (s) =>
      String(s ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
  const currency = (v) =>
    new Intl.NumberFormat("es-PE", {
      style: "currency",
      currency: "PEN",
    }).format(v);
  const date = (v) =>
    v
      ? new Date(v).toLocaleDateString("es-PE", { timeZone: "America/Lima" })
      : "—";
  const app = () => window.BAP_APP?.state() || {},
    notify = (t) => window.BAP_APP?.notice(t);
  const labels = {
    pending: "Solicitud pendiente",
    active: "Acceso vigente",
    expired: "Acceso vencido",
    suspended: "Acceso suspendido",
    rejected: "Solicitud no aprobada",
    not_requested: "Solicita tu acceso",
  };
  const methods = {
    transfer: "Transferencia",
    yape: "Yape",
    plin: "Plin",
    cash: "Efectivo",
    other: "Otro",
  };
  let snapshot = null,
    knownUser = null,
    inFlight = null,
    serverOffset = 0,
    adminData = null,
    adminOffset = 0,
    selected = null,
    factor = null,
    operation = null;
  const demo = () => !!app().demo;
  function canWrite() {
    const s = app();
    if (s.demo || !s.configured) return true;
    if (!s.user || knownUser !== s.user.id || !snapshot?.can_write)
      return false;
    if (
      snapshot.enforcement &&
      !snapshot.admin_verified &&
      snapshot.ends_at &&
      Date.now() + serverOffset >= Date.parse(snapshot.ends_at)
    )
      return false;
    return true;
  }
  function requireWrite() {
    if (canWrite()) return true;
    if (!app().user) $("#account-dialog").showModal();
    else $("#mi-acceso").scrollIntoView({ behavior: "smooth", block: "start" });
    notify(
      "Revisa Mi acceso: necesitas una autorización vigente para registrar cambios.",
    );
    return false;
  }
  function paint() {
    const s = app(),
      box = $("#access-status"),
      request = $("#access-request"),
      admin = $("#commercial-admin");
    if (!box) return;
    $("#access-demo").hidden = !demo();
    $("#access-login").hidden = !!s.user || demo();
    if (!s.user && !demo()) {
      box.innerHTML =
        "<h3>Una cuenta para tus dispositivos</h3><p>Verifica tu correo para solicitar un plan. La activación y vigencia se confirman desde BAP.</p>";
      request.hidden = true;
      admin.hidden = true;
      return;
    }
    if (!snapshot) {
      box.innerHTML =
        "<h3>Verificando tu acceso</h3><p>Conéctate para consultar tu autorización. Tus datos locales se conservan.</p>";
      request.hidden = true;
      admin.hidden = true;
      return;
    }
    const plan = snapshot.plans.find((p) => p.id === snapshot.plan_id),
      state = labels[snapshot.status] || "Estado pendiente";
    box.innerHTML = `<div><span class="access-chip">${escape(snapshot.enforcement ? state : "Piloto · control obligatorio pendiente")}</span><h3>${escape(plan?.name || "Tu espacio financiero")}</h3><p>${snapshot.ends_at ? "Vigencia hasta " + escape(date(snapshot.ends_at)) + ". " : ""}${snapshot.enforcement && !canWrite() ? "Puedes consultar y exportar tus datos; para registrar cambios solicita una revisión de acceso." : "La autorización comercial no sustituye la verificación de tu correo."}</p></div>`;
    request.hidden = ["active", "suspended", "rejected"].includes(
      snapshot.status,
    );
    $("#requested-plan").innerHTML = snapshot.plans
      .map(
        (p) =>
          `<option value="${escape(p.id)}">${escape(p.name)} · ${p.days} días · ${p.price_pen == null ? "Precio por acordar" : currency(p.price_pen)}</option>`,
      )
      .join("");
    $("#access-payments").innerHTML = snapshot.payments.length
      ? "<h3>Pagos registrados por BAP</h3>" +
        snapshot.payments
          .map(
            (p) =>
              `<div class="finance-row"><span>${escape(date(p.paid_at))} · ${escape(methods[p.method] || p.method)}</span><strong>${currency(Number(p.amount_pen))}</strong></div>`,
          )
          .join("")
      : '<p class="finance-help">No hay pagos confirmados en esta cuenta. Solicitar un plan no genera un cobro.</p>';
    $("#access-admin-link").hidden = !snapshot.is_admin;
    admin.hidden = !snapshot.is_admin;
    $("#admin-mfa").hidden = !!snapshot.admin_verified;
    $("#admin-controls").hidden = !snapshot.admin_verified;
    $("#admin-warning").textContent = snapshot.enforcement
      ? "Control activo: solo las cuentas con acceso vigente pueden modificar datos en la nube."
      : "Modo piloto: las cuentas verificadas todavía pueden modificar sus propios datos. Activa el control cuando hayas aprobado a los usuarios actuales.";
  }
  async function refresh() {
    const s = app();
    if (demo()) {
      knownUser = null;
      snapshot = {
        enforcement: true,
        can_write: true,
        is_admin: true,
        admin_verified: true,
        status: "active",
        plan_id: "monthly",
        ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        plans: [
          {
            id: "monthly",
            name: "Personal mensual",
            days: 30,
            price_pen: null,
          },
          { id: "annual", name: "Personal anual", days: 365, price_pen: null },
        ],
        payments: [],
      };
      paint();
      return snapshot;
    }
    if (!s.user || !s.cloud) {
      snapshot = null;
      knownUser = null;
      paint();
      return null;
    }
    const id = s.user.id;
    if (inFlight && knownUser === id) return inFlight;
    knownUser = id;
    inFlight = (async () => {
      try {
        const { data, error } = await s.cloud.rpc("bap_my_access");
        if (error) throw error;
        if (app().user?.id !== id) return null;
        snapshot = data;
        serverOffset = Date.parse(data.server_now) - Date.now();
        paint();
        window.dispatchEvent(new Event("bap:access"));
        return snapshot;
      } catch (error) {
        if (app().user?.id === id) {
          snapshot = null;
          paint();
          $("#access-status").innerHTML =
            "<h3>Acceso sin verificar</h3><p>No se pudo consultar la autorización. Revisa conexión o contacta al soporte. Los registros locales se conservan.</p>";
        }
        return null;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }
  async function rpc(name, args = {}) {
    if (demo())
      throw Error("La demostración no ejecuta decisiones ni envía datos.");
    if (!app().cloud || !app().user) throw Error("Inicia sesión primero.");
    const { data, error } = await app().cloud.rpc(name, args);
    if (error) throw error;
    return data;
  }
  $("#access-login").onclick = () => $("#account-dialog").showModal();
  $("#access-refresh").onclick = refresh;
  $("#access-request").onsubmit = async (e) => {
    e.preventDefault();
    if (demo()) return notify("Ejemplo ficticio: ninguna solicitud se envió.");
    const button = $("#request-access");
    button.disabled = true;
    try {
      await rpc("bap_request_access", { p_plan: $("#requested-plan").value });
      await refresh();
      notify("Solicitud registrada. BAP revisará el plan y la vigencia.");
    } catch (error) {
      notify(error.message || "No se pudo registrar la solicitud.");
    } finally {
      button.disabled = false;
    }
  };
  async function loadAdmin() {
    if (demo()) {
      adminData = {
        enforcement: true,
        plans: snapshot.plans,
        customers: [
          {
            user_id: "00000000-0000-4000-8000-000000000101",
            email: "cliente.ejemplo@example.invalid",
            requested_plan: "monthly",
            status: "pending",
            effective_status: "pending",
            requested_at: new Date().toISOString(),
            ends_at: null,
          },
        ],
        audit: [],
      };
    } else {
      if (!snapshot?.admin_verified) return;
      adminData = await rpc("bap_admin_list", {
        p_offset: adminOffset,
        p_search: $("#admin-search").value.trim(),
      });
    }
    $("#admin-clients").innerHTML = adminData.customers.length
      ? adminData.customers
          .map(
            (c) =>
              `<article class="commercial-customer"><div><strong>${escape(c.email)}</strong><span class="access-chip">${escape(labels[c.effective_status] || c.status)}</span><small>${escape(c.plan_id || c.requested_plan || "Sin plan")} · Hasta ${escape(date(c.ends_at))}</small></div><button class="outline" data-manage="${escape(c.user_id)}">Gestionar acceso</button><a class="text-btn" href="mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent("BAP · Estado de tu acceso")}&body=${encodeURIComponent("Hola. El estado de tu acceso a BAP es: " + (labels[c.effective_status] || c.status) + ".\nConsulta tu plan y vigencia entrando en la web de BAP.\n" + location.origin + location.pathname)}">Preparar correo</a></article>`,
          )
          .join("")
      : '<p class="finance-help">No se encontraron solicitudes.</p>';
    $("#admin-plans").innerHTML = adminData.plans
      .map(
        (p) =>
          `<form data-plan="${escape(p.id)}" class="commercial-plan"><strong>${escape(p.name)}</strong><label>Nombre<input name="name" maxlength="60" required value="${escape(p.name)}"></label><label>Precio S/ (vacío: por acordar)<input name="price" type="number" min="0" max="100000" step="0.01" value="${p.price_pen ?? ""}"></label><label>Días de acceso<input name="days" type="number" min="1" max="730" step="1" required value="${p.days}"></label><label><input name="published" type="checkbox" ${p.published !== false ? "checked" : ""}> Ofrecer este plan</label><button class="outline" type="submit">Guardar plan</button></form>`,
      )
      .join("");
    $("#admin-audit").innerHTML =
      adminData.audit
        .map(
          (a) =>
            `<div class="finance-row"><span>${escape(a.action)} · ${escape(date(a.created_at))}</span><small>${escape(a.detail.status || a.detail.plan || "Configuración")}</small></div>`,
        )
        .join("") ||
      '<p class="finance-help">Las decisiones quedan registradas aquí.</p>';
    $("#admin-prev").disabled = adminOffset === 0;
    $("#admin-next").disabled = adminData.customers.length < 50;
    $("#enforce-commercial").textContent = adminData.enforcement
      ? "Control de planes activo"
      : "Activar control obligatorio";
    $("#enforce-commercial").disabled = !!adminData.enforcement;
  }
  $("#admin-load").onclick = async () => {
    try {
      await loadAdmin();
    } catch (error) {
      notify(error.message);
    }
  };
  $("#admin-search-form").onsubmit = async (e) => {
    e.preventDefault();
    adminOffset = 0;
    try {
      await loadAdmin();
    } catch (error) {
      notify(error.message);
    }
  };
  $("#admin-prev").onclick = async () => {
    adminOffset = Math.max(0, adminOffset - 50);
    try {
      await loadAdmin();
    } catch (error) {
      notify(error.message);
    }
  };
  $("#admin-next").onclick = async () => {
    adminOffset += 50;
    try {
      await loadAdmin();
    } catch (error) {
      notify(error.message);
    }
  };
  $("#admin-clients").onclick = (e) => {
    const b = e.target.closest("[data-manage]");
    if (!b) return;
    selected = adminData.customers.find((c) => c.user_id === b.dataset.manage);
    if (!selected) return;
    operation = crypto.randomUUID();
    $("#decision-form").reset();
    $("#decision-client").textContent = selected.email;
    $("#decision-plan").innerHTML = adminData.plans
      .map((p) => `<option value="${escape(p.id)}">${escape(p.name)}</option>`)
      .join("");
    $("#decision-plan").value = selected.plan_id || selected.requested_plan;
    $("#decision-days").value =
      adminData.plans.find((p) => p.id === $("#decision-plan").value)?.days ||
      30;
    $("#decision-error").textContent = "";
    $("#decision-dialog").showModal();
  };
  $("#decision-plan").onchange = () => {
    $("#decision-days").value =
      adminData.plans.find((p) => p.id === $("#decision-plan").value)?.days ||
      30;
  };
  $("#decision-close").onclick = () => {
    $("#decision-dialog").close();
    selected = null;
    operation = null;
  };
  $("#decision-form").onsubmit = async (e) => {
    e.preventDefault();
    if (demo())
      return notify(
        "Ejemplo ficticio: ninguna autorización ni pago se guardó.",
      );
    if (!selected) return;
    const button = $("#decision-save");
    button.disabled = true;
    try {
      await rpc("bap_admin_decide", {
        p_operation: operation,
        p_user: selected.user_id,
        p_status: $("#decision-status").value,
        p_plan: $("#decision-plan").value,
        p_days: Number($("#decision-days").value),
        p_amount: Number($("#decision-amount").value || 0),
        p_method: $("#decision-method").value,
        p_reference: $("#decision-reference").value.trim(),
      });
      $("#decision-dialog").close();
      selected = null;
      await refresh();
      await loadAdmin();
      notify(
        "Decisión registrada. El cliente verá su vigencia al actualizar Mi acceso.",
      );
    } catch (error) {
      $("#decision-error").textContent =
        error.message ||
        "No se pudo confirmar la decisión. Reintenta sin cerrar este formulario.";
    } finally {
      button.disabled = false;
    }
  };
  $("#admin-plans").onsubmit = async (e) => {
    const f = e.target.closest("[data-plan]");
    if (!f) return;
    e.preventDefault();
    if (demo()) return notify("Ejemplo ficticio: ningún precio cambió.");
    const b = f.querySelector("button");
    b.disabled = true;
    try {
      const d = new FormData(f);
      await rpc("bap_admin_plan", {
        p_id: f.dataset.plan,
        p_name: String(d.get("name")).trim(),
        p_price: d.get("price") === "" ? null : Number(d.get("price")),
        p_days: Number(d.get("days")),
        p_published: d.has("published"),
      });
      await refresh();
      await loadAdmin();
      notify("Plan actualizado. Las vigencias existentes se conservan.");
    } catch (error) {
      notify(error.message);
    } finally {
      b.disabled = false;
    }
  };
  $("#enforce-commercial").onclick = async () => {
    if (demo())
      return notify("La demostración no cambia el control comercial.");
    if (
      !confirm(
        "Activar el control hará que las cuentas sin autorización vigente puedan consultar y exportar, pero no registrar cambios en la nube. Revisa primero a los usuarios actuales. ¿Activar?",
      )
    )
      return;
    try {
      await rpc("bap_admin_enforcement", { p_enabled: true });
      await refresh();
      await loadAdmin();
      notify("Control de planes activo en el servidor.");
    } catch (error) {
      notify(error.message);
    }
  };
  $("#mfa-start").onclick = async () => {
    if (demo()) return;
    const b = $("#mfa-start");
    b.disabled = true;
    try {
      const { data: existing, error: listError } =
        await app().cloud.auth.mfa.listFactors();
      if (listError) throw listError;
      const verified = existing.totp.find((f) => f.status === "verified");
      if (verified) {
        factor = verified.id;
        $("#mfa-qr").hidden = true;
        $("#mfa-secret").textContent =
          "Introduce el código de tu aplicación autenticadora.";
      } else {
        const { data, error } = await app().cloud.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "BAP administración",
        });
        if (error) throw error;
        factor = data.id;
        const qr = data.totp.qr_code;
        $("#mfa-qr").src = qr.startsWith("data:image/")
          ? qr
          : "data:image/svg+xml;charset=utf-8," + encodeURIComponent(qr);
        $("#mfa-qr").hidden = false;
        $("#mfa-secret").textContent =
          "Clave para configuración manual: " + data.totp.secret;
      }
      $("#mfa-verify").hidden = false;
    } catch (error) {
      notify(error.message);
    } finally {
      b.disabled = false;
    }
  };
  $("#mfa-verify").onsubmit = async (e) => {
    e.preventDefault();
    const b = $("#mfa-confirm");
    b.disabled = true;
    try {
      const { error } = await app().cloud.auth.mfa.challengeAndVerify({
        factorId: factor,
        code: $("#mfa-code").value.trim(),
      });
      if (error) throw error;
      $("#mfa-code").value = "";
      $("#mfa-secret").textContent = "";
      $("#mfa-qr").removeAttribute("src");
      $("#mfa-verify").hidden = true;
      await refresh();
      await loadAdmin();
      notify("Segundo factor verificado para esta sesión.");
    } catch (error) {
      notify(error.message);
    } finally {
      b.disabled = false;
    }
  };
  window.BAP_ACCESS = {
    canWrite,
    requireWrite,
    refresh,
    snapshot: () => snapshot,
  };
  window.addEventListener("bap:render", () => {
    const s = app();
    if (
      (demo() && !snapshot) ||
      (s.user?.id !== knownUser && s.user) ||
      (!s.user && knownUser)
    )
      refresh();
    else paint();
  });
  window.addEventListener("online", refresh);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
  setInterval(() => {
    if (app().user && navigator.onLine) refresh();
  }, 60000);
  paint();
})();

"use strict";
(function () {
  const q = (s) => document.querySelector(s),
    esc = (s) =>
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
      ),
    selectedCurrency = () => q("#currency-view").value === "USD" ? "USD" : "PEN",
    symbol = (c = selectedCurrency()) => c === "USD" ? "US$" : "S/",
    fmt = (v, c = selectedCurrency()) =>
      new Intl.NumberFormat("es-PE", {
        style: "currency",
        currency: c,
      }).format(Number(v) || 0),
    num = (v) => Number(v) || 0;
  const day = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const M = window.BAP_FINANCE_MODEL;
  let db,
    records = [],
    connected = null,
    channel = null,
    busy = false,
    syncQueued = false,
    mutationClock = 0,
    submitting = false,
    syncIssues = [],
    status = "Cargando…",
    edit = null,
    context = null,
    formKind = null;
  const state = () =>
    window.BAP_APP?.state() || {
      user: null,
      configured: false,
      expenses: [],
      cloud: null,
    };
  const owner = () => state().user?.id || null;
  async function budgetId(currency) {
    if (currency === "PEN") return owner() || "00000000-0000-4000-8000-000000000001";
    // A stable per-user UUID prevents two new devices creating duplicate USD budgets.
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("BAP finance budget|" + (owner() || "local") + "|USD"))).slice(0,16);
    bytes[6] = (bytes[6] & 15) | 128;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(b=>b.toString(16).padStart(2,"0")).join("");
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  const visible = () =>
    records.filter(
      (r) => r.owner_id === owner() && (!state().configured || !!owner()),
    );
  const active = () => visible().filter((r) => !r.deleted);
  function transact(mode, action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("records", mode);
      const req = action(tx.objectStore("records"));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  const load = async () =>
    (await transact("readonly", (s) => s.getAll())).filter(
      (r) => !window.BAP_SYNC.isMeta(r),
    );
  const put = (r) => transact("readwrite", (s) => s.put(r));
  const nextStamp = () => {
    mutationClock = records.reduce((clock, r) => Math.max(clock, (Date.parse(r.updated_at) || 0) + 1), Math.max(Date.now(), mutationClock + 1));
    return new Date(mutationClock).toISOString();
  };
  const acknowledge = (sent) => new Promise((resolve, reject) => {
    const tx = db.transaction("records", "readwrite"), store = tx.objectStore("records"), request = store.get(sent.id);
    request.onsuccess = () => {
      const current = request.result;
      if (current?.updated_at === sent.updated_at && current.deleted === sent.deleted && JSON.stringify(current.data) === JSON.stringify(sent.data)) store.put({...current, dirty:false});
    };
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => {};
  });
  const notify = (s) => window.BAP_APP?.notice(s);
  function allowed(write = true) {
    if (write && !window.BAP_APP?.requireWrite()) return false;
    if (state().configured && !owner()) {
      q("#account-dialog").showModal();
      notify("Inicia sesión para registrar tus finanzas.");
      return false;
    }
    return !!db;
  }
  async function save(kind, data, id) {
    if (!allowed()) return;
    const account = owner();
    const r = {
      id: id || crypto.randomUUID(),
      kind,
      data,
      owner_id: account,
      updated_at: nextStamp(),
      deleted: false,
      dirty: true,
    };
    if (!M.validRecord(r)) throw Error("Registro inválido");
    const previous = active().find(x => x.id === r.id);
    if (previous && M.currency(previous.data) !== M.currency(data)) throw Error("La moneda guardada no se puede cambiar.");
    const linked = active().find(x => x.id === data.debt_id);
    if (data.debt_id && (!linked || M.currency(linked.data) !== M.currency(data))) throw Error("La cuenta y el movimiento deben tener la misma moneda.");
    await put(r);
    records = await load();
    if (owner() === account) {
      q("#currency-view").value = M.currency(data);
      q("#currency-view").dispatchEvent(new Event("change"));
      render();
    }
    sync();
    return r;
  }
  function chooseCredit() {
    const el = q("#expense-credit");
    if (!el) return;
    const selected = el.value;
    el.innerHTML =
      '<option value="">Efectivo / débito / transferencia</option>' +
      active()
        .filter((r) => r.kind === "debt" && r.data.type === "card" && M.currency(r.data) === (q("#expense-currency").value || selectedCurrency()))
        .map(
          (d) =>
            `<option value="${esc(d.id)}">Crédito · ${esc(d.data.name)} · ${M.currency(d.data)}</option>`,
        )
        .join("");
    if ([...el.options].some((o) => o.value === selected)) el.value = selected;
  }
  async function attach() {
    if (!db) return;
    const s = state(),
      id = s.user?.id || null;
    if (connected !== id) {
      if (channel && s.cloud) s.cloud.removeChannel(channel);
      channel = null;
      connected = id;
      records = await load();
      if (id && s.cloud) {
        channel = s.cloud
          .channel("bap-finance-" + id)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "finance_entries",
              filter: "user_id=eq." + id,
            },
            () => sync(),
          )
          .subscribe();
        sync();
      } else
        status = s.configured
          ? "Inicia sesión para sincronizar"
          : "Solo en este dispositivo";
    } else if (!id && !busy) {
      status = s.configured
        ? "Inicia sesión para sincronizar"
        : "Solo en este dispositivo";
    }
    render();
  }
  async function sync() {
    const s = state();
    if (!db || !s.cloud || !s.user || !navigator.onLine) return;
    if (busy) { syncQueued = true; return; }
    const id = s.user.id;
    busy = true;
    status = "Sincronizando finanzas…";
    paintStatus();
    try {
      syncIssues = [];
      const rank = r => r.deleted && r.data.schedule_only ? 4 : ["debt", "receivable"].includes(r.kind) ? 0 : r.data.schedule_only ? 2 : ["payment", "disbursement", "charge"].includes(r.kind) ? 3 : 1;
      for (const r of records.filter(
        (r) => r.owner_id === id && r.dirty && window.BAP_ACCESS?.canWrite(),
      ).sort((a,b) => rank(a) - rank(b))) {
        if (owner() !== id || !window.BAP_ACCESS?.canWrite()) return;
        try {
        let { data: remote, error } = await s.cloud
          .from("finance_entries")
          .select("updated_at")
          .eq("id", r.id)
          .maybeSingle();
        if (error) throw error;
        if (remote && Date.parse(remote.updated_at) > Date.parse(r.updated_at))
          continue;
        let row = {
          id: r.id,
          user_id: id,
          kind: r.kind,
          data: r.data,
          updated_at: r.updated_at,
          deleted: r.deleted,
        };
        let result = await s.cloud
          .from("finance_entries")
          .upsert(row, { onConflict: "id" });
        if (result.error) throw result.error;
        await acknowledge(r);
        } catch (error) {
          syncIssues.push({id:r.id, code:error.code || "NETWORK", message:error.message || ""});
        }
      }
      await window.BAP_SYNC.pull({
        db,
        store: "records",
        userId: id,
        cloud: s.cloud,
        kind: "finance",
        active: () => owner() === id,
        merge: (r) => {
          const local = records.find((x) => x.id === r.id);
          if (
            local?.dirty &&
            Date.parse(r.updated_at) <= Date.parse(local.updated_at)
          )
            return null;
          return {
            id: r.id,
            owner_id: r.user_id,
            kind: r.kind,
            data: r.data,
            updated_at: r.updated_at,
            deleted: r.deleted,
            dirty: false,
          };
        },
      });
      if (owner() !== id) return;
      records = await load();
      status = !window.BAP_ACCESS?.canWrite()
        ? "Solo lectura · consulta Mi acceso"
        : records.some((r) => r.owner_id === id && r.dirty)
          ? `Sincronización pendiente · ${records.filter((r) => r.owner_id === id && r.dirty).length} registro(s) por enviar`
          : "Finanzas sincronizadas";
      render();
    } catch (e) {
      console.error("Finance sync", e);
      status = ["42P01", "PGRST205"].includes(e.code)
        ? "Datos locales · falta activar finanzas en la nube"
        : "Sincronización pendiente · datos guardados aquí";
      paintStatus();
    } finally {
      busy = false;
      if (syncQueued) { syncQueued = false; sync(); }
    }
  }
  function paintStatus() {
    const el = q("#finance-sync");
    el.textContent = status;
    if (status.includes("pendiente") || status === "Cambios pendientes") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "text-btn";
      retry.textContent = "Reintentar sincronización";
      retry.onclick = () => sync();
      el.append(" · ", retry);
    }
    for (const issue of syncIssues) {
      const r = active().find((x) => x.id === issue.id);
      const detail = document.createElement("span");
      const reason = /excede/.test(issue.message) ? "El pago supera las cuotas pendientes; revisa si está duplicado o mal asignado." : /Cronograma|cronograma|Compra|programad/.test(issue.message) ? "Revisa el cronograma y sus movimientos vinculados." : /42501|PGRST30/.test(issue.code) ? "Revisa tu sesión y la vigencia en Mi acceso." : /23514|P0001|220/.test(issue.code) ? "El servidor rechazó los datos; revisa importes, fechas y vínculos." : "No se pudo enviar este registro. Revisa la conexión y reintenta.";
      detail.textContent = ` · ${r?.data.name || r?.data.date || "Registro"}: ${reason} (${issue.code}) `;
      el.append(detail);
      if (r) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Revisar registro";
        button.onclick = () => open(r.kind, r.id);
        el.append(button);
      }
    }
    el.classList.toggle(
      "pending",
      status.includes("pendiente") ||
        status.includes("locales") ||
        status.includes("dispositivo"),
    );
  }
  const metric = (name, value, caption, cls = "") =>
    `<div class="finance-metric ${cls}"><span>${esc(name)}</span><strong>${fmt(value)}</strong><small>${esc(caption)}</small></div>`;
  const row = (name, value) =>
    `<div class="finance-row"><span>${esc(name)}</span><strong>${fmt(value)}</strong></div>`;
  function render() {
    if (!db) return;
    paintStatus();
    chooseCredit();
    const period = q("#month").value || day().slice(0, 7),
      rs = visible().filter(r => M.currency(r.data) === selectedCurrency()),
      s = state(),
      a = M.analyze(rs, s.expenses, period, day(), selectedCurrency());
    q("#finance-summary").innerHTML =
      metric(
        "Ingresos cobrados",
        a.earned,
        "Incluye intereses cobrados con desglose",
        "good",
      ) +
      metric("Gastos de consumo", a.purchases, "Incluye compras a crédito") +
      metric(
        "Deuda actual",
        a.totalDebt,
        "Saldo según registros, a la fecha",
        "debt",
      ) +
      metric("Flujo neto del mes", a.cashFlow, "No equivale a saldo bancario");
    const bars = [
        { v: a.cashBudget, c: "#9ab6be" },
        { v: a.payments + a.pending, c: "#7190b9" },
        { v: a.reserve, c: "#a7c88c" },
        { v: a.extra, c: "#dfb481" },
        { v: a.savings, c: "#ae9bc4" },
      ],
      base = bars.reduce((n, x) => n + x.v, 0);
    q("#finance-plan").innerHTML =
      `<p class="finance-help">${a.settings.income == null ? "Usa ingresos efectivamente cobrados del mes." : "Escenario con ingreso mensual esperado: " + fmt(a.incomeBase) + ". No garantiza que ya esté disponible."} Presupuesto de efectivo/débito separado de pagos de deuda.</p>` +
      row("Ingreso usado para el plan", a.incomeBase) +
      row(
        "Gastos efectivo/débito: registrado o presupuesto mayor",
        a.cashBudget,
      ) +
      row("Pagos de deuda ya registrados", a.payments) +
      row(
        "Obligaciones y reserva para tarjetas pendientes del período",
        a.pending,
      ) +
      (a.lent ? row("Dinero prestado durante el mes", a.lent) : "") +
      row("Reserva para imprevistos", a.reserve) +
      row("Abono adicional propuesto", a.extra) +
      row("Ahorro / metas disponible", a.savings) +
      `<div class="allocation-track" aria-hidden="true">${bars.map((b) => `<i style="width:${base ? (b.v / base) * 100 : 0}%;background:${b.c}"></i>`).join("")}</div><div class="plan-remainder"><span>${a.deficitConfirmed ? "DÉFICIT DEL PRESUPUESTO" : a.planReady ? "EXCEDENTE DESPUÉS DE OBLIGACIONES Y RESERVA" : "DATOS PENDIENTES PARA DISTRIBUIR"}</span><strong>${a.deficitConfirmed ? fmt(a.deficit) : a.planReady ? fmt(a.surplus) : "Completa los datos del plan"}</strong></div>`;
    let advice = a.warnings
      .map((t) => `<div class="finance-advice-item warning">${esc(t)}</div>`)
      .join("");
    const paymentGroups = new Map();
    for (const r of rs.filter((r) => !r.deleted && r.kind === "payment")) {
      const d = r.data;
      const key = JSON.stringify([d.debt_id, d.date, num(d.amount), d.principal ?? null, d.schedule_id || "", M.currency(d), d.note || ""]);
      const group = paymentGroups.get(key) || [];
      group.push(r); paymentGroups.set(key, group);
    }
    for (const group of paymentGroups.values()) if (group.length > 1) {
      const d = group[0].data;
      const account = a.debts.find((x) => x.id === d.debt_id) || a.receivables.find((x) => x.id === d.debt_id);
      advice += `<div class="finance-advice-item warning"><strong>Posibles pagos duplicados: ${group.length} registros · ${esc(account?.data.name || "Cuenta")} · ${esc(d.date)} · ${fmt(d.amount)} cada uno</strong><p>Compara tus comprobantes. Dos pagos del mismo importe pueden ser válidos; elimina solo el registro repetido.</p>${group.map((r, i) => `<button type="button" data-fin-edit="${esc(r.id)}">Revisar pago ${i + 1}</button> <button type="button" data-fin-delete="${esc(r.id)}">Eliminar pago ${i + 1}</button>`).join(" ")}</div>`;
    }
    const reviewPayments = new Map([...a.paymentsMissingSchedule, ...a.paymentsMissingCapital].map((r) => [r.id, r]));
    for (const r of reviewPayments.values()) {
      const debt = a.debts.find((d) => d.id === r.data.debt_id);
      const reasons = [];
      if (a.paymentsMissingSchedule.some((p) => p.id === r.id)) reasons.push("cronograma pendiente: selecciona sus cuotas o confirma que corresponde a otro saldo");
      if (a.paymentsMissingCapital.some((p) => p.id === r.id)) reasons.push("capital pendiente: consulta el comprobante o concilia saldo y fecha base");
      advice += `<div class="finance-advice-item warning"><strong>${esc(debt?.data.name || "Cuenta")} · ${esc(r.data.date)} · ${fmt(r.data.amount)}</strong><p>${esc(reasons.join(". "))}.</p><button type="button" data-fin-edit="${esc(r.id)}">Revisar pago</button></div>`;
    }
    if (a.allocations.length)
      advice += `<div class="finance-advice-item"><strong>${a.settings.strategy === "snowball" ? "Bola de nieve · menor saldo primero" : "Avalancha · mayor TEA conocida primero"}</strong>${a.allocations.map((x) => `${esc(x.name)}: abono adicional ${fmt(x.extra)}`).join("<br>")}<br>Confirma con la entidad la aplicación al capital y sus condiciones. Este orden no compara comisiones ni condiciones especiales.</div>`;
    const reserveTarget =
        Math.max(0, num(a.settings.targetMonths ?? 3)) *
        Math.max(0, num(a.settings.expenses)),
      reserveHave = num(a.settings.emergency);
    if (reserveTarget > reserveHave)
      advice += `<div class="finance-advice-item"><strong>Construye tu reserva</strong>Meta configurable: ${fmt(reserveTarget)} (${num(a.settings.targetMonths ?? 3)} meses de gastos presupuestados). Saldo que registraste: ${fmt(reserveHave)}. Faltan ${fmt(reserveTarget - reserveHave)}. La reserva propuesta no se suma al ahorro hasta que tú la registres.</div>`;
    if (!a.deficit && a.planReady && a.savings > 0)
      advice += `<div class="finance-advice-item"><strong>Distribuye según tus prioridades</strong>${a.totalDebt > 0 ? "Mantén el ahorro para imprevistos y metas cercanas; compara el costo de la deuda antes de asumir riesgo de inversión." : reserveHave < reserveTarget ? "Prioriza completar tu reserva antes de invertir dinero que puedes necesitar pronto." : "Separa metas de corto plazo y ahorro de largo plazo. Antes de elegir inversiones, define plazo, tolerancia a pérdidas y necesidad de liquidez; este panel no recomienda productos específicos."}</div>`;
    const first = a.ordered[0];
    if (first && !first.schedules.length && !a.missingRates && a.planReady) {
      const proj = M.project(
        first,
        a.allocations.find((x) => x.id === first.id)?.extra || 0,
      );
      advice += `<div class="finance-advice-item"><strong>Simulación de ${esc(first.data.name)}</strong>${proj.status === "estimated" ? `Aproximadamente ${proj.months} meses e intereses ${fmt(proj.interest)} si mantienes una cuota fija, la TEA registrada y el abono extra cada mes, sin nuevas compras ni comisiones. No es un cronograma bancario.` : proj.status === "insufficient" ? "El pago propuesto no cubre el interés estimado; revisa cuota y tasa con la entidad." : "Completa la TEA y cuota para obtener una simulación. Horizonte máximo: 50 años."}</div>`;
    }
    q("#finance-advice").innerHTML =
      advice ||
      '<div class="finance-empty">Registra tus ingresos, presupuesto y obligaciones para construir tu plan.</div>';
    q("#finance-cash").innerHTML =
      row(
        "Ingresos cobrados (sin repetir intereses de cobros)",
        a.directEarned,
      ) +
      row("Préstamos recibidos: financiación", a.borrowed) +
      row("Cobros de dinero prestado", a.recovered) +
      row("Gastos por efectivo/débito", a.cashExpenses) +
      row("Pagos de tarjetas y préstamos", a.payments) +
      row("Dinero que prestaste", a.lent) +
      row("Flujo neto de los movimientos registrados", a.cashFlow);
    q("#finance-incomes").innerHTML = events(
      rs.filter(
        (r) =>
          !r.deleted &&
          r.kind === "income" &&
          r.data.date?.slice(0, 7) === period,
      ),
    );
    q("#finance-debts").innerHTML =
      a.debts.map((d) => debtCard(d, false)).join("") ||
      '<div class="finance-empty">Agrega tu primera tarjeta o préstamo recibido.</div>';
    q("#finance-receivables").innerHTML =
      a.receivables.map((d) => debtCard(d, true)).join("") ||
      '<div class="finance-empty">Registra el dinero que otras personas te deben.</div>';
    const eventRows = rs.filter(
      (r) =>
        !r.deleted &&
        !r.data.schedule_only &&
        ["payment", "disbursement", "charge"].includes(r.kind) &&
        r.data.date?.slice(0, 7) === period,
    );
    q("#finance-debt-events").innerHTML = events(
      eventRows.filter((r) => a.debts.some((d) => d.id === r.data.debt_id)),
    );
    q("#finance-loan-events").innerHTML = events(
      eventRows.filter((r) =>
        a.receivables.some((d) => d.id === r.data.debt_id),
      ),
    );
  }
  function scheduleView(d) {
    const period = q("#month").value || day().slice(0, 7);
    const plans =
      d.schedules || M.schedules(d, active(), state().expenses, period, day());
    return plans
      .map(
        (
          p,
        ) => `<details class="installment-schedule"><summary>${esc(p.data.name)} · ${p.paidCount} pagadas / ${p.pendingCount} pendientes</summary>
      <p class="finance-help">${p.data.installment_amount != null ? "Cuota bancaria ingresada; confirma intereses y cargos en tu estado de cuenta." : "Estimación: TEA fija convertida a tasa mensual, meses iguales; sin seguros ni comisiones."} ${p.data.paid_before ? "Incluye " + p.data.paid_before + " cuotas históricas declaradas, sin generar movimientos." : ""}</p>
      ${p.stale || p.invalid ? '<p class="finance-advice-item warning">Revisa este cronograma: la compra cambió, fue eliminada o los datos no son válidos.</p>' : ""}
      ${p.overpaid > 0 ? `<p class="finance-advice-item warning">Pagos que exceden el cronograma: ${fmt(p.overpaid)}. Concilia con el banco.</p>` : ""}
      <div class="installment-scroll"><table><caption>Cuotas de ${esc(p.data.name)}</caption><thead><tr><th>Cuota</th><th>Vence</th><th>Importe</th><th>Pagado</th><th>Pendiente</th><th>Estado</th></tr></thead><tbody>${p.items.map((i) => `<tr><td>${i.number}/${p.data.installments}</td><td>${esc(i.due)}</td><td>${fmt(i.amount)}</td><td>${fmt(i.paid)}</td><td>${fmt(i.remaining)}</td><td>${esc(i.status)}</td></tr>`).join("")}</tbody></table></div>
      <button class="text-btn" data-fin-edit="${esc(p.id)}">Editar cronograma</button><button class="text-btn" data-fin-delete="${esc(p.id)}">Eliminar cronograma</button></details>`,
      )
      .join("");
  }
  function debtCard(d, isLoan) {
    const x = d.data,
      b = d.balance;
    return `<article class="debt-card"><header><div><span class="eyebrow">${isLoan ? "POR COBRAR" : x.type === "card" ? "TARJETA DE CRÉDITO" : "PRÉSTAMO / DEUDA"}</span><h3>${esc(x.name)}</h3></div><span class="badge ${d.overdue ? "late" : ""}">${b === 0 ? "Sin saldo" : d.overdue ? "Revisar atraso" : "Activo"}</span></header><div class="balance">${fmt(b)}</div><small class="finance-help">Saldo actual según tu registro · ${M.currency(x)}</small><dl><div><dt>${isLoan ? "Fecha acordada" : "Próximo vencimiento"}</dt><dd>${esc(x.due || "Sin registrar")}</dd></div><div><dt>${isLoan ? "Cuota esperada" : "Cuota / mínimo mensual"}</dt><dd>${x.minimum == null ? "Sin registrar" : fmt(x.minimum)}</dd></div><div><dt>TEA registrada</dt><dd>${x.tea == null ? "Desconocida" : esc(x.tea) + "%"}</dd></div><div><dt>${x.type === "card" ? "Línea disponible según saldo" : "Saldo base"}</dt><dd>${x.type === "card" ? (x.limit ? fmt(Math.max(0, x.limit - b)) : "Sin límite registrado") : fmt(x.balance)}</dd></div>${x.type === "card" ? `<div><dt>Día de corte</dt><dd>${esc(x.cut || "Sin registrar")}</dd></div>` : ""}</dl>${!isLoan ? `<div class="installment-budget">${row("Compromiso del período (mínimo o cuotas, el mayor)", d.required)}${row("Presupuesto reservado", x.monthly_budget || 0)}${row("Objetivo mensual actualizado", d.monthlyTarget)}${x.monthly_budget != null && d.budgetGap > 0 ? `<p class="finance-help">Reserva ${fmt(d.budgetGap)} adicionales para cubrir el compromiso.</p>` : ""}<p class="finance-help">El mínimo no se suma otra vez a las cuotas. Si el estado de cuenta exige más, actualízalo. El presupuesto es una reserva, no un pago.</p></div>` : ""}<div class="debt-actions"><button class="primary" data-fin-action="payment" data-id="${esc(d.id)}">${isLoan ? "Registrar cobro" : "Registrar pago"}</button><button class="outline" data-fin-action="disbursement" data-id="${esc(d.id)}">${isLoan ? "Prestar más" : "Desembolso recibido"}</button>${isLoan ? "" : `<button class="outline" data-fin-action="charge" data-id="${esc(d.id)}">Interés / cargo</button>`}${!isLoan ? `<button class="outline" data-fin-action="schedule" data-id="${esc(d.id)}">${x.type === "card" ? "Programar compra registrada" : "Crear cronograma"}</button>` : ""}<button class="text-btn" data-fin-edit="${esc(d.id)}">Editar</button><button class="text-btn" data-fin-delete="${esc(d.id)}">Eliminar</button></div>${!isLoan ? scheduleView(d) : ""}</article>`;
  }
  function events(rows) {
    return (
      rows
        .sort((a, b) => (b.data.date || "").localeCompare(a.data.date || ""))
        .map((r) => {
          let debt = active().find((x) => x.id === r.data.debt_id);
          let label =
            r.kind === "income"
              ? r.data.name
              : r.kind === "payment"
                ? debt?.kind === "receivable"
                  ? "Cobro"
                  : "Pago"
                : r.kind === "disbursement"
                  ? debt?.kind === "receivable"
                    ? "Dinero prestado"
                    : "Préstamo recibido"
                  : "Cargo a deuda";
          return `<div class="finance-event"><div><strong>${esc(label)}${debt ? " · " + esc(debt.data.name) : ""}</strong><small>${esc(r.data.date)}${r.data.source ? " · " + esc(r.data.source) : ""}${r.kind === "payment" ? " · Capital: " + (r.data.principal == null ? "pendiente" : fmt(r.data.principal)) : ""}${r.kind === "payment" && r.data.schedule_id ? " · Cronograma: " + esc(active().find((p) => p.id === r.data.schedule_id)?.data.name || "Revisar vínculo") : r.kind === "payment" && r.data.payment_allocation === "other" ? " · Otro saldo confirmado" : ""}${r.data.note ? " · " + esc(r.data.note) : ""}</small></div><span>${fmt(r.data.amount)}</span><button class="text-btn" data-fin-edit="${esc(r.id)}">Editar</button><button class="delete" data-fin-delete="${esc(r.id)}" aria-label="Eliminar registro financiero">×</button></div>`;
        })
        .join("") ||
      '<div class="finance-empty">Sin movimientos en el período seleccionado.</div>'
    );
  }
  const field = (id, label, type = "text", value = "", opts = "") =>
    `<label>${esc(label)}<input id="f-${id}" name="${id}" type="${type}" value="${esc(value ?? "")}" ${opts}></label>`;
  const select = (id, label, values, value) =>
    `<label>${esc(label)}<select id="f-${id}" name="${id}">${values.map(([v, t]) => `<option value="${esc(v)}"${String(value) === String(v) ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
  function open(kind, id = null, debtId = null) {
    if (!allowed()) return;
    edit = id ? active().find((r) => r.id === id) : null;
    context = debtId || edit?.data.debt_id;
    formKind = kind;
    if (edit?.data.schedule_only) {
      kind = "schedule";
      formKind = "schedule";
    }
    const d = edit?.data || {},
      moneyOpts = 'min="0" max="999999999" step="0.01"',
      required = moneyOpts + " required";
    let fields = "",
      help = "",
      title = "";
    if (kind === "schedule") {
      const debt = active().find((r) => r.id === context);
      if (!debt || debt.kind !== "debt") return;
      const used = new Set(
        active()
          .filter((r) => r.data.schedule_only && r.id !== edit?.id)
          .map((r) => r.data.expense_id),
      );
      const expenses = state().expenses.filter(
        (e) => !e.deleted && e.credit_id === debt.id && !used.has(e.id),
      );
      if (debt.data.type === "card" && !expenses.length)
        return notify(
          "Primero registra el gasto con esta tarjeta. Cada compra solo puede tener un cronograma activo.",
        );
      if (
        debt.data.type !== "card" &&
        active().some(
          (r) =>
            r.data.schedule_only &&
            r.data.debt_id === debt.id &&
            r.id !== edit?.id,
        )
      )
        return notify(
          "Este préstamo ya tiene cronograma. Edítalo para actualizar sus condiciones.",
        );
      title =
        debt.data.type === "card"
          ? "Cuotas de una compra registrada"
          : "Cronograma del préstamo";
      fields =
        (debt.data.type === "card"
          ? select(
              "expense_id",
              "Compra a programar",
              expenses.map((e) => [
                e.id,
                e.date + " · " + e.merchant + " · " + fmt(e.amount),
              ]),
              d.expense_id || expenses[0]?.id,
            )
          : "") +
        field(
          "name",
          "Nombre del cronograma",
          "text",
          d.name || debt.data.name,
          'required maxlength="100"',
        ) +
        (debt.data.type !== "card"
          ? field(
              "amount",
              "Capital original del cronograma (S/)",
              "number",
              d.amount ?? debt.data.balance,
              required.replace('min="0"', 'min="0.01"'),
            )
          : "") +
        field(
          "installments",
          "Número total de cuotas",
          "number",
          d.installments || 1,
          'required min="1" max="360" step="1"',
        ) +
        field(
          "paid_before",
          "Cuotas pagadas antes de registrar el cronograma",
          "number",
          d.paid_before ?? 0,
          'required min="0" max="359" step="1"',
        ) +
        field(
          "first_due",
          "Vencimiento de la primera cuota (cuota 1)",
          "date",
          d.first_due || debt.data.due || day(),
          "required",
        ) +
        field(
          "tea",
          "TEA de esta operación % (0 = sin intereses)",
          "number",
          d.tea ?? debt.data.tea,
          'min="0" max="2000" step="0.01"',
        ) +
        field(
          "installment_amount",
          "Cuota bancaria confirmada (S/), opcional",
          "number",
          d.installment_amount,
          moneyOpts,
        );
      help =
        "No agrega deuda ni duplica el gasto. Elige la primera fecha de pago según el cierre del banco. La cuota bancaria ingresada prevalece sobre el cálculo por TEA. Sin cuota bancaria se estima una cuota fija, sin seguros ni comisiones. Las cuotas históricas no generan pagos; el saldo base debe reflejar lo realmente pendiente.";
    }
    if (kind === "income") {
      title = "Registrar ingreso cobrado";
      fields =
        field(
          "name",
          "Descripción / fuente",
          "text",
          d.name,
          'required maxlength="100"',
        ) +
        field(
          "amount",
          "Monto recibido (S/)",
          "number",
          d.amount,
          required.replace('min="0"', 'min="0.01"'),
        ) +
        field(
          "date",
          "Fecha de cobro",
          "date",
          d.date || day(),
          'required max="' + day() + '"',
        ) +
        select(
          "source",
          "Tipo de ingreso",
          [
            ["Sueldo", "Sueldo"],
            ["Servicios", "Servicios / BAP"],
            ["Ventas", "Ventas"],
            ["Otros", "Otros"],
          ],
          d.source || "Sueldo",
        );
      help =
        "Solo dinero ganado y recibido. Los préstamos y devoluciones de capital se registran por separado.";
    }
    if (["debt", "receivable"].includes(kind)) {
      title = kind === "debt" ? "Tarjeta o deuda" : "Dinero por cobrar";
      fields =
        field(
          "name",
          "Alias / entidad o persona",
          "text",
          d.name,
          'required maxlength="100"',
        ) +
        (kind === "debt"
          ? select(
              "type",
              "Tipo",
              [
                ["card", "Tarjeta de crédito"],
                ["loan", "Préstamo recibido"],
                ["other", "Otra deuda"],
              ],
              d.type || "card",
            )
          : "") +
        field(
          "balance",
          "Saldo base pendiente (S/)",
          "number",
          d.balance ?? 0,
          required,
        ) +
        field(
          "date",
          "Fecha base del saldo",
          "date",
          d.date || day(),
          'required max="' + day() + '"',
        ) +
        field(
          "minimum",
          kind === "debt"
            ? "Cuota / mínimo mensual (S/), vacío si desconocido"
            : "Cuota acordada (S/), opcional",
          "number",
          d.minimum,
          moneyOpts,
        ) +
        field("due", "Próximo vencimiento, opcional", "date", d.due) +
        (kind === "debt"
          ? field(
              "monthly_budget",
              "Presupuesto mensual reservado para esta cuenta (S/)",
              "number",
              d.monthly_budget,
              moneyOpts,
            ) +
            field(
              "monthly_base",
              "Otros compromisos mensuales fuera de cronogramas (S/)",
              "number",
              d.monthly_base,
              moneyOpts,
            )
          : "") +
        field(
          "tea",
          "TEA % (0 si sin interés; vacío si desconocida)",
          "number",
          d.tea,
          'min="0" max="2000" step="0.01"',
        ) +
        (kind === "debt"
          ? field(
              "limit",
              "Límite tarjeta (S/), opcional",
              "number",
              d.limit,
              moneyOpts,
            ) +
            field(
              "cut",
              "Día de corte tarjeta, opcional",
              "number",
              d.cut,
              'min="1" max="31" step="1"',
            )
          : "");
      help =
        "El saldo base no genera un ingreso ni una salida de efectivo. Debe ser anterior a los movimientos del día base: la app suma compras/cargos/desembolsos y resta capital desde esa fecha, inclusive. Para conciliar, usa un saldo y fecha que no dupliquen movimientos. La TEA debe venir del contrato, no sustituirla por TCEA. Otros compromisos se suman a las cuotas; no incluyas ahí importes ya programados. El mínimo del banco es un piso, no se suma otra vez.";
    }
    if (["payment", "disbursement", "charge"].includes(kind)) {
      const debt = active().find((r) => r.id === context);
      if (!debt) return;
      title =
        kind === "payment"
          ? debt.kind === "receivable"
            ? "Registrar cobro"
            : "Registrar pago"
          : kind === "disbursement"
            ? debt.kind === "receivable"
              ? "Registrar dinero prestado"
              : "Registrar desembolso recibido"
            : "Interés o cargo a la deuda";
      fields =
        field(
          "amount",
          kind === "charge"
            ? "Cargo que aumenta la deuda (S/)"
            : "Importe total (S/)",
          "number",
          d.amount,
          required.replace('min="0"', 'min="0.01"'),
        ) +
        (kind === "payment"
          ? field(
              "principal",
              "Parte aplicada a capital (S/), vacío si desconocida",
              "number",
              d.principal,
              moneyOpts,
            )
          : "") +
        field(
          "date",
          "Fecha del movimiento",
          "date",
          d.date || day(),
          'required max="' + day() + '" min="' + esc(debt.data.date) + '"',
        );
      if (kind === "payment" && debt.kind === "debt") {
        const plans = active().filter(
          (r) =>
            r.kind === "charge" &&
            r.data.schedule_only &&
            r.data.debt_id === debt.id,
        );
        fields += select(
          "schedule_id",
          "Aplicar pago a cronograma",
          [
            ["", "Pendiente de asignar"],
            ...plans.map((p) => [p.id, p.data.name]),
            ["__other__", "Otro saldo de la cuenta (sin cronograma)"],
          ],
          d.schedule_id || (d.payment_allocation === "other" ? "__other__" : ""),
        );
      }
      help =
        kind === "payment"
          ? "El capital reduce el saldo. La diferencia entre total y capital representa intereses/cargos; consulta el comprobante. Si dejas capital vacío, se registra el efectivo sin reducir todavía la deuda. Si eliges un cronograma, el importe se aplica a sus cuotas pendientes en orden, incluso si el pago es parcial. Si pagas varias compras en una sola operación, registra sus partes por separado: la suma debe coincidir con el comprobante. Actualiza el mínimo con el estado de cuenta."
          : kind === "charge"
            ? "Aumenta el saldo sin movimiento de efectivo; no vuelvas a sumarlo si ya está incluido en el saldo base."
            : "Aumenta el saldo y registra la entrada (préstamo recibido) o salida (dinero prestado) de efectivo. No lo registres también como ingreso o gasto.";
    }
    if (kind === "settings") {
      title = "Tu presupuesto y estrategia";
      fields =
        field(
          "income",
          "Ingreso mensual esperado (S/), vacío = cobrado",
          "number",
          d.income,
          moneyOpts,
        ) +
        field(
          "expenses",
          "Presupuesto efectivo/débito del mes (S/)",
          "number",
          d.expenses ?? 0,
          required,
        ) +
        field(
          "reserve",
          "Aporte mensual para imprevistos (S/)",
          "number",
          d.reserve ?? 0,
          required,
        ) +
        field(
          "emergency",
          "Fondo de emergencia que ya tienes (S/)",
          "number",
          d.emergency ?? 0,
          required,
        ) +
        field(
          "targetMonths",
          "Meta de reserva: meses de gastos",
          "number",
          d.targetMonths ?? 3,
          'min="0" max="24" step="1" required',
        ) +
        field(
          "debtPercent",
          "% del excedente para abonos extra",
          "number",
          d.debtPercent ?? 80,
          'min="0" max="100" step="1" required',
        ) +
        select(
          "strategy",
          "Orden de abonos",
          [
            ["avalanche", "Avalancha: mayor TEA conocida"],
            ["snowball", "Bola de nieve: menor saldo"],
          ],
          d.strategy || "avalanche",
        );
      help =
        "El ingreso esperado es un escenario, no efectivo disponible. Presupuesta gastos de efectivo/débito sin incluir pagos de deuda ni compras a crédito. Si tus gastos registrados son mayores, se utiliza el mayor valor. Primero se cubren cuotas pendientes y reserva; el porcentaje se aplica al excedente. Las metas de reserva y porcentajes son editables.";
    }
    if (kind !== "settings")
      fields += field(
        "note",
        "Nota, opcional",
        "text",
        d.note,
        'maxlength="200"',
      );
    const account = active().find(r => r.id === context);
    const cur = M.currency(edit?.data || account?.data || {currency: selectedCurrency()});
    if (kind !== "settings") fields = select("currency", "Moneda del registro", [["PEN", "Soles · PEN"], ["USD", "Dólares · USD"]], cur) + fields;
    fields = fields.replaceAll("(S/)", "(moneda elegida)").replaceAll("(S/),", "(moneda elegida),");
    if (kind === "settings") fields = fields.replaceAll("(moneda elegida)", "(" + symbol() + ")");
    help += " Soles y dólares se calculan por separado. Los pagos y cuotas deben estar en la moneda de la cuenta. Para una tarjeta bimoneda, registra una cuenta por moneda.";
    q("#finance-title").textContent = title;
    q("#finance-fields").innerHTML = fields;
    if (q("#f-currency")) q("#f-currency").disabled = !!edit || kind === "schedule";
    q("#finance-form-help").textContent = help;
    q("#finance-error").textContent = "";
    q("#finance-editor").showModal();
  }
  q("#finance-form").onsubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    submitting = true;
    try { await submitFinance(e); }
    finally { submitting = false; }
  };
  async function submitFinance(e) {
    let data = Object.fromEntries(new FormData(e.target));
    const numeric = [
      "amount",
      "principal",
      "balance",
      "minimum",
      "tea",
      "limit",
      "cut",
      "income",
      "expenses",
      "reserve",
      "emergency",
      "targetMonths",
      "debtPercent",
      "monthly_budget",
      "monthly_base",
      "installments",
      "paid_before",
      "installment_amount",
    ];
    for (const k of numeric)
      if (k in data) data[k] = data[k] === "" ? null : Number(data[k]);
    if (data.schedule_id === "__other__") {
      delete data.schedule_id;
      data.payment_allocation = "other";
    } else if (data.schedule_id) data.payment_allocation = "schedule";
    else delete data.schedule_id;
    const account = active().find(r => r.id === context);
    data.currency = formKind === "settings" ? selectedCurrency() : q("#f-currency")?.value || M.currency(edit?.data || account?.data);
    if (account && M.currency(account.data) !== data.currency) return (q("#finance-error").textContent = "El pago o movimiento debe estar en " + M.currency(account.data) + ", la moneda de esta cuenta. No se convierten importes automáticamente.");
    if (context) data.debt_id = context;
    const err = q("#finance-error");
    err.textContent = "";
    if (
      data.principal != null &&
      (data.principal < 0 || data.principal > data.amount)
    )
      return (err.textContent =
        "El capital debe estar entre cero y el importe total.");
    const debt = active().find((r) => r.id === context);
    if (formKind === "schedule" && debt) {
      data.schedule_only = true;
      data.date = edit?.data.date || day();
      if (debt.data.type === "card") {
        const purchase = state().expenses.find(
          (x) =>
            !x.deleted && x.id === data.expense_id && x.credit_id === debt.id,
        );
        if (!purchase)
          return (err.textContent = "Compra vinculada no disponible.");
        if (
          active().some(
            (r) =>
              r.id !== edit?.id &&
              r.data.schedule_only &&
              r.data.expense_id === purchase.id,
          )
        )
          return (err.textContent = "Esta compra ya tiene un cronograma.");
        if (M.currency(purchase) !== data.currency) return (err.textContent = "La compra y el cronograma deben tener la misma moneda.");
        data.amount = purchase.amount;
      }
      if (data.paid_before >= data.installments)
        return (err.textContent =
          "Las cuotas históricas deben ser menores al total.");
      if (data.tea == null && data.installment_amount == null)
        return (err.textContent =
          "Completa la TEA o la cuota bancaria confirmada.");
      if (
        edit &&
        active().some(
          (r) => r.kind === "payment" && r.data.schedule_id === edit.id,
        )
      ) {
        const keys = [
          "amount",
          "installments",
          "paid_before",
          "first_due",
          "tea",
          "installment_amount",
          "expense_id",
        ];
        if (keys.some((k) => (data[k] ?? null) !== (edit.data[k] ?? null)))
          return (err.textContent =
            "Este cronograma tiene pagos. Concilia o desvincula esos pagos antes de modificar sus condiciones.");
      }
    }
    if (formKind === "payment" && data.schedule_id) {
      const plan = active().find(
        (r) =>
          r.id === data.schedule_id &&
          r.data.schedule_only &&
          r.data.debt_id === context,
      );
      if (!plan) return (err.textContent = "Cronograma no disponible.");
      const summary = M.schedules(
        debt,
        visible().filter((r) => r.id !== edit?.id),
        state().expenses,
        day().slice(0, 7),
        day(),
      ).find((p) => p.id === plan.id);
      if (!summary || summary.stale || summary.invalid)
        return (err.textContent =
          "Corrige el cronograma antes de asignar un pago.");
      if (
        data.amount >
        M.round(summary.items.reduce((sum, i) => sum + i.remaining, 0)) + 0.005
      )
        return (err.textContent =
          "El importe supera las cuotas pendientes. Registra el excedente como pago a otro saldo.");
    }
    if (formKind === "payment" && debt) {
      let rows = visible().filter((r) => r.id !== edit?.id),
        b = M.balance(debt, rows, state().expenses);
      if (data.principal > b + 0.005)
        return (err.textContent =
          "El capital supera el saldo registrado. Revisa el saldo y movimientos.");
    }
    if (data.name) data.name = data.name.trim();
    if (["income", "debt", "receivable"].includes(formKind) && !data.name)
      return (err.textContent = "Escribe un nombre o alias.");
    if (formKind === "payment" && !edit && active().some((r) => r.kind === "payment" &&
      r.data.debt_id === data.debt_id && r.data.date === data.date &&
      M.currency(r.data) === data.currency && num(r.data.amount) === num(data.amount) &&
      (r.data.principal ?? null) === (data.principal ?? null) &&
      (r.data.schedule_id || "") === (data.schedule_id || ""))) {
      if (!confirm("Ya existe un pago con la misma cuenta, fecha, importe y asignación. ¿Confirmas que es otra operación real y deseas registrarla? Si es el mismo comprobante, cancela y edita el pago existente.")) return;
    }
    q("#finance-save").disabled = true;
    try {
      const id =
        formKind === "settings"
          ? edit?.id || await budgetId(data.currency)
          : edit?.id;
      await save(formKind === "schedule" ? "charge" : formKind, data, id);
      q("#finance-editor").close();
      notify("Registro financiero guardado.");
    } catch (e) {
      err.textContent =
        e.message === "Registro inválido"
          ? "Revisa importes, fechas y condiciones del cronograma."
          : "No se pudo guardar; revisa el almacenamiento del navegador.";
      console.error(e);
    } finally {
      q("#finance-save").disabled = false;
    }
  }
  q("#finance-close").onclick = q("#finance-cancel").onclick = () =>
    q("#finance-editor").close();
  q("#finance-settings").onclick = () => {
    const r = active().find((r) => r.kind === "settings" && M.currency(r.data) === selectedCurrency());
    open("settings", r?.id);
  };
  q("#finanzas").onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.finTab) {
      document
        .querySelectorAll("[data-fin-tab]")
        .forEach((el) => el.setAttribute("aria-selected", String(el === b)));
      document
        .querySelectorAll("[data-fin-panel]")
        .forEach(
          (el) => (el.hidden = el.dataset.finPanel !== b.dataset.finTab),
        );
    }
    if (b.dataset.finAdd) open(b.dataset.finAdd);
    if (b.dataset.finAction) open(b.dataset.finAction, null, b.dataset.id);
    if (b.dataset.finEdit) {
      const r = active().find((r) => r.id === b.dataset.finEdit);
      if (r) open(r.kind, r.id);
    }
    if (b.dataset.finDelete) {
      if (!allowed()) return;
      const r = active().find((r) => r.id === b.dataset.finDelete);
      if (!r) return;
      const linkedPayments = r.data.schedule_only ? active().filter((x) => x.kind === "payment" && x.data.schedule_id === r.id) : [];
      if (
        ["debt", "receivable"].includes(r.kind) &&
        (active().some((x) => x.data.debt_id === r.id) ||
          state().expenses.some((x) => !x.deleted && x.credit_id === r.id))
      )
        return notify(
          "Elimina primero los movimientos vinculados o conserva la cuenta con saldo cero.",
        );
      if (
        !confirm(
          linkedPayments.length ? `¿Eliminar solo el cronograma y desvincular sus ${linkedPayments.length} pago(s)? Los pagos y el capital abonado se conservan. Revisa después sus asignaciones. Se sincronizará en tus dispositivos.` : "¿Eliminar este registro financiero? Se sincronizará la eliminación en tus dispositivos.",
        )
      )
        return;
      // Unlink payments and tombstone the schedule in one local transaction.
      const stamp = nextStamp();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("records", "readwrite"), store = tx.objectStore("records");
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => {};
        for (const payment of linkedPayments) {
          const data = {...payment.data};
          delete data.schedule_id;
          delete data.payment_allocation;
          store.put({...payment, data, dirty:true, updated_at:stamp});
        }
        store.put({...r, deleted:true, dirty:true, updated_at:stamp});
      });
      records = await load();
      render();
      sync();
    }
  };
  q("#month").addEventListener("change", render);
  window.addEventListener("bap:render", attach);
  window.addEventListener("online", sync);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) sync();
  });
  function download(blob, name) {
    const a = document.createElement("a"),
      url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  q("#finance-backup").onclick = () => {
    if (!allowed(false)) return;
    download(
      new Blob(
        [
          JSON.stringify(
            {
              format: "bap-finance-v1",
              exported: new Date().toISOString(),
              records: visible(),
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      "BAP_Finanzas_" + day() + ".json",
    );
  };
  q("#finance-restore").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file || !allowed()) return;
    try {
      const backup = JSON.parse(await file.text());
      if (
        backup.format !== "bap-finance-v1" ||
        !Array.isArray(backup.records) ||
        backup.records.length > 50000
      )
        throw Error("Formato");
      for (const r of backup.records)
        if (!M.validRecord(r)) throw Error("Registro");
      const allIds = new Set(
        [
          ...active().filter((r) => ["debt", "receivable"].includes(r.kind)),
          ...backup.records.filter(
            (r) => !r.deleted && ["debt", "receivable"].includes(r.kind),
          ),
        ].map((r) => r.id),
      );
      for (const r of backup.records)
        if (
          !r.deleted &&
          ["payment", "disbursement", "charge"].includes(r.kind) &&
          !allIds.has(r.data.debt_id)
        )
          throw Error("Cuenta vinculada ausente");
      const merged = [
        ...active().filter((r) => !backup.records.some((x) => x.id === r.id || (r.kind === "settings" && x.kind === "settings" && M.currency(r.data) === M.currency(x.data)))),
        ...backup.records.filter((r) => !r.deleted),
      ];
      const budgets = new Set();
      for (const r of merged) {
        const previous = active().find(x => x.id === r.id);
        if (previous && M.currency(previous.data) !== M.currency(r.data)) throw Error("Moneda distinta para un ID existente");
        if (r.kind === "settings") {
          if (budgets.has(M.currency(r.data))) throw Error("Presupuesto duplicado por moneda");
          budgets.add(M.currency(r.data));
        }
        if (r.data.debt_id) {
          const account = merged.find(x => x.id === r.data.debt_id);
          if (!account || M.currency(account.data) !== M.currency(r.data)) throw Error("Moneda de la cuenta incompatible");
        }
      }
      const linkedExpenses = new Set();
      for (const r of merged) {
        if (r.data.schedule_only) {
          const account = merged.find(
            (d) => d.id === r.data.debt_id && d.kind === "debt",
          );
          if (!account) throw Error("Cuenta de cronograma ausente");
          if (r.data.expense_id) {
            if (linkedExpenses.has(r.data.expense_id))
              throw Error("Cronograma duplicado");
            linkedExpenses.add(r.data.expense_id);
          }
        }
        if (
          r.data.schedule_id &&
          !merged.some(
            (p) =>
              p.id === r.data.schedule_id &&
              p.data.schedule_only &&
              p.data.debt_id === r.data.debt_id,
          )
        )
          throw Error("Cronograma de pago ausente");
      }
      if (
        !confirm(
          "¿Restaurar estos registros financieros en la cuenta actual? Los ID coincidentes se reemplazarán.",
        )
      )
        return;
      const restoredRows = await Promise.all(backup.records.map(async r => ({...r, id:r.kind === "settings" ? active().find(x => x.kind === "settings" && M.currency(x.data) === M.currency(r.data))?.id || await budgetId(M.currency(r.data)) : r.id})));
      await transact("readwrite", (store) => {
        for (const r of restoredRows) {
          store.put({
            ...r,
            owner_id: owner(),
            updated_at: new Date().toISOString(),
            deleted: !!r.deleted,
            dirty: true,
          });
        }
      });
      records = await load();
      render();
      sync();
      notify("Respaldo financiero restaurado.");
    } catch (err) {
      notify("El archivo no es un respaldo financiero válido.");
    } finally {
      e.target.value = "";
    }
  };
  function reportRows() {
    const period = q("#month").value;
    const dataRows = active()
      .filter(
        (r) =>
          r.kind !== "settings" &&
          (r.data.schedule_only ||
            ["debt", "receivable"].includes(r.kind) ||
            r.data.date?.slice(0, 7) === period),
      )
      .map((r) => [
        r.data.date,
        r.kind,
        r.data.name ||
          active().find((d) => d.id === r.data.debt_id)?.data.name ||
          "",
        r.data.amount ?? r.data.balance ?? 0,
        r.data.principal ?? "",
        r.data.minimum ?? "",
        r.data.tea ?? "",
        r.data.due || "",
        r.data.note || "",
        r.data.schedule_only ? r.data.installments : "",
        r.data.schedule_only ? r.data.paid_before : "",
        r.data.first_due || "",
        r.data.installment_amount ?? "",
        r.data.monthly_budget ?? "",
        active().find((p) => p.id === r.data.schedule_id)?.data.name || "",
        "",
        "",
        M.currency(r.data),
      ]);
    const installmentRows = active()
      .filter((r) => r.kind === "debt")
      .flatMap((d) =>
        M.schedules(d, active(), state().expenses, period, day()).flatMap((p) =>
          p.items.map((i) => [
            i.due,
            "cuota " + i.number + "/" + p.data.installments,
            p.data.name,
            i.amount,
            i.principal ?? "",
            "",
            p.data.tea ?? "",
            i.due,
            i.status,
            p.data.installments,
            p.data.paid_before,
            p.data.first_due,
            p.data.installment_amount ?? "",
            "",
            d.data.name,
            i.paid,
            i.remaining,
            M.currency(d.data),
          ]),
        ),
      );
    return [...dataRows, ...installmentRows];
  }
  q("#finance-excel").onclick = () => {
    if (!allowed(false)) return;
    const rows = reportRows();
    if (!rows.length)
      return notify("No hay registros financieros para exportar.");
    download(
      window.BAP_XLSX.createTable(
        [
          "Fecha",
          "Tipo",
          "Descripción / cuenta",
          "Monto o saldo base",
          "Capital",
          "Cuota",
          "TEA %",
          "Vencimiento",
          "Nota",
          "Total cuotas",
          "Cuotas históricas",
          "Primera cuota",
          "Cuota bancaria",
          "Presupuesto mensual",
          "Cronograma del pago",
          "Pagado cuota",
          "Pendiente cuota",
          "Moneda",
        ],
        rows,
        [3, 4, 5, 6, 9, 10, 12, 13, 15, 16],
        "Finanzas",
        [3, 4, 5, 12, 13, 15, 16],
        "NUMBER",
      ),
      `BAP_Finanzas_${q("#month").value}.xlsx`,
    );
  };
  q("#finance-pdf").onclick = () => {
    if (!allowed(false)) return;
    const a = M.analyze(visible(), state().expenses, q("#month").value, day(), selectedCurrency()),
      w = window.open("", "_blank");
    if (!w) return notify("Permite ventanas emergentes para exportar PDF.");
    w.document.write(
      `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>BAP · Plan financiero</title><style>body{font:13px/1.6 Arial;color:#172b47;margin:35px}h1{font-size:27px}h2{margin-top:26px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:9px;border-bottom:1px solid #dce5ec}th{background:#edf3f5}.finance-row{display:flex;justify-content:space-between;padding:9px;border-bottom:1px solid #eee}.allocation-track{display:none}.plan-remainder{padding:15px;background:#edf3f5}p{color:#5c7185}.finance-advice-item{margin:10px 0;padding:10px;background:#f5f7fa}button{display:none}@page{size:A4;margin:18mm}</style></head><body><h1>BAP · Plan financiero</h1><p>Período ${esc(q("#month").value)} · Moneda ${selectedCurrency()} · Emitido ${esc(day())} · Saldos actuales según registro</p><h2>Distribución propuesta</h2>${q("#finance-plan").innerHTML}<h2>Guía y supuestos</h2>${q("#finance-advice").innerHTML}<h2>Deudas</h2><table><thead><tr><th>Cuenta</th><th>Saldo</th><th>Cuota registrada</th><th>Vence</th></tr></thead><tbody>${a.debts.map((d) => `<tr><td>${esc(d.data.name)}</td><td>${fmt(d.balance)}</td><td>${d.data.minimum == null ? "Desconocida" : fmt(d.data.minimum)}</td><td>${esc(d.data.due || "Pendiente")}</td></tr>`).join("")}</tbody></table><h2>Cronogramas de cuotas</h2>${a.debts.map((d) => `<h3>${esc(d.data.name)}</h3>${scheduleView(d).replaceAll("<details ", "<details open ")}`).join("")}<p>Orientación automática. La simulación excluye nuevas compras, comisiones y cambios de tasa. No constituye un cronograma bancario.</p><script src="${location.origin + location.pathname.replace(/[^/]*$/, "")}print-report.js"></script></body></html>`,
    );
    w.document.close();
  };
  window.BAP_FINANCE = {
    chooseCredit,
    cards: () => active().filter(r => r.kind === "debt" && r.data.type === "card"),
    async clearOwner(id) {
      for (const r of records.filter((r) => r.owner_id === id))
        await transact("readwrite", (s) => s.delete(r.id));
      await window.BAP_SYNC.clearCursor(db, "records", id);
      records = await load();
      render();
    },
  };
  const request = indexedDB.open(
    state().demo ? "bap-finance-demo-v1" : "bap-finance-v1",
    1,
  );
  request.onupgradeneeded = () =>
    request.result.createObjectStore("records", { keyPath: "id" });
  request.onsuccess = async () => {
    db = request.result;
    records = await load();
    if (state().demo) {
      const banner = document.createElement("div");
      banner.className = "finance-advice-item warning";
      banner.innerHTML =
        '<strong>Demostración con datos ficticios</strong>Este espacio usa una base separada y no sincroniza con tu cuenta. <a href="./">Volver a mis finanzas</a>';
      q("main").prepend(banner);
      if (!records.length) {
        const first = day().slice(0, 7) + "-01",
          cardId = crypto.randomUUID(),
          sample = [
            {
              id: cardId,
              kind: "debt",
              data: {
                name: "Tarjeta de ejemplo",
                type: "card",
                balance: 2400,
                date: first,
                minimum: 180,
                tea: 45,
                limit: 5000,
                due: day().slice(0, 7) + "-20",
                cut: 5,
              },
            },
            {
              id: crypto.randomUUID(),
              kind: "income",
              data: {
                name: "Sueldo de ejemplo",
                amount: 3500,
                date: first,
                source: "Sueldo",
              },
            },
            {
              id: "00000000-0000-4000-8000-000000000001",
              kind: "settings",
              data: {
                expenses: 1800,
                reserve: 200,
                emergency: 600,
                targetMonths: 3,
                debtPercent: 80,
                strategy: "avalanche",
              },
            },
          ];
        for (const r of sample)
          await put({
            ...r,
            owner_id: null,
            updated_at: new Date().toISOString(),
            deleted: false,
            dirty: false,
          });
        records = await load();
      }
    }
    status = state().configured
      ? "Inicia sesión para sincronizar"
      : "Solo en este dispositivo";
    await attach();
    setInterval(sync, 30000);
  };
  request.onerror = () => {
    status = "No se pudo abrir la base financiera";
    paintStatus();
  };
})();


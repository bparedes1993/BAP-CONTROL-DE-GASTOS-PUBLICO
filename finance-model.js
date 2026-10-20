"use strict";
(function (root) {
  const n = (v) => Number(v) || 0,
    round = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
  const month = (date) => String(date || "").slice(0, 7);
  // Records without a currency belong to the original PEN ledger.
  const currency = (data) => data?.currency ?? "PEN";
  function balance(debt, rows, expenses) {
    const base = debt.data;
    let amount = n(base.balance);
    for (const e of expenses.filter(
      (e) => !e.deleted && e.credit_id === debt.id && e.date >= base.date && currency(e) === currency(base),
    ))
      amount += n(e.amount);
    for (const r of rows.filter(
      (r) =>
        !r.deleted && r.data.debt_id === debt.id && r.data.date >= base.date && currency(r.data) === currency(base),
    )) {
      if (
        r.kind === "disbursement" ||
        (r.kind === "charge" && !r.data.schedule_only)
      )
        amount += n(r.data.amount);
      if (r.kind === "payment") amount -= n(r.data.principal);
    }
    return round(Math.max(0, amount));
  }
  // A schedule is metadata in an existing charge record, never a second purchase.
  function dueDate(first, offset) {
    const [y, m, d] = first.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1 + offset, 1));
    const last = new Date(
      Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0),
    ).getUTCDate();
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
  }
  function scheduleItems(data) {
    const count = data.installments;
    if (!Number.isInteger(count) || count < 1 || count > 360)
      throw Error("Número de cuotas inválido");
    const rate =
      data.tea == null ? null : Math.pow(1 + data.tea / 100, 1 / 12) - 1;
    if (data.installment_amount == null && rate == null)
      throw Error("Completa la TEA o la cuota bancaria");
    const fixed =
      data.installment_amount ??
      (rate === 0
        ? data.amount / count
        : (data.amount * rate) / (1 - Math.pow(1 + rate, -count)));
    // Confirmed bank installments may include insurance/fees; do not invent a principal split.
    const bank = data.installment_amount != null;
    let principal = data.amount;
    return Array.from({ length: count }, (_, i) => {
      const interest = bank ? null : round(principal * rate);
      const amount = bank
        ? round(fixed)
        : i === count - 1
          ? round(principal + interest)
          : round(fixed);
      const capital = bank ? null : round(amount - interest);
      if (!bank) principal = round(principal - capital);
      return {
        number: i + 1,
        due: dueDate(data.first_due, i),
        amount,
        principal: capital,
        interest,
        bank,
      };
    });
  }
  function schedules(debt, rows, expenses, period, today) {
    const end = dueDate(period + "-01", 1); // exclusive end of selected month
    return rows
      .filter(
        (r) =>
          !r.deleted &&
          r.kind === "charge" &&
          r.data.schedule_only === true &&
          r.data.debt_id === debt.id && currency(r.data) === currency(debt.data),
      )
      .map((r) => {
        const d = r.data;
        const expense = d.expense_id
          ? expenses.find(
              (e) =>
                !e.deleted && e.id === d.expense_id && e.credit_id === debt.id,
            )
          : null;
        const stale =
          !!d.expense_id &&
          (!expense || currency(expense) !== currency(d) || round(expense.amount) !== round(d.amount));
        let items;
        try {
          items = scheduleItems(d);
        } catch {
          return {
            ...r,
            invalid: true,
            items: [],
            required: 0,
            paidCount: 0,
            pendingCount: 0,
          };
        }
        const payments = rows.filter(
          (p) =>
            !p.deleted &&
            p.kind === "payment" &&
            p.data.schedule_id === r.id &&
            p.data.debt_id === debt.id &&
            p.data.date <= today && currency(p.data) === currency(d),
        );
        let available = Math.round(
          payments.reduce((sum, p) => sum + n(p.data.amount), 0) * 100,
        );
        let periodAvailable = Math.round(
          payments
            .filter((p) => p.data.date < end)
            .reduce((sum, p) => sum + n(p.data.amount), 0) * 100,
        );
        const before = n(d.paid_before);
        items = items.map((item, i) => {
          const cents = Math.round(item.amount * 100);
          const paid = i < before ? cents : Math.min(cents, available);
          const periodPaid =
            i < before ? cents : Math.min(cents, periodAvailable);
          if (i >= before) {
            available -= paid;
            periodAvailable -= periodPaid;
          }
          const remaining = (cents - paid) / 100;
          return {
            ...item,
            paid: paid / 100,
            remaining,
            periodRemaining: (cents - periodPaid) / 100,
            status:
              remaining === 0
                ? "Pagada"
                : paid > 0
                  ? "Parcial"
                  : item.due < today
                    ? "Vencida"
                    : "Pendiente",
          };
        });
        return {
          ...r,
          items,
          stale,
          invalid: false,
          paidCount: items.filter((i) => i.remaining === 0).length,
          pendingCount: items.filter((i) => i.remaining > 0).length,
          overpaid: available / 100,
          required: round(
            items
              .filter((i) => i.due < end)
              .reduce((sum, i) => sum + i.periodRemaining, 0),
          ),
          monthTotal: round(
            items
              .filter((i) => month(i.due) === period)
              .reduce((sum, i) => sum + i.amount, 0),
          ),
        };
      });
  }
  function analyze(rows, expenses, period, day, selectedCurrency = "PEN") {
    if (!["PEN", "USD"].includes(selectedCurrency)) throw Error("Moneda inválida");
    rows = rows.filter((r) => currency(r.data) === selectedCurrency);
    expenses = expenses.filter((e) => currency(e) === selectedCurrency);
    rows = rows.filter(
      (r) =>
        !r.deleted &&
        (r.kind === "settings" || !r.data.date || r.data.date <= day),
    );
    expenses = expenses.filter((e) => !e.deleted && e.date <= day);
    const settings = rows.find((r) => r.kind === "settings")?.data || {};
    const inMonth = rows.filter((r) => month(r.data.date) === period),
      directEarned = round(
        inMonth
          .filter((r) => r.kind === "income")
          .reduce((a, r) => a + n(r.data.amount), 0),
      );
    const purchases = round(
      expenses
        .filter((e) => month(e.date) === period)
        .reduce((a, e) => a + n(e.amount), 0),
    );
    const cashExpenses = round(
      expenses
        .filter((e) => month(e.date) === period && !e.credit_id)
        .reduce((a, e) => a + n(e.amount), 0),
    );
    const debts = rows
      .filter((r) => r.kind === "debt")
      .map((r) => {
        const paid = inMonth
          .filter((x) => x.kind === "payment" && x.data.debt_id === r.id)
          .reduce((a, x) => a + n(x.data.amount), 0);
        const b = balance(r, rows, expenses);
        const plans = schedules(r, rows, expenses, period, day);
        const scheduledPending = round(
          plans.reduce((sum, p) => sum + p.required, 0),
        );
        const legacyPending = Math.min(
          b,
          Math.max(0, n(r.data.minimum) - paid),
        );
        const otherPaid = inMonth
          .filter(
            (x) =>
              x.kind === "payment" &&
              x.data.debt_id === r.id &&
              !x.data.schedule_id,
          )
          .reduce((sum, x) => sum + n(x.data.amount), 0);
        const remaining = round(
          Math.max(
            legacyPending,
            scheduledPending + Math.max(0, n(r.data.monthly_base) - otherPaid),
          ),
        );
        const required = Math.max(
          0,
          n(r.data.minimum),
          n(r.data.monthly_base) +
            plans.reduce((sum, p) => sum + p.monthTotal, 0),
        );
        return {
          ...r,
          balance: b,
          paid: round(paid),
          remaining,
          schedules: plans,
          required,
          monthlyTarget: round(Math.max(required, n(r.data.monthly_budget))),
          budgetGap: round(Math.max(0, required - n(r.data.monthly_budget))),
          budgetPending: round(
            Math.max(remaining, n(r.data.monthly_budget) - paid),
          ),
          overdue:
            (!!r.data.due &&
              r.data.due < day &&
              paid < n(r.data.minimum) &&
              b > 0) ||
            plans.some((p) =>
              p.items.some((i) => i.due < day && i.remaining > 0),
            ),
        };
      });
    const receivables = rows
      .filter((r) => r.kind === "receivable")
      .map((r) => ({ ...r, balance: balance(r, rows, expenses) }));
    const payments = round(
      inMonth
        .filter(
          (r) =>
            r.kind === "payment" && debts.some((d) => d.id === r.data.debt_id),
        )
        .reduce((a, r) => a + n(r.data.amount), 0),
    );
    const borrowed = round(
      inMonth
        .filter(
          (r) =>
            r.kind === "disbursement" &&
            debts.some((d) => d.id === r.data.debt_id),
        )
        .reduce((a, r) => a + n(r.data.amount), 0),
    );
    const lent = round(
      inMonth
        .filter(
          (r) =>
            r.kind === "disbursement" &&
            receivables.some((d) => d.id === r.data.debt_id),
        )
        .reduce((a, r) => a + n(r.data.amount), 0),
    );
    const recovered = round(
      inMonth
        .filter(
          (r) =>
            r.kind === "payment" &&
            receivables.some((d) => d.id === r.data.debt_id),
        )
        .reduce((a, r) => a + n(r.data.amount), 0),
    );
    const interestEarned = round(
      inMonth
        .filter(
          (r) =>
            r.kind === "payment" &&
            r.data.principal != null &&
            receivables.some((d) => d.id === r.data.debt_id),
        )
        .reduce(
          (a, r) => a + Math.max(0, n(r.data.amount) - n(r.data.principal)),
          0,
        ),
    );
    const earned = round(directEarned + interestEarned);
    const pending = round(debts.reduce((a, d) => a + d.budgetPending, 0)),
      totalDebt = round(debts.reduce((a, d) => a + d.balance, 0));
    const incomeBase = settings.income == null ? earned : n(settings.income),
      cashBudget = Math.max(cashExpenses, n(settings.expenses));
    const beforeReserve = round(
        incomeBase - cashBudget - payments - pending - lent,
      ),
      deficit = Math.max(0, -beforeReserve);
    const reserve = round(
        Math.min(Math.max(0, beforeReserve), n(settings.reserve)),
      ),
      surplus = round(Math.max(0, beforeReserve - reserve));
    const active = debts.filter((d) => d.balance > 0 || d.remaining > 0);
    const missingRates = active.some((d) => d.data.tea == null),
      missingMinimums = active.some(
        (d) =>
          d.data.minimum == null &&
          !d.schedules.length &&
          d.data.monthly_base == null,
      ),
      missingDates = active.some((d) => !d.data.due);
    const strategy = settings.strategy || "avalanche";
    const ordered = [...active].sort(
      (a, b) =>
        Number(b.overdue) - Number(a.overdue) ||
        (strategy === "snowball"
          ? a.balance - b.balance
          : (b.data.tea ?? -1) - (a.data.tea ?? -1)) ||
        a.balance - b.balance,
    );
    // A missing rate prevents claiming the cheapest order. A missing installment prevents a safe surplus estimate.
    const unknownCapital = active.some((d) =>
      rows.some(
        (r) =>
          r.kind === "payment" &&
          r.data.debt_id === d.id &&
          r.data.date >= d.data.date &&
          r.data.principal == null,
      ),
    );
    const hasBudget = settings.expenses != null;
    const incompleteSchedules = debts.some(
      (d) =>
        d.schedules.length &&
        expenses.some(
          (e) =>
            e.credit_id === d.id &&
            e.date >= d.data.date &&
            !rows.some(
              (r) => r.data.schedule_only && r.data.expense_id === e.id,
            ),
        ),
    );
    const planReady =
      !incompleteSchedules &&
      !debts.some((d) => d.schedules.some((p) => p.stale || p.invalid)) &&
      !missingMinimums &&
      hasBudget &&
      incomeBase > 0 &&
      !unknownCapital &&
      (strategy === "snowball" || !missingRates);
    let extra = planReady
      ? round(
          surplus *
            (active.length
              ? Math.min(100, Math.max(0, n(settings.debtPercent ?? 80))) / 100
              : 0),
        )
      : 0;
    const allocations = [];
    let unassigned = extra;
    for (const d of ordered) {
      const payment = Math.min(
        unassigned,
        Math.max(0, d.balance - d.remaining),
      );
      if (payment > 0)
        allocations.push({
          id: d.id,
          name: d.data.name,
          extra: round(payment),
        });
      unassigned = round(unassigned - payment);
    }
    extra = round(extra - unassigned);
    const savings = planReady ? round(surplus - extra) : 0;
    const warnings = [];
    if (incompleteSchedules)
      warnings.push(
        "Completa los cronogramas de las compras de esta tarjeta para habilitar la distribución de abonos adicionales.",
      );
    if (debts.some((d) => d.schedules.some((p) => p.stale || p.invalid)))
      warnings.push(
        "Un cronograma no coincide con su compra o contiene datos inválidos. Corrígelo antes de confiar en el presupuesto.",
      );
    if (
      debts.some(
        (d) =>
          d.schedules.length &&
          rows.some(
            (r) =>
              r.kind === "payment" &&
              r.data.debt_id === d.id &&
              !r.data.schedule_id,
          ),
      )
    )
      warnings.push(
        "Hay pagos sin asignar a un cronograma: edítalos para actualizar las cuotas, sin volver a registrar el pago.",
      );
    if (
      expenses.some(
        (e) =>
          e.credit_id &&
          !rows.some((r) => r.data.schedule_only && r.data.expense_id === e.id),
      )
    )
      warnings.push(
        "Hay compras a crédito sin cronograma. El compromiso mensual puede estar incompleto; programa sus cuotas o registra el total facturado por el banco.",
      );
    if (settings.income == null && earned === 0)
      warnings.push(
        "Registra ingresos cobrados o define un ingreso mensual para el escenario.",
      );
    if (settings.expenses == null)
      warnings.push(
        "Completa tu presupuesto de gastos por efectivo/débito para no sobreestimar el excedente.",
      );
    if (deficit > 0)
      warnings.push(
        "El presupuesto no cubre todos los gastos y pagos obligatorios. Reduce gastos revisables y consulta a tus acreedores antes de incumplir; no hay excedente para invertir.",
      );
    if (missingMinimums)
      warnings.push(
        "Faltan cuotas o pagos mínimos. Completa esos importes antes de distribuir dinero adicional.",
      );
    if (missingRates && strategy === "avalanche")
      warnings.push(
        "Faltan tasas TEA: completa las tasas para ordenar por costo o elige bola de nieve para ordenar por saldo. No se asignan abonos adicionales con un orden de costo incompleto.",
      );
    if (missingDates)
      warnings.push(
        "Faltan próximos vencimientos. No se pueden revisar todos los atrasos.",
      );
    if (debts.some((d) => d.overdue))
      warnings.push(
        "Hay vencimientos pendientes: confirma el monto vencido y posibles cargos con la entidad antes de aplicar abonos adicionales.",
      );
    if (
      debts.some(
        (d) =>
          d.data.type === "card" &&
          d.data.limit > 0 &&
          d.balance > d.data.limit,
      )
    )
      warnings.push(
        "Una tarjeta supera el límite registrado; revisa saldo, cargos y línea de crédito.",
      );
    if (rows.some((r) => r.kind === "payment" && r.data.principal == null))
      warnings.push(
        "Hay pagos sin desglose de capital. El efectivo sale o entra, pero el saldo no baja hasta registrar el capital o conciliar saldo y fecha base. Si pertenecen a una deuda activa, los abonos adicionales se mantienen bloqueados.",
      );
    const totalRequired = debts.reduce((a, d) => a + d.required, 0);
    return {
      currency: selectedCurrency,
      settings,
      earned,
      purchases,
      cashExpenses,
      payments,
      borrowed,
      lent,
      recovered,
      directEarned,
      interestEarned,
      cashFlow: round(
        directEarned + borrowed + recovered - cashExpenses - payments - lent,
      ),
      debts,
      receivables,
      totalDebt,
      pending,
      incomeBase,
      cashBudget,
      reserve,
      surplus,
      deficit,
      extra,
      savings,
      allocations,
      ordered,
      warnings,
      planReady,
      missingRates,
      ratio: incomeBase > 0 ? totalRequired / incomeBase : null,
    };
  }
  function project(debt, extra) {
    if (debt.data.tea == null || debt.data.minimum == null)
      return { status: "missing" };
    const rate = Math.pow(1 + n(debt.data.tea) / 100, 1 / 12) - 1,
      payment = n(debt.data.minimum) + n(extra);
    let amount = debt.balance,
      totalInterest = 0;
    if (amount <= 0) return { status: "paid", months: 0, interest: 0 };
    if (payment <= amount * rate || payment <= 0)
      return { status: "insufficient" };
    for (let i = 1; i <= 600; i++) {
      const interest = amount * rate;
      totalInterest += interest;
      amount = Math.max(0, amount + interest - payment);
      if (amount < 0.005)
        return {
          status: "estimated",
          months: i,
          interest: round(totalInterest),
        };
    }
    return { status: "long" };
  }
  function validRecord(r) {
    const kinds = [
      "income",
      "debt",
      "receivable",
      "payment",
      "disbursement",
      "charge",
      "settings",
    ];
    if (
      !r ||
      !kinds.includes(r.kind) ||
      !r.data ||
      typeof r.data !== "object" ||
      Array.isArray(r.data) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        r.id,
      ) ||
      JSON.stringify(r.data).length > 16000
    )
      return false;
    const d = r.data,
      goodDate = (v) =>
        /^\d{4}-\d{2}-\d{2}$/.test(v || "") &&
        !Number.isNaN(Date.parse(v + "T12:00:00Z")) &&
        new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v;
    if (("currency" in d && typeof d.currency !== "string") || !["PEN", "USD"].includes(currency(d))) return false;
    if (r.kind !== "settings" && !goodDate(d.date)) return false;
    if (d.due && !goodDate(d.due)) return false;
    if (
      ["income", "debt", "receivable"].includes(r.kind) &&
      (typeof d.name !== "string" || !d.name.trim() || d.name.length > 100)
    )
      return false;
    for (const key of [
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
      "installment_amount",
    ])
      if (
        d[key] != null &&
        (!Number.isFinite(d[key]) || d[key] < 0 || d[key] > 999999999)
      )
        return false;
    if (
      ["income", "payment", "disbursement", "charge"].includes(r.kind) &&
      !(d.amount > 0)
    )
      return false;
    if (["debt", "receivable"].includes(r.kind) && d.balance == null)
      return false;
    if (d.principal != null && d.principal > d.amount) return false;
    if (d.tea != null && d.tea > 2000) return false;
    if (d.debtPercent != null && d.debtPercent > 100) return false;
    if (d.cut != null && (!Number.isInteger(d.cut) || d.cut < 1 || d.cut > 31))
      return false;
    if (
      d.targetMonths != null &&
      (!Number.isInteger(d.targetMonths) || d.targetMonths > 24)
    )
      return false;
    if (d.note != null && (typeof d.note !== "string" || d.note.length > 200))
      return false;
    if (
      ["payment", "disbursement", "charge"].includes(r.kind) &&
      !/^[0-9a-f-]{36}$/i.test(d.debt_id || "")
    )
      return false;
    const uuid = (v) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        v || "",
      );
    if (d.schedule_id != null && (r.kind !== "payment" || !uuid(d.schedule_id)))
      return false;
    if (d.schedule_only != null && d.schedule_only !== true) return false;
    if (d.schedule_only === true) {
      if (
        r.kind !== "charge" ||
        !goodDate(d.first_due) ||
        !Number.isInteger(d.installments) ||
        d.installments < 1 ||
        d.installments > 360 ||
        !Number.isInteger(d.paid_before) ||
        d.paid_before < 0 ||
        d.paid_before >= d.installments ||
        typeof d.name !== "string" ||
        !d.name.trim() ||
        d.name.length > 100 ||
        (d.expense_id != null && !uuid(d.expense_id)) ||
        (d.installment_amount == null && d.tea == null) ||
        (d.installment_amount != null && d.installment_amount <= 0)
      )
        return false;
      if (
        d.installment_amount != null &&
        round(d.installment_amount * d.installments) + 0.01 < d.amount
      )
        return false;
      try {
        const items = scheduleItems(d);
        if (items.some((i) => !Number.isFinite(i.amount) || i.amount <= 0))
          return false;
      } catch {
        return false;
      }
    }
    return true;
  }
  const api = {
    currency,
    analyze,
    balance,
    project,
    round,
    validRecord,
    dueDate,
    scheduleItems,
    schedules,
  };
  root.BAP_FINANCE_MODEL = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

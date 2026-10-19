const assert = require("node:assert/strict");
const M = require("./finance-model");
const id = (i) => `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const card = {
  id: id(1),
  kind: "debt",
  data: {
    name: "Tarjeta",
    date: "2026-10-01",
    balance: 0,
    minimum: 200,
    monthly_base: 200,
    monthly_budget: 300,
    type: "card",
    tea: 0,
  },
};
const e1 = { id: id(2), credit_id: card.id, amount: 600, date: "2026-10-02" };
const e2 = { id: id(3), credit_id: card.id, amount: 240, date: "2026-10-03" };
const plan = (i, e, count) => ({
  id: id(i),
  kind: "charge",
  data: {
    schedule_only: true,
    debt_id: card.id,
    expense_id: e.id,
    name: "Compra",
    amount: e.amount,
    date: "2026-10-03",
    first_due: "2026-10-20",
    installments: count,
    paid_before: 0,
    tea: 0,
  },
});
const p1 = plan(4, e1, 6),
  p2 = plan(5, e2, 3),
  expenses = [e1, e2];
const rows = [card, p1, p2];
assert(M.validRecord(p1));
assert.equal(
  M.balance(card, rows, expenses),
  840,
  "metadata must not double the credit purchase",
);
let a = M.analyze(rows, expenses, "2026-10", "2026-10-19");
assert.equal(a.debts[0].required, 380);
assert.equal(a.debts[0].budgetGap, 80);
assert.equal(a.pending, 380);
assert.equal(M.dueDate("2028-01-31", 1), "2028-02-29");
assert.equal(M.dueDate("2026-01-31", 2), "2026-03-31");
const payment = {
  id: id(6),
  kind: "payment",
  data: {
    debt_id: card.id,
    schedule_id: p1.id,
    date: "2026-10-19",
    amount: 40,
    principal: 40,
  },
};
a = M.analyze([...rows, payment], expenses, "2026-10", "2026-10-19");
assert.equal(a.pending, 340);
assert.equal(a.debts[0].schedules[0].items[0].status, "Parcial");
assert.equal(a.debts[0].schedules[0].paidCount, 0);
assert.equal(a.debts[0].schedules[0].pendingCount, 6);
assert.equal(a.totalDebt, 800);
payment.data.amount = 100;
payment.data.principal = 100;
a = M.analyze([...rows, payment], expenses, "2026-10", "2026-10-19");
assert.equal(a.debts[0].schedules[0].paidCount, 1);
assert.equal(a.debts[0].schedules[0].pendingCount, 5);
assert.equal(a.pending, 280);
assert.equal(a.purchases, 840);
assert.equal(a.cashFlow, -100);
// A future selected month must not be paid by later payments; overdue installments carry forward.
payment.data.date = "2026-12-01";
a = M.analyze([...rows, payment], expenses, "2026-10", "2026-12-01");
assert.equal(a.debts[0].schedules[0].required, 100);
const feb = M.scheduleItems({
  amount: 100,
  installments: 3,
  tea: 0,
  first_due: "2026-01-31",
});
assert.deepEqual(
  feb.map((i) => i.amount),
  [33.33, 33.33, 33.34],
);
assert.equal(M.round(feb.reduce((sum, i) => sum + i.principal, 0)), 100);
const interest = M.scheduleItems({
  amount: 1000,
  installments: 12,
  tea: 60,
  first_due: "2026-10-20",
});
assert(interest[0].amount > 1000 / 12);
assert.equal(M.round(interest.reduce((sum, i) => sum + i.principal, 0)), 1000);
assert(interest.every((i) => i.interest >= 0));
const bank = M.scheduleItems({
  amount: 600,
  installments: 6,
  installment_amount: 110,
  first_due: "2026-10-20",
});
assert(bank.every((i) => i.amount === 110 && i.principal === null));
const historical = structuredClone(p1);
historical.data.paid_before = 2;
historical.data.first_due = "2026-08-20";
a = M.analyze([card, historical], expenses, "2026-10", "2026-10-19");
assert.equal(a.debts[0].schedules[0].paidCount, 2);
assert.equal(a.payments, 0);
assert.equal(a.totalDebt, 840);
const stale = M.analyze(
  rows,
  [{ ...e1, amount: 650 }, e2],
  "2026-10",
  "2026-10-19",
);
assert(stale.debts[0].schedules[0].stale);
assert.equal(stale.planReady, false);
for (const changes of [
  { installments: 0 },
  { installments: 361 },
  { paid_before: 6 },
  { first_due: "2026-02-30" },
  { tea: null },
  { installment_amount: -1 },
]) {
  const bad = structuredClone(p1);
  Object.assign(bad.data, changes);
  assert.equal(M.validRecord(bad), false);
}
// Unknown historical payments never silently mark installments as paid.
const unassigned = structuredClone(payment);
delete unassigned.data.schedule_id;
unassigned.data.date = "2026-10-19";
a = M.analyze([...rows, unassigned], expenses, "2026-10", "2026-10-19");
assert.equal(a.debts[0].schedules[0].paidCount, 0);
assert(a.warnings.some((w) => w.includes("sin asignar")));
console.log(
  "Installment scenarios passed: totals, partial/full payments, history, dates, interest, stale purchases and validation.",
);

const unscheduled = M.analyze(
  [
    ...rows,
    {
      id: id(20),
      kind: "income",
      data: { name: "Ingreso", amount: 3000, date: "2026-10-01" },
    },
    { id: id(21), kind: "settings", data: { expenses: 1000 } },
  ],
  [
    ...expenses,
    { id: id(22), credit_id: card.id, date: "2026-10-05", amount: 100 },
  ],
  "2026-10",
  "2026-10-19",
);
assert.equal(unscheduled.planReady, false);
assert.equal(unscheduled.extra, 0);

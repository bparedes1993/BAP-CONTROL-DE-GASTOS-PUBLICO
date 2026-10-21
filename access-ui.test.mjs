import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import assert from "node:assert/strict";

// Tests our source against a synthetic DOM and mock Auth/API, never a real site.
const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const scripts = await Promise.all(
  [
    "xlsx.js",
    "finance-model.js",
    "sync-client.js",
    "commercial.js",
    "checkout.js",
    "app.js",
    "finance.js",
  ].map(async (name) => [
    name,
    await readFile(new URL(name, import.meta.url), "utf8"),
  ]),
);
const user = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "fixture@example.invalid",
};
const wait = async (test) => {
  for (let i = 0; i < 100; i++) {
    if (test()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("Fixture did not settle");
};
let checks = 0;
async function create(url, anonymous = false, options = {}) {
  const dom = new JSDOM(html, {
    url,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  w.TextEncoder = globalThis.TextEncoder;
  w.TextDecoder = globalThis.TextDecoder;
  Object.defineProperty(w, "crypto", { value: webcrypto });
  Object.defineProperty(w, "indexedDB", { value: new IDBFactory() });
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  let rejectFinancePayments = false;
  const financeWrites = [];
  let downloads = 0,
    remoteWrites = 0,
    rpcCount = 0;
  let checkoutMethods = options.methods ?? [
    {method:"yape",enabled:true,payee:"Titular ficticio",phone:"900000001",revision:1},
    {method:"plin",enabled:true,payee:"Titular ficticio <svg onload=alert(1)>",phone:"900000002",revision:2},
    {method:"transfer",enabled:true,payee:"Titular ficticio",bank:"Banco ficticio",account:"00000000000000",revision:3},
  ];
  const checkoutSaves = [];
  w.URL.createObjectURL = () => {
    downloads++;
    return "blob:synthetic-test";
  };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = () => {};
  w.confirm = () => true;
  w.BAP_CLOUD_CONFIG = {
    url: "https://backend.example.invalid",
    publishableKey: "public-fixture",
    accountDeletion: false,
    googleLoginEnabled: options.google !== false,
  };
  let entitlement = {
    status: "pending",
    can_write: false,
    enforcement: true,
    is_admin: false,
    admin_verified: false,
    plans: [
      { id: "monthly", name: "Plan ficticio", days: 30, price_pen: null },
    ],
    payments: [],
    server_now: new Date().toISOString(),
  };
  let currentUser = anonymous ? null : user,
    sends = 0,
    verifications = 0,
    registrations = 0,
    oauth = [],
    clientOptions;
  const cloud = {
    auth: {
      onAuthStateChange: () => {},
      getUser: async () => ({ data: { user: currentUser } }),
      getSession: async () => ({ data: { session: { user } } }),
      signOut: async () => ({}),
      signInWithOAuth: async (args) => {
        oauth.push(args);
        return options.oauthResult ? await options.oauthResult() : {};
      },
      signInWithOtp: async () => {
        sends++;
        return {};
      },
      verifyOtp: async ({ email, token, type }) => {
        verifications++;
        assert.equal(email, "fixture@example.invalid");
        assert.equal(type, "email");
        if (token !== "135790")
          return { error: { message: "invalid fixture" } };
        currentUser = user;
        return { data: { user }, error: null };
      },
    },
    rpc: async (name, args) => {
      rpcCount++;
      if (name === "bap_claim_admin_authorization")
        return { data: { claimed: false }, error: null };
      if (name === "bap_register_customer") {
        registrations++;
        return { data: null, error: null };
      }
      if (name === "bap_checkout") return {data:checkoutMethods.filter(m=>m.enabled),error:null};
      if (name === "bap_admin_checkout_methods") return {data:checkoutMethods,error:null};
      if (name === "bap_admin_save_checkout") {
        checkoutSaves.push(args);
        const updated = {method:args.p_method,...args.p_data,revision:args.p_revision+1};
        checkoutMethods = checkoutMethods.map(m=>m.method === args.p_method ? updated : m);
        return {data:updated,error:null};
      }
      if (name === "bap_request_access_with_payment") {
        entitlement = {
          ...entitlement,
          requested_plan: args.p_plan,
          requested_method: args.p_method,
          requested_reference: args.p_reference,
          requested_method_revision: args.p_revision,
          status: "pending",
          can_write: false,
        };
        return { data: entitlement, error: null };
      }
      if (name === "bap_pull_changes")
        return {
          data: {
            rows: [],
            cursor: { version: args.p_version, id: args.p_id },
            more: false,
          },
          error: null,
        };
      if (name === "bap_my_access")
        return {
          data: { ...entitlement, server_now: new Date().toISOString() },
          error: null,
        };
      throw Error("Unexpected RPC " + name);
    },
    channel: () => ({
      on() {
        return this;
      },
      subscribe() {
        return this;
      },
    }),
    removeChannel: () => {},
    from: (table) => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      order() {
        return this;
      },
      range: async () => ({ data: [], error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      upsert: async (row) => {
        if (table === "finance_entries") {
          financeWrites.push(structuredClone(row));
          if (rejectFinancePayments && row.kind === "payment") return {error:{code:"P0001",message:"El pago excede las cuotas pendientes"}};
        }
        remoteWrites++;
        return { error: null };
      },
    }),
  };
  w.supabase = {
    createClient: (url, key, opts) => {
      clientOptions = opts;
      return cloud;
    },
  };
  for (const [name, source] of scripts)
    w.eval(source + "\n//# sourceURL=" + name);
  await wait(() => w.BAP_APP?.state().configured || w.BAP_APP?.state().demo);
  if (!w.BAP_APP.state().demo && !anonymous)
    await wait(() => w.BAP_APP.state().user && w.BAP_ACCESS.snapshot());
  if (!w.BAP_APP.state().demo && !anonymous && options.methods?.length !== 0)
    await wait(() => w.document.querySelector("#requested-method").value);
  await wait(
    () =>
      !/Cargando|Abriendo|Sincronizando/.test(
        w.document.querySelector("#finance-sync").textContent,
      ),
  );
  return {
    w,
    dom,
    set: (v) => {
      entitlement = { ...entitlement, ...v };
    },
    downloadCount: () => downloads,
    writeCount: () => remoteWrites,
    financeWrites: () => financeWrites,
    rejectPayments: (value) => { rejectFinancePayments = value; },
    rpcCount: () => rpcCount,
    sends: () => sends,
    verifications: () => verifications,
    registrations: () => registrations,
    oauth: () => oauth,
    clientOptions: () => clientOptions,
    checkoutSaves: () => checkoutSaves,
  };
}
const f = await create("https://app.example.invalid/");
const w = f.w,
  $ = (s) => w.document.querySelector(s);
assert.equal(w.BAP_ACCESS.canWrite(), false);
checks++;
assert.equal(f.registrations(), 1);
checks++;
assert.equal($("#access-catalog").hidden, false);
checks++;
$("#requested-method").value = "plin";
$("#requested-method").dispatchEvent(new w.Event("change"));
$("#requested-reference").value = "TEST-REFERENCE-ONLY";
assert.match($("#checkout-instructions").textContent,/900000002/);
assert.equal($("#checkout-instructions svg"),null);
checks += 2;
$("#access-request").dispatchEvent(
  new w.Event("submit", { bubbles: true, cancelable: true }),
);
await wait(() => !$("#request-access").disabled);
assert.equal(w.BAP_ACCESS.canWrite(), false);
assert.match($("#access-request-state").textContent, /Solicitud pendiente/);
checks += 2;
assert.equal(w.BAP_ACCESS.snapshot().requested_method,"plin");
assert.equal(w.BAP_ACCESS.snapshot().requested_reference,"TEST-REFERENCE-ONLY");
checks += 2;
await w.BAP_ACCESS.refresh();
assert.equal(f.registrations(), 1);
checks++;
$("#add").click();
assert.equal($("#editor").open, false);
checks++;
$("#amount").value = "20";
$("#merchant").value = "Gasto ficticio";
$("#date").value = "2026-10-06";
$("#expense-form").dispatchEvent(
  new w.Event("submit", { bubbles: true, cancelable: true }),
);
assert.equal(w.BAP_APP.state().expenses.length, 0);
checks++;
assert.equal(f.writeCount(), 0);
checks++;
f.set({
  status: "active",
  can_write: true,
  ends_at: new Date(Date.now() + 86400000).toISOString(),
});
await w.BAP_ACCESS.refresh();
assert.equal(w.BAP_ACCESS.canWrite(), true);
checks++;
$("#add").click();
assert.equal($("#editor").open, true);
checks++;
$("#amount").value = "20";
$("#merchant").value = "Gasto ficticio";
$("#date").value = "2026-10-06";
$("#expense-form").dispatchEvent(
  new w.Event("submit", { bubbles: true, cancelable: true }),
);
await wait(() => w.BAP_APP.state().expenses.length === 1);
checks++;
w.document.querySelector('[data-fin-tab="income"]').click();
w.document.querySelector('[data-fin-add="income"]').click();
await wait(() => $("#finance-editor").open);
w.document.querySelector('[name="name"]').value = "Ingreso ficticio";
w.document.querySelector('[name="amount"]').value = "100";
w.document.querySelector('[name="date"]').value = "2026-10-06";
$("#finance-form").dispatchEvent(
  new w.Event("submit", { bubbles: true, cancelable: true }),
);
await wait(() =>
  $("#finance-incomes").textContent.includes("Ingreso ficticio"),
);
checks++;
await wait(() => !$("#finance-editor").open);
// Full installment workflow through the actual forms, with isolated IndexedDB and mocked sync.
async function submitFinance(values) {
  for (const [name, value] of Object.entries(values))
    w.document.querySelector(`#finance-form [name="${name}"]`).value =
      String(value);
  $("#finance-form").dispatchEvent(
    new w.Event("submit", { bubbles: true, cancelable: true }),
  );
  $("#finance-form").dispatchEvent(new w.Event("submit", {bubbles:true,cancelable:true}));
  await wait(() => !$("#finance-editor").open);
  await new Promise(r => setTimeout(r, 0));
}
w.document.querySelector('[data-fin-tab="debts"]').click();
w.document.querySelector('[data-fin-add="debt"]').click();
await submitFinance({
  name: "Tarjeta cuotas",
  type: "card",
  balance: 0,
  date: "2026-10-01",
  minimum: 0,
  tea: 0,
  monthly_budget: 80,
  monthly_base: 0,
});
const cardId = w.BAP_FINANCE.cards()[0].id;
$("#add").click();
$("#amount").value = "600";
$("#merchant").value = "Compra cuotas";
$("#date").value = "2026-10-06";
$("#expense-credit").value = cardId;
$("#expense-form").dispatchEvent(
  new w.Event("submit", { bubbles: true, cancelable: true }),
);
await wait(() =>
  w.BAP_APP.state().expenses.some((e) => e.credit_id === cardId),
);
await wait(() => !$("#editor").open);
w.document.querySelector('[data-fin-action="schedule"]').click();
await submitFinance({
  name: "Compra <img src=x onerror=alert(1)>",
  installments: 6,
  paid_before: 0,
  first_due: "2026-10-20",
  tea: 0,
});
assert.match($("#finance-debts").textContent, /0 pagadas \/ 6 pendientes/);
checks++;
assert.equal($("#finance-debts img"), null);
checks++;
assert.match($("#finance-debts").textContent, /20[,.]00/);
checks++; // budget shortfall
w.document.querySelector('[data-fin-action="payment"]').click();
const planId = $("#f-schedule_id").options[1].value;
await submitFinance({
  amount: 40,
  principal: 40,
  date: "2026-10-10",
  schedule_id: planId,
});
assert.match($("#finance-debts").textContent, /Parcial/);
checks++;
assert.match($("#finance-debts").textContent, /0 pagadas \/ 6 pendientes/);
checks++;
const scheduleEdit = w.document.querySelector(
  `.installment-schedule [data-fin-edit="${planId}"]`,
);
scheduleEdit.click();
$("#f-installments").value = "12";
$("#finance-form").dispatchEvent(
  new w.Event("submit", { bubbles: true, cancelable: true }),
);
assert.match($("#finance-error").textContent, /tiene pagos/);
checks++;
$("#finance-close").click();
w.confirm = () => false;
w.document
  .querySelector(`.installment-schedule [data-fin-delete="${planId}"]`)
  .click();
assert(w.document.querySelector(".installment-schedule"));
w.confirm = () => true;
checks++;
// Reload the user session and render from storage: allocations must survive.
await w.BAP_ACCESS.refresh();
w.dispatchEvent(new w.Event("bap:render"));
await wait(() => $("#finance-debts").textContent.includes("Parcial"));
checks++;
// Resolve an actionable warning by editing the same stored movement, without duplication.
assert.equal(w.document.querySelector('#finance-advice [data-fin-edit]'), null);
checks++;
w.document.querySelector('[data-fin-action="payment"]').click();
await submitFinance({amount:10,principal:10,date:"2026-10-11",schedule_id:""});
const reviewButton = w.document.querySelector('#finance-advice [data-fin-edit]');
assert(reviewButton);
const reviewedId = reviewButton.dataset.finEdit;
checks++;
reviewButton.click();
assert.equal($("#f-schedule_id").value, "");
await submitFinance({schedule_id:planId});
assert.equal(w.document.querySelector('#finance-advice [data-fin-edit]'), null);
assert(w.document.querySelector(`[data-fin-edit="${reviewedId}"]`));
checks+=2;
// Explicitly classify another balance, then reload the session to check persistence.
w.document.querySelector(`[data-fin-edit="${reviewedId}"]`).click();
await submitFinance({schedule_id:"__other__"});
await w.BAP_ACCESS.refresh();
w.dispatchEvent(new w.Event("bap:render"));
assert.equal(w.document.querySelector('#finance-advice [data-fin-edit]'), null);
w.document.querySelector(`[data-fin-edit="${reviewedId}"]`).click();
assert.equal($("#f-schedule_id").value, "__other__");
$("#finance-close").click();
checks+=2;
// A separate USD ledger, including payments, schedules and its own budget.
w.document.querySelector('[data-fin-add="debt"]').click();
await submitFinance({name:"Préstamo USD",type:"loan",currency:"USD",balance:600,date:"2026-10-01",tea:0,minimum:0});
await wait(()=>$("#finance-debts").textContent.includes("Préstamo USD"));
assert.equal($("#currency-view").value,"USD");
assert(!$("#finance-debts").textContent.includes("Tarjeta cuotas"));
assert.equal($("#total").textContent.includes("600"),false);
checks+=3;
w.document.querySelector('[data-fin-action="schedule"]').click();
await submitFinance({name:"Cronograma USD",installments:6,paid_before:0,first_due:"2026-10-20",tea:0});
w.document.querySelector('[data-fin-action="payment"]').click();
$("#f-currency").value="PEN";
$("#f-amount").value="40";
$("#f-principal").value="40";
$("#finance-form").dispatchEvent(new w.Event("submit",{bubbles:true,cancelable:true}));
assert.match($("#finance-error").textContent,/USD/);
assert.equal($("#finance-editor").open,true);
checks+=2;
await new Promise(r => setTimeout(r, 0));
await submitFinance({currency:"USD",amount:40,principal:40,date:"2026-10-10",schedule_id:$("#f-schedule_id").options[1].value});
assert.match($("#finance-debts").textContent,/560/);
assert.match($("#finance-debts").textContent,/Parcial/);
assert.match($("#finance-debts").textContent,/USD/);
checks+=3;
$("#finance-settings").click();
await submitFinance({income:200,expenses:20,reserve:10});
$("#currency-view").value="PEN";$("#currency-view").dispatchEvent(new w.Event("change"));
await wait(()=>$("#finance-debts").textContent.includes("Tarjeta cuotas"));
assert(!$("#finance-debts").textContent.includes("Préstamo USD"));
$("#finance-settings").click();
await submitFinance({income:1000,expenses:50,reserve:0});
$("#currency-view").value="USD";$("#currency-view").dispatchEvent(new w.Event("change"));
await wait(()=>$("#finance-debts").textContent.includes("Préstamo USD"));
$("#finance-settings").click();
assert.equal($("#f-expenses").value,"20");
$("#finance-close").click();
checks+=2;
// Removing a schedule preserves each payment and capital, unlinking it atomically.
assert.equal(w.document.querySelectorAll('#finance-debt-events .finance-event').length,1);
checks++;
const usdDelete = w.document.querySelector('.installment-schedule [data-fin-delete]');
const usdPlanId = usdDelete.dataset.finDelete;
usdDelete.click();
await wait(() => !w.document.querySelector(`.installment-schedule [data-fin-delete="${usdPlanId}"]`));
assert.equal(w.document.querySelectorAll('#finance-debt-events .finance-event').length,1);
assert.match($("#finance-debts").textContent,/560/);
assert(!$("#finance-debt-events").textContent.includes('Cronograma:'));
checks+=3;
await w.BAP_ACCESS.refresh();w.dispatchEvent(new w.Event('bap:render'));
await wait(() => !w.document.querySelector('.installment-schedule'));
assert.equal(w.document.querySelectorAll('#finance-debt-events .finance-event').length,1);
checks++;
await wait(() => f.financeWrites().some(r => r.id === usdPlanId && r.deleted));
const deletionWrite = f.financeWrites().findIndex(r => r.id === usdPlanId && r.deleted);
const unlinkWrite = f.financeWrites().findIndex(r => r.kind === 'payment' && r.data.currency === 'USD' && !r.data.schedule_id);
assert(unlinkWrite >= 0 && unlinkWrite < deletionWrite);
checks++;
// One rejected payment must not block other valid records or the download pass.
f.rejectPayments(true);
w.document.querySelector('[data-fin-action="payment"]').click();
await submitFinance({amount:10,principal:10,date:"2026-10-12",schedule_id:""});
await wait(() => $("#finance-sync").textContent.includes('P0001'));
assert.match($("#finance-sync").textContent,/supera las cuotas/);
checks++;
w.document.querySelector('[data-fin-add="income"]').click();
await submitFinance({name:"Ingreso de prueba de cola",amount:50,date:"2026-10-12"});
w.dispatchEvent(new w.Event('online'));
await wait(() => f.financeWrites().some(r => r.data.name === 'Ingreso de prueba de cola'));
checks++;
await wait(() => $("#finance-sync").textContent.includes('Reintentar'));
f.rejectPayments(false);
$("#finance-sync").querySelector('button').click();
await wait(() => $("#finance-sync").textContent === 'Finanzas sincronizadas');
checks++;
// Same-day identical payments are flagged for review, never silently removed.
w.document.querySelector('[data-fin-action="payment"]').click();
await submitFinance({amount:10,principal:10,date:"2026-10-12",schedule_id:""});
assert.match($("#finance-advice").textContent,/Posibles pagos duplicados: 2 registros/);
assert.equal(w.document.querySelectorAll('#finance-debt-events .finance-event').length,3);
checks+=2;
$("#finance-advice").querySelector('[data-fin-delete]').click();
await wait(() => !$("#finance-advice").textContent.includes('Posibles pagos duplicados'));
assert.equal(w.document.querySelectorAll('#finance-debt-events .finance-event').length,2);
checks++;
// Card purchases consume the credit line and schedule automatically at cutoff boundaries.
$("#currency-view").value="PEN";$("#currency-view").dispatchEvent(new w.Event('change'));
w.document.querySelector('[data-fin-add="debt"]').click();
await submitFinance({name:"Ciclo automático",type:"card",currency:"PEN",balance:0,date:"2026-10-01",minimum:0,tea:0,limit:1000,cut:5,payment_day:20});
const autoCard=w.BAP_FINANCE.cards().find(r=>r.data.name==='Ciclo automático');
assert.equal(autoCard.data.payment_day,20);checks++;
async function purchase(name,date,amount) {
 $("#add").click();$("#merchant").value=name;$("#amount").value=String(amount);$("#date").value=date;
 $("#expense-credit").value=autoCard.id;$("#expense-credit").dispatchEvent(new w.Event('change'));
 assert.equal($("#payment").value,'Tarjeta de crédito');checks++;
 $("#expense-form").dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 $("#expense-form").dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await wait(()=>!$("#editor").open);
 return w.BAP_APP.state().expenses.find(e=>e.merchant===name);
}
const cutoffExpense=await purchase('En el corte','2026-10-05',100);
const afterCutoffExpense=await purchase('Después del corte','2026-10-06',100);
const cardView=()=>[...w.document.querySelectorAll('.debt-card')].find(el=>el.querySelector('h3')?.textContent==='Ciclo automático');
assert.match(cardView().textContent,/2026-10-20/);assert.match(cardView().textContent,/2026-11-20/);
assert.match(cardView().textContent,/800[.,]00/);assert.equal(cardView().querySelectorAll('.installment-schedule').length,2);checks+=4;
await w.BAP_FINANCE.syncExpense(cutoffExpense);await w.BAP_ACCESS.refresh();w.dispatchEvent(new w.Event('bap:render'));
assert.equal(cardView().querySelectorAll('.installment-schedule').length,2);checks++;
w.document.querySelector(`#transactions .edit[data-id="${afterCutoffExpense.id}"]`).click();
$("#amount").value='150';$("#expense-form").dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
await wait(()=>!$("#editor").open);
assert.equal(cardView().querySelectorAll('.installment-schedule').length,2);assert.match(cardView().textContent,/750[.,]00/);checks+=2;
cardView().querySelector('[data-fin-action="payment"]').click();
await submitFinance({amount:100,principal:100,date:'2026-10-20',schedule_id:cutoffExpense.id});
assert.match(cardView().textContent,/850[.,]00/);assert.match(cardView().textContent,/1 pagadas \/ 0 pendientes/);
assert.match(w.BAP_FINANCE.validateExpenseChange(cutoffExpense,{...cutoffExpense,amount:999}),/pagos/);checks+=3;
w.document.querySelector(`#transactions .delete[data-id="${afterCutoffExpense.id}"]`).click();
await wait(()=>cardView().querySelectorAll('.installment-schedule').length===1);
assert.match(cardView().textContent,/1[,.]000[.,]00/);checks++;
// A schedule deleted by the user must not be recreated during reconciliation.
cardView().querySelector('.installment-schedule [data-fin-delete]').click();
await wait(()=>cardView().querySelectorAll('.installment-schedule').length===0);
await w.BAP_FINANCE.syncExpense(cutoffExpense);
assert.equal(cardView().querySelectorAll('.installment-schedule').length,0);checks++;
// Updating collection settings uses the current revision and doesn't approve a plan.
f.set({is_admin:true,admin_verified:true});await w.BAP_ACCESS.refresh();
$("#payment-methods-load").click();
await wait(()=>$("#payment-methods-admin [data-method=yape]"));
const yapeForm=$("#payment-methods-admin [data-method=yape]");
yapeForm.querySelector('[name=phone]').value="900000003";
yapeForm.dispatchEvent(new w.Event("submit",{bubbles:true,cancelable:true}));
await wait(()=>f.checkoutSaves().length===1 && $("#payment-methods-state").textContent.includes("guardado"));
assert.equal(f.checkoutSaves()[0].p_data.phone,"900000003");
assert.equal(f.checkoutSaves()[0].p_revision,1);
checks+=2;
f.set({is_admin:false,admin_verified:false});
f.set({
  status: "expired",
  can_write: false,
  ends_at: new Date(Date.now() - 86400000).toISOString(),
});
await w.BAP_ACCESS.refresh();
assert.equal(w.BAP_ACCESS.canWrite(), false);
checks++;
const recordsBefore = w.BAP_APP.state().expenses.length;
$("#amount").value = "999";
$("#expense-form").dispatchEvent(
  new w.Event("submit", { bubbles: true, cancelable: true }),
);
assert.equal(w.BAP_APP.state().expenses.length, recordsBefore);
checks++;
const countBefore = f.downloadCount();
$("#finance-excel").click();
$("#backup").click();
assert.equal(f.downloadCount(), countBefore + 2);
checks++;
const fakeWriteBefore = f.writeCount();
w.document.querySelector('[data-fin-add="income"]').click();
assert.equal($("#finance-editor").open, false);
checks++;
assert.equal(f.writeCount(), fakeWriteBefore);
checks++;
await wait(() => !$("#finance-sync").textContent.includes("Sincronizando"));
f.dom.window.close();
const noMethods=await create("https://app.example.invalid/",false,{methods:[]});
await wait(()=>noMethods.w.document.querySelector("#checkout-instructions").textContent.includes("todavía"));
assert.equal(noMethods.w.document.querySelector("#request-access").disabled,true);
const beforeRpc=noMethods.rpcCount();
noMethods.w.document.querySelector("#access-request").dispatchEvent(new noMethods.w.Event("submit",{bubbles:true,cancelable:true}));
assert.equal(noMethods.rpcCount(),beforeRpc);
checks+=2;
await wait(()=>!noMethods.w.document.querySelector("#finance-sync").textContent.includes("Sincronizando"));
noMethods.dom.window.close();
const d = await create("https://app.example.invalid/?demo=1#mi-acceso");
await wait(() => d.w.BAP_ACCESS.snapshot());
assert.equal(d.w.BAP_ACCESS.snapshot().is_admin, true);
checks++;
d.w.document.querySelector("#admin-load").click();
await wait(() => d.w.document.querySelector("[data-manage]"));
d.w.document.querySelector("[data-manage]").click();
assert.equal(d.w.document.querySelector("#decision-dialog").open, true);
checks++;
d.w.document
  .querySelector("#decision-form")
  .dispatchEvent(new d.w.Event("submit", { bubbles: true, cancelable: true }));
assert.equal(d.rpcCount(), 0);
checks++;
assert.equal(d.writeCount(), 0);
checks++;
await wait(() =>
  d.w.document
    .querySelector("#finance-incomes")
    .textContent.includes("Sueldo de ejemplo"),
);
d.dom.window.close();
const login = await create("https://app.example.invalid/", true),
  lw = login.w,
  lq = (s) => lw.document.querySelector(s);
lq("#account").click();
lq("#auth-email").value = "fixture@example.invalid";
lq("#send-link").click();
await wait(() => !lq("#otp-form").hidden);
assert.equal(login.sends(), 1);
checks++;
assert.equal(lq("#send-link").disabled, true);
checks++;
lq("#send-link").click();
assert.equal(login.sends(), 1);
checks++;
lq("#auth-code").value = "12";
lq("#otp-form").dispatchEvent(
  new lw.Event("submit", { bubbles: true, cancelable: true }),
);
assert.equal(login.verifications(), 0);
checks++;
lq("#auth-code").value = "000000";
lq("#otp-form").dispatchEvent(
  new lw.Event("submit", { bubbles: true, cancelable: true }),
);
await wait(() => lq("#otp-state").textContent.includes("inválido"));
assert.equal(lw.BAP_APP.state().user, null);
checks++;
assert.equal(lq("#auth-code").value, "");
checks++;
lq("#auth-code").value = "135790";
lq("#otp-form").dispatchEvent(
  new lw.Event("submit", { bubbles: true, cancelable: true }),
);
await wait(() => lw.BAP_APP.state().user && !lq("#account-dialog").open);
assert.equal(lq("#auth-code").value, "");
checks++;
assert.equal(lq("#otp-form").hidden, true);
checks++;
assert.equal(
  Array.from({ length: lw.localStorage.length }, (_, i) =>
    lw.localStorage.getItem(lw.localStorage.key(i)),
  ).some((v) => v.includes("135790")),
  false,
);
checks++;
await wait(() => !lq("#finance-sync").textContent.includes("Sincronizando"));
login.dom.window.close();
const google = await create(
  "https://app.example.invalid/?next=https://untrusted.example.invalid",
  true,
);
google.w.document.querySelector("#account").click();
google.w.document.querySelector("#sign-in-google").click();
await wait(() => google.oauth().length === 1);
await wait(() => !google.w.document.querySelector("#sign-in-google").disabled);
assert.equal(google.clientOptions().auth.flowType, "pkce");
assert.equal(google.clientOptions().auth.detectSessionInUrl, true);
assert.equal(google.oauth()[0].provider, "google");
assert.equal(
  google.oauth()[0].options.redirectTo,
  "https://app.example.invalid/",
);
assert.equal(google.oauth()[0].options.scopes, "openid email profile");
assert.equal(google.w.BAP_APP.state().user, null);
assert.equal(google.writeCount(), 0);
checks += 7;
google.dom.window.close();
const staged = await create("https://app.example.invalid/", true, {
  google: false,
});
assert.equal(staged.w.document.querySelector("#sign-in-google").disabled, true);
staged.w.document.querySelector("#sign-in-google").click();
assert.equal(staged.oauth().length, 0);
checks += 2;
staged.dom.window.close();
let finishOAuth;
const failed = await create("https://app.example.invalid/", true, {
  oauthResult: () =>
    new Promise((r) => {
      finishOAuth = r;
    }),
});
const gb = failed.w.document.querySelector("#sign-in-google");
gb.click();
gb.click();
assert.equal(failed.oauth().length, 1);
assert.equal(gb.disabled, true);
finishOAuth({ error: { message: "PRIVATE-FIXTURE-PROVIDER-ERROR" } });
await wait(() => !gb.disabled);
assert.match(
  failed.w.document.querySelector("#google-state").textContent,
  /No se pudo iniciar/,
);
assert.equal(
  failed.w.document.body.textContent.includes("PRIVATE-FIXTURE"),
  false,
);
checks += 4;
failed.dom.window.close();
const callback = await create(
  "https://app.example.invalid/?code=SYNTHETIC-OAUTH-CODE&error_description=PRIVATE-FIXTURE#access_token=FAKE-FIXTURE",
);
assert.equal(callback.w.location.search, "");
assert.equal(callback.w.location.hash, "#mi-acceso");
assert.equal(callback.w.BAP_ACCESS.canWrite(), false);
assert.equal(callback.registrations(), 1);
checks += 4;
callback.dom.window.close();
console.log(
  `Client integration: ${checks} checks passed (synthetic DOM and mock API).`,
);



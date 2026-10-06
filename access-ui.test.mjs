import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import assert from "node:assert/strict";

// Tests our source against a synthetic DOM and mock Auth/API, never a real site.
const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const scripts = await Promise.all(
  ["xlsx.js", "finance-model.js", "commercial.js", "app.js", "finance.js"].map(
    async (name) => [
      name,
      await readFile(new URL(name, import.meta.url), "utf8"),
    ],
  ),
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
async function create(url) {
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
  let downloads = 0,
    remoteWrites = 0,
    rpcCount = 0;
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
  const cloud = {
    auth: {
      onAuthStateChange: () => {},
      getUser: async () => ({ data: { user } }),
      getSession: async () => ({ data: { session: { user } } }),
      signOut: async () => ({}),
      signInWithOtp: async () => ({}),
    },
    rpc: async (name) => {
      rpcCount++;
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
    from: () => ({
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
      upsert: async () => {
        remoteWrites++;
        return { error: null };
      },
    }),
  };
  w.supabase = { createClient: () => cloud };
  for (const [name, source] of scripts)
    w.eval(source + "\n//# sourceURL=" + name);
  await wait(() => w.BAP_APP?.state().configured || w.BAP_APP?.state().demo);
  if (!w.BAP_APP.state().demo)
    await wait(() => w.BAP_APP.state().user && w.BAP_ACCESS.snapshot());
  return {
    w,
    dom,
    set: (v) => {
      entitlement = { ...entitlement, ...v };
    },
    downloadCount: () => downloads,
    writeCount: () => remoteWrites,
    rpcCount: () => rpcCount,
  };
}
const f = await create("https://app.example.invalid/");
const w = f.w,
  $ = (s) => w.document.querySelector(s);
assert.equal(w.BAP_ACCESS.canWrite(), false);
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
console.log(
  `Client integration: ${checks} checks passed (synthetic DOM and mock API).`,
);

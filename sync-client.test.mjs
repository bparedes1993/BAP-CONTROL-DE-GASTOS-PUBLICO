import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const dom = new JSDOM("<!doctype html>", { runScripts: "outside-only" });
dom.window.eval(
  await readFile(new URL("sync-client.js", import.meta.url), "utf8"),
);
const S = dom.window.BAP_SYNC,
  A = "10000000-0000-4000-8000-000000000001",
  B = "10000000-0000-4000-8000-000000000002";
const R1 = "40000000-0000-4000-8000-000000000001",
  R2 = "40000000-0000-4000-8000-000000000002";
const req = new IDBFactory().open("sync-fixture", 1);
req.onupgradeneeded = () =>
  req.result.createObjectStore("expenses", { keyPath: "id" });
const db = await new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const all = () =>
  new Promise((resolve) => {
    const q = db.transaction("expenses").objectStore("expenses").getAll();
    q.onsuccess = () => resolve(q.result);
  });
let checks = 0,
  page = 0,
  fail = true;
const cloud = {
  rpc: async (name, args) => {
    assert.equal(name, "bap_pull_changes");
    assert.equal(args.p_limit, 5);
    page++;
    if (args.p_version === "-1")
      return {
        data: {
          rows: [{ id: R1, user_id: A, amount: 10 }],
          cursor: { version: "0", id: R1 },
          more: true,
        },
      };
    if (fail) return { error: Error("Simulated network failure") };
    return {
      data: {
        rows: [{ id: R2, user_id: A, amount: 20 }],
        cursor: { version: "1", id: R2 },
        more: false,
      },
    };
  },
};
const pull = () =>
  S.pull({
    db,
    store: "expenses",
    userId: A,
    cloud,
    kind: "expenses",
    active: () => true,
    merge: (r) => r,
  });
await assert.rejects(pull());
checks++;
assert.equal((await all()).filter((r) => !S.isMeta(r)).length, 1);
checks++;
assert.equal((await S.cursor(db, "expenses", A)).id, R1);
checks++;
fail = false;
await pull();
assert.equal((await all()).filter((r) => !S.isMeta(r)).length, 2);
checks++;
assert.equal((await S.cursor(db, "expenses", B)).version, "-1");
checks++;
const before = await S.cursor(db, "expenses", A);
await assert.rejects(
  S.commit(db, "expenses", A, [{ id: R1, amount: 999 }, { broken: true }], {
    version: "999",
    id: R2,
  }),
);
checks++;
assert.equal((await all()).find((r) => r.id === R1).amount, 10);
checks++;
assert.deepEqual(await S.cursor(db, "expenses", A), before);
checks++;
await assert.rejects(
  S.pull({
    db,
    store: "expenses",
    userId: A,
    kind: "expenses",
    active: () => true,
    merge: (r) => r,
    cloud: {
      rpc: async () => ({
        data: {
          rows: [{ id: R2, user_id: B }],
          cursor: { version: "2", id: R2 },
          more: false,
        },
      }),
    },
  }),
);
checks++;
assert.deepEqual(await S.cursor(db, "expenses", A), before);
checks++;
let active = true;
await S.pull({
  db,
  store: "expenses",
  userId: A,
  kind: "expenses",
  active: () => active,
  merge: (r) => r,
  cloud: {
    rpc: async () => {
      active = false;
      return {
        data: {
          rows: [{ id: R1, user_id: A, amount: 888 }],
          cursor: { version: "2", id: R1 },
          more: false,
        },
      };
    },
  },
});
assert.equal((await all()).find((r) => r.id === R1).amount, 10);
checks++;
assert.deepEqual(await S.cursor(db, "expenses", A), before);
checks++;
await S.clearCursor(db, "expenses", A);
assert.equal((await S.cursor(db, "expenses", A)).version, "-1");
checks++;
assert.equal((await all()).filter(S.isMeta).length, 0);
checks++;
db.close();
dom.window.close();
console.log(
  `Cursor persistence and retries: ${checks} checks passed (synthetic DOM/IndexedDB).`,
);

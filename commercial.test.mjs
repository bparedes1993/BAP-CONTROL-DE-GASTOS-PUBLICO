import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const db = new PGlite();
const A = "10000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";
const ADMIN = "10000000-0000-4000-8000-000000000003";
const CARD = "20000000-0000-4000-8000-000000000001";
const OP = "30000000-0000-4000-8000-000000000001";
let checks = 0;
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const scalar = async (sql, params = []) =>
  Object.values((await query(sql, params))[0])[0];
async function actor(id, aal = "aal1") {
  await db.exec("reset role");
  await query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, aal, user_metadata: { role: "admin" } }),
  ]);
  await db.exec(`set role ${id ? "authenticated" : "anon"}`);
}
async function denied(sql, params = []) {
  await assert.rejects(db.query(sql, params));
  checks++;
}
await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
 grant usage on schema public,auth to anon,authenticated;
 grant execute on function auth.jwt(),auth.uid() to anon,authenticated;
 create publication supabase_realtime;`);
await db.exec(
  await readFile(new URL("./supabase.sql", import.meta.url), "utf8"),
);
await db.exec(
  await readFile(new URL("./finance.sql", import.meta.url), "utf8"),
);
await db.exec(
  await readFile(new URL("./commercial.sql", import.meta.url), "utf8"),
);
await db.exec(
  await readFile(new URL("./commercial.sql", import.meta.url), "utf8"),
); // repeatable migration
await query(
  "insert into auth.users values($1,$2,now()),($3,$4,now()),($5,$6,now())",
  [
    A,
    "alpha@example.invalid",
    B,
    "beta@example.invalid",
    ADMIN,
    "owner@example.invalid",
  ],
);
await query("insert into public.bap_admins(user_id) values($1)", [ADMIN]);
await actor(null);
await denied("select public.bap_my_access()");
await denied("select * from public.expenses");
await denied("select public.bap_admin_list()");
await actor(A);
await denied("select public.bap_admin_list()"); // metadata is not a role
await denied("insert into public.bap_admins(user_id) values($1)", [A]);
await denied(
  "insert into public.bap_access(user_id,status) values($1,'active')",
  [A],
);
await scalar("select public.bap_request_access('monthly')");
await denied("select public.bap_request_access('annual')"); // per-user cooldown
await denied("update public.bap_access set status='active' where user_id=$1", [
  A,
]);
await actor(ADMIN);
await denied("select public.bap_admin_list()"); // admin must use MFA
await denied("select public.bap_admin_enforcement(true)");
await actor(ADMIN, "aal2");
await scalar("select public.bap_admin_enforcement(true)");
await actor(A);
assert.equal(await scalar("select public.bap_can_write()"), false);
checks++;
const expenseSQL =
  "insert into public.expenses(id,user_id,date,amount,merchant,category,payment) values($1,$2,'2026-10-06',20,'Comercio ficticio','Hogar','Efectivo')";
await denied(expenseSQL, ["40000000-0000-4000-8000-000000000001", A]);
await denied("select public.bap_admin_decide($1,$2,$3,$4,$5)", [
  OP,
  A,
  "active",
  "annual",
  365,
]);
await actor(ADMIN, "aal2");
await scalar("select public.bap_admin_decide($1,$2,$3,$4,$5,$6,$7,$8)", [
  OP,
  A,
  "active",
  "monthly",
  30,
  19,
  "transfer",
  "TEST-ONLY-001",
]);
const end1 = await scalar(
  "select ends_at::text from public.bap_access where user_id=$1",
  [A],
).catch(() => null);
// Table access is deliberately denied even to the app administrator.
assert.equal(end1, null);
checks++;
await scalar("select public.bap_admin_decide($1,$2,$3,$4,$5,$6,$7,$8)", [
  OP,
  A,
  "active",
  "monthly",
  30,
  19,
  "transfer",
  "TEST-ONLY-001",
]);
await db.exec("reset role");
assert.equal(await scalar("select count(*)::int from public.bap_payments"), 1);
checks++;
const ends = await scalar(
  "select ends_at::text from public.bap_access where user_id=$1",
  [A],
);
await actor(ADMIN, "aal2");
await denied("select public.bap_admin_decide($1,$2,$3,$4,$5,$6,$7,$8)", [
  "30000000-0000-4000-8000-000000000002",
  A,
  "active",
  "monthly",
  30,
  19,
  "transfer",
  "TEST-ONLY-001",
]);
await db.exec("reset role");
assert.equal(
  await scalar("select ends_at::text from public.bap_access where user_id=$1", [
    A,
  ]),
  ends,
);
checks++;
await actor(A);
assert.equal(await scalar("select public.bap_can_write()"), true);
checks++;
await query(expenseSQL, ["40000000-0000-4000-8000-000000000001", A]);
await denied(expenseSQL, ["40000000-0000-4000-8000-000000000002", B]); // cross-user insert
await query(
  "insert into public.finance_entries(id,user_id,kind,data) values($1,$2,$3,$4)",
  [
    CARD,
    A,
    "debt",
    JSON.stringify({
      name: "Tarjeta ficticia",
      type: "card",
      balance: 100,
      date: "2026-10-01",
      tea: 45,
      minimum: 10,
    }),
  ],
);
await denied(
  "insert into public.finance_entries(id,user_id,kind,data) values($1,$2,$3,$4)",
  [
    "20000000-0000-4000-8000-000000000003",
    A,
    "income",
    JSON.stringify({ name: "Inválido", amount: "500", date: "2026-10-01" }),
  ],
);
await denied(
  "insert into public.finance_entries(id,user_id,kind,data) values($1,$2,$3,$4)",
  [
    "20000000-0000-4000-8000-000000000003",
    A,
    "income",
    JSON.stringify({ name: "Inválido", amount: 500, date: "2026-02-30" }),
  ],
);
await denied("update public.expenses set photo=$1 where user_id=$2", [
  "data:text/html,<script>alert(1)</script>",
  A,
]);
await actor(B);
assert.equal(await scalar("select count(*)::int from public.expenses"), 0);
checks++;
assert.equal(
  await scalar("select count(*)::int from public.finance_entries"),
  0,
);
checks++;
await denied("select * from public.bap_payments");
await actor(ADMIN, "aal2");
assert.equal(await scalar("select count(*)::int from public.expenses"), 0);
checks++; // admin cannot inspect personal finances
await scalar("select public.bap_request_access($1)", ["monthly"]);
await scalar("select public.bap_admin_decide($1,$2,$3,$4,$5)", [
  "30000000-0000-4000-8000-000000000004",
  ADMIN,
  "active",
  "monthly",
  30,
]);
await actor(B);
await scalar("select public.bap_request_access($1)", ["monthly"]);
await actor(ADMIN, "aal2");
await scalar("select public.bap_admin_decide($1,$2,$3,$4,$5)", [
  "30000000-0000-4000-8000-000000000005",
  B,
  "active",
  "monthly",
  30,
]);
await actor(B);
await denied(
  "insert into public.finance_entries(id,user_id,kind,data) values($1,$2,$3,$4)",
  [
    "20000000-0000-4000-8000-000000000003",
    B,
    "payment",
    JSON.stringify({
      debt_id: CARD,
      amount: 20,
      principal: 20,
      date: "2026-10-01",
    }),
  ],
);
await denied(
  "insert into public.expenses(id,user_id,date,amount,merchant,category,payment,credit_id) values($1,$2,current_date,20,$3,$4,$5,$6)",
  [
    "40000000-0000-4000-8000-000000000006",
    B,
    "Compra",
    "Hogar",
    "Tarjeta",
    CARD,
  ],
);
await db.exec("reset role");
await query(
  "update public.bap_access set starts_at=now()-interval '40 days',ends_at=now()-interval '1 day' where user_id=$1",
  [A],
);
await actor(A);
assert.equal(await scalar("select public.bap_can_write()"), false);
checks++;
assert.equal(await scalar("select count(*)::int from public.expenses"), 1);
checks++; // expired customer can export own data
assert.equal(
  (
    await query(
      "update public.expenses set amount=30 where user_id=$1 returning id",
      [A],
    )
  ).length,
  0,
);
checks++;
assert.equal(
  await scalar("select amount::numeric from public.expenses where user_id=$1", [
    A,
  ]),
  "20.00",
);
checks++;
await actor(ADMIN, "aal2");
await scalar("select public.bap_admin_decide($1,$2,$3,$4,$5)", [
  "30000000-0000-4000-8000-000000000007",
  A,
  "active",
  "monthly",
  30,
]);
await db.exec("reset role");
await query("update public.bap_plans set max_expenses=2 where id=$1", [
  "monthly",
]);
await actor(A);
await query(expenseSQL, ["40000000-0000-4000-8000-000000000007", A]);
await denied(expenseSQL, ["40000000-0000-4000-8000-000000000008", A]); // server-side quota
await actor(ADMIN, "aal2");
await scalar("select public.bap_admin_decide($1,$2,$3,$4,$5)", [
  "30000000-0000-4000-8000-000000000008",
  A,
  "suspended",
  "monthly",
  30,
]);
await actor(A);
assert.equal(await scalar("select public.bap_can_write()"), false);
checks++;
await denied(expenseSQL, ["40000000-0000-4000-8000-000000000009", A]);
await denied("select public.bap_request_access('monthly')");
await db.close();
console.log(
  `Commercial access and security: ${checks} checks passed (isolated PostgreSQL/PGlite; no production data).`,
);

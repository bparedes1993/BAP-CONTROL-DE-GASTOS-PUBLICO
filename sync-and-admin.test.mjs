process.on("uncaughtException", (e) => {
  console.error(
    "Test failed:",
    e.message,
    "code:",
    e.code,
    "position:",
    e.position,
  );
  process.exit(1);
});
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
const A = "10000000-0000-4000-8000-000000000001",
  B = "10000000-0000-4000-8000-000000000002",
  C = "10000000-0000-4000-8000-000000000003",
  D = "10000000-0000-4000-8000-000000000004";
let checks = 0;
const rows = async (s, p = []) => (await db.query(s, p)).rows;
const value = async (s, p = []) => Object.values((await rows(s, p))[0])[0];
const check = (a, b) => {
  assert.deepEqual(a, b);
  checks++;
};
const denied = async (s, p = []) => {
  await assert.rejects(db.query(s, p));
  checks++;
};
async function actor(id, aal = "aal1") {
  await db.exec("reset role");
  await value("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, aal, user_metadata: { role: "admin" } }),
  ]);
  await db.exec("set role " + (id ? "authenticated" : "anon"));
}
await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
grant usage on schema public,auth to anon,authenticated;grant execute on function auth.jwt(),auth.uid() to anon,authenticated;create publication supabase_realtime;`);
for (const name of ["supabase.sql", "finance.sql", "commercial.sql"])
  await db.exec(await readFile(new URL(name, import.meta.url), "utf8"));
await rows(
  "insert into auth.users values($1,$2,now()),($3,$4,now()),($5,$6,null)",
  [
    A,
    "alpha@example.invalid",
    B,
    "beta@example.invalid",
    C,
    "reserved@example.invalid",
  ],
);
for (let i = 0; i < 7; i++)
  await rows(
    "insert into public.expenses(id,user_id,date,amount,merchant,category,payment) values($1,$2,'2026-10-07',10,'Legacy fixture','Hogar','Efectivo')",
    ["40000000-0000-4000-8000-" + String(i).padStart(12, "0"), A],
  );
await rows(
  "insert into public.expenses(id,user_id,date,amount,merchant,category,payment) values('50000000-0000-4000-8000-000000000001',$1,'2026-10-07',10,'Other owner','Hogar','Efectivo')",
  [B],
);
for (const name of [
  "admin-authorizations.sql",
  "incremental-sync.sql",
  "admin-authorizations.sql",
  "incremental-sync.sql",
])
  await db.exec(await readFile(new URL(name, import.meta.url), "utf8"));
await actor(null);
await denied("select public.bap_pull_changes($1)", ["expenses"]);
await denied("select public.bap_claim_admin_authorization()");
await actor(A);
await denied("select * from bap_private.admin_authorizations");
await denied("select public.bap_pull_changes('expenses',-1,null,2)");
await denied(
  "select public.bap_pull_changes('expenses',-1,'00000000-0000-0000-0000-000000000000',6)",
);
await denied("select public.bap_pull_changes('auth.users')");
let cursor = { version: "-1", id: "00000000-0000-0000-0000-000000000000" },
  downloaded = [];
while (true) {
  const page = await value("select public.bap_pull_changes($1,$2,$3,$4)", [
    "expenses",
    cursor.version,
    cursor.id,
    2,
  ]);
  downloaded.push(...page.rows);
  cursor = page.cursor;
  if (!page.more) break;
}
check(downloaded.length, 7);
check(new Set(downloaded.map((x) => x.id)).size, 7);
check(
  downloaded.every((x) => x.user_id === A),
  true,
);
check(
  (
    await value("select public.bap_pull_changes($1,$2,$3)", [
      "expenses",
      cursor.version,
      cursor.id,
    ])
  ).rows,
  [],
);
await rows(
  "update public.expenses set merchant='Changed fixture',updated_at='2000-01-01',sync_version=999 where id=$1",
  [downloaded[0].id],
);
const change = await value("select public.bap_pull_changes($1,$2,$3)", [
  "expenses",
  cursor.version,
  cursor.id,
]);
check(change.rows.length, 1);
check(change.rows[0].sync_version, 1);
cursor = change.cursor;
await rows("update public.expenses set deleted=true where id=$1", [
  downloaded[0].id,
]);
const deletion = await value("select public.bap_pull_changes($1,$2,$3)", [
  "expenses",
  cursor.version,
  cursor.id,
]);
check(deletion.rows[0].deleted, true);
check(deletion.rows[0].sync_version, 2);
await db.exec("reset role");
await db.exec(
  (
    await readFile(new URL("commercial-bootstrap.sql", import.meta.url), "utf8")
  ).replace("REEMPLAZAR_CORREO_VERIFICADO", "reserved@example.invalid"),
);
await actor(A);
check(await value("select public.bap_claim_admin_authorization()"), {
  claimed: false,
});
check((await value("select public.bap_my_access()")).is_admin, false);
await actor(C);
await denied("select public.bap_claim_admin_authorization()");
await db.exec("reset role");
await rows("update auth.users set email_confirmed_at=now() where id=$1", [C]);
await actor(C);
check(await value("select public.bap_claim_admin_authorization()"), {
  claimed: true,
});
check(await value("select public.bap_claim_admin_authorization()"), {
  claimed: false,
});
check((await value("select public.bap_my_access()")).admin_verified, false);
await denied("select public.bap_admin_list()");
await actor(C, "aal2");
check((await value("select public.bap_my_access()")).admin_verified, true);
await value("select public.bap_admin_list()");
check((await rows("select id from public.expenses")).length, 0);
await denied("update bap_private.admin_authorizations set revoked=false");
await db.exec("reset role");
check(
  await value(
    "select count(*)::int from public.bap_audit where action='admin_authorization_claimed'",
  ),
  1,
);
// An explicit account deletion consumes the authorization permanently.
await rows("delete from auth.users where id=$1", [C]);
await rows("insert into auth.users values($1,$2,now())", [
  D,
  "reserved@example.invalid",
]);
await actor(D);
check(await value("select public.bap_claim_admin_authorization()"), {
  claimed: false,
});
await actor(A);
await rows(
  "insert into public.finance_entries(id,user_id,kind,data) values('60000000-0000-4000-8000-000000000001',$1,'income',$2)",
  [
    A,
    JSON.stringify({
      name: "Income fixture",
      amount: 50,
      date: "2026-10-07",
      source: "Sueldo",
    }),
  ],
);
const fin = await value("select public.bap_pull_changes('finance')");
check(fin.rows.length, 1);
check(fin.rows[0].data.amount, 50);
check(
  (
    await value("select public.bap_pull_changes('finance',$1,$2)", [
      fin.cursor.version,
      fin.cursor.id,
    ])
  ).rows.length,
  0,
);
await db.exec("reset role");
await rows(
  "insert into auth.users values('10000000-0000-4000-8000-000000000005','expired@example.invalid',now()),('10000000-0000-4000-8000-000000000006','revoked@example.invalid',now())",
);
await rows(
  "insert into bap_private.admin_authorizations(email,expires_at,revoked) values('expired@example.invalid',now()-interval '1 day',false),('revoked@example.invalid',now()+interval '1 day',true)",
);
await actor("10000000-0000-4000-8000-000000000005");
check(await value("select public.bap_claim_admin_authorization()"), {
  claimed: false,
});
await actor("10000000-0000-4000-8000-000000000006");
check(await value("select public.bap_claim_admin_authorization()"), {
  claimed: false,
});
await db.exec("reset role");
await db.exec("update public.bap_commercial_settings set enforcement=true");
await actor(A);
check(
  (await value("select public.bap_pull_changes($1)", ["expenses"])).rows.length,
  5,
);
check(
  (
    await rows(
      "update public.expenses set merchant='Blocked' where id=$1 returning id",
      [downloaded[1].id],
    )
  ).length,
  0,
);
await db.close();
console.log(
  `Incremental sync and reserved admin: ${checks} checks passed (isolated PostgreSQL).`,
);

-- BAP Finanzas: ejecutar completo en SQL Editor. No modifica gastos existentes.
begin;
alter table public.expenses add column if not exists credit_id uuid;
create table if not exists public.finance_entries (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check (kind in ('income','debt','receivable','payment','disbursement','charge','settings')),
 data jsonb not null check (jsonb_typeof(data)='object' and octet_length(data::text)<=16000),
 updated_at timestamptz not null default now(),
 deleted boolean not null default false
);
create index if not exists finance_entries_user_idx on public.finance_entries(user_id);
alter table public.finance_entries enable row level security;
drop policy if exists finance_select_own on public.finance_entries;
create policy finance_select_own on public.finance_entries for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists finance_insert_own on public.finance_entries;
create policy finance_insert_own on public.finance_entries for insert to authenticated with check ((select auth.uid())=user_id);
drop policy if exists finance_update_own on public.finance_entries;
create policy finance_update_own on public.finance_entries for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
revoke all on public.finance_entries from anon, authenticated;
grant select, insert, update on public.finance_entries to authenticated;
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='finance_entries') then
 alter publication supabase_realtime add table public.finance_entries;
 end if;
end $$;
commit;

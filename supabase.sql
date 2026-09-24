-- Ejecutar una sola vez en SQL Editor del proyecto Supabase.
-- Cada fila pertenece a un usuario autenticado. Las fotos están comprimidas y guardadas como texto.
create table if not exists public.expenses (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  amount numeric(12,2) not null check (amount > 0),
  merchant text not null check (length(merchant) between 1 and 100),
  category text not null,
  payment text not null,
  note text not null default '',
  photo text not null default '',
  created timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
create index if not exists expenses_user_date_idx on public.expenses(user_id,date desc);
alter table public.expenses enable row level security;
create policy "Users can read own expenses" on public.expenses for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own expenses" on public.expenses for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own expenses" on public.expenses for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- Delete is represented by a tombstone to prevent offline devices from restoring deleted expenses.
grant select, insert, update on public.expenses to authenticated;
revoke all on public.expenses from anon;

-- Ejecutar en SQL Editor una sola vez para que Supabase Realtime emita los cambios.
-- RLS de expenses sigue controlando qué filas puede recibir cada cuenta.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'expenses'
  ) then
    alter publication supabase_realtime add table public.expenses;
  end if;
end $$;

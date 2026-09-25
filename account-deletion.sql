-- Ejecutar en el SQL Editor del proyecto Gastos.
-- Solo el usuario autenticado puede borrar su propia cuenta.
-- La FK expenses.user_id ON DELETE CASCADE borra sus gastos en la nube.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  own_id uuid := (select auth.uid());
begin
  if own_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  delete from auth.users where id = own_id;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

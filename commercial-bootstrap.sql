-- REQUIERE AUTORIZACIÓN EXPLÍCITA: asigna al titular el control comercial.
-- No autoriza leer los gastos/finanzas de otras personas.
-- Sustituir solo el correo, después de que el titular lo haya verificado en Auth.
begin;
do $$
declare owner_id uuid;
begin
 select id into owner_id from auth.users
 where lower(email)=lower('REEMPLAZAR_CORREO_VERIFICADO') and email_confirmed_at is not null;
 if owner_id is null then raise exception 'El titular debe verificar primero su correo en BAP'; end if;
 insert into public.bap_admins(user_id) values(owner_id) on conflict do nothing;
end $$;
commit;
-- La cuenta necesita segundo factor TOTP (MFA) para administrar planes/clientes.
-- El control obligatorio se activa desde el panel, después de aprobar al titular
-- y revisar el impacto sobre los usuarios actuales. No activarlo en SQL a ciegas.

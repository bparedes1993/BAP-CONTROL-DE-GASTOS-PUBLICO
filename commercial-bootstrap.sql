-- REQUIERE AUTORIZACIÓN DEL TITULAR para este correo y rol comercial.
-- Ejecutar después de commercial.sql y admin-authorizations.sql.
-- No crea usuarios ni confirma correos. No permite leer finanzas de otras personas.
begin;
do $$
declare address text := lower(btrim('REEMPLAZAR_CORREO_VERIFICADO')); owner_id uuid;
begin
 if address='reemplazar_correo_verificado' or address !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' or length(address)>254 then
  raise exception 'Indicar el correo autorizado';
 end if;
 insert into bap_private.admin_authorizations(email) values(address)
 on conflict(email) do update set approved_at=now(),expires_at=now()+interval '30 days',
 claimed_at=null,claimed_by=null,revoked=false;
 select id into owner_id from auth.users where lower(email)=address and email_confirmed_at is not null;
 if owner_id is not null then
  insert into public.bap_admins(user_id) values(owner_id) on conflict do nothing;
  update bap_private.admin_authorizations set claimed_at=now(),claimed_by=owner_id where email=address;
 end if;
 insert into public.bap_audit(id,actor_id,user_id,action,detail)
 values(gen_random_uuid(),null,owner_id,'admin_authorization_approved',jsonb_build_object('role','commercial','verified_account',owner_id is not null));
end $$;
commit;
-- Si el correo aún no tiene cuenta verificada, la autorización dura 30 días.
-- Al verificar el correo e iniciar sesión, BAP reclama el rol una sola vez.
-- Administrar clientes/planes/pagos sigue exigiendo segundo factor TOTP (aal2).
-- Borrar una cuenta no permite reclamar de nuevo la misma autorización consumida.
-- El control obligatorio se activa desde el panel después de revisar usuarios actuales.

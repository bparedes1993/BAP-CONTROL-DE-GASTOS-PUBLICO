-- Ejecutar solo por petición expresa del titular de exigir planes vigentes.
-- Conserva lectura/exportación propia; no concede accesos ni registra pagos.
begin;
do $$ begin
 if exists(select 1 from public.bap_commercial_settings where id and not enforcement) then
  update public.bap_commercial_settings set enforcement=true,updated_at=now() where id;
  insert into public.bap_audit(id,actor_id,action,detail)
  values(gen_random_uuid(),null,'enforcement',jsonb_build_object('enabled',true,'source','owner_requested_launch'));
 end if;
end $$;
commit;

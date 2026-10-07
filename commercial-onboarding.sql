-- Después de commercial.sql. Registra cuentas verificadas sin conceder planes.
begin;
alter table public.bap_access add column if not exists last_seen_at timestamptz;
create index if not exists bap_access_last_seen_idx on public.bap_access(last_seen_at desc,user_id);

create or replace function public.bap_register_customer()
returns void language plpgsql security definer set search_path=''
as $$ declare u uuid := bap_private.require_user(); inserted_id uuid; begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,417));
 insert into public.bap_access(user_id,last_seen_at) values(u,now())
 on conflict(user_id) do nothing returning user_id into inserted_id;
 if inserted_id is not null then
  insert into public.bap_audit(id,actor_id,user_id,action,detail)
  values(gen_random_uuid(),u,u,'account_registered',jsonb_build_object('status','pending'));
 else
  update public.bap_access set last_seen_at=now()
  where user_id=u and (last_seen_at is null or last_seen_at<now()-interval '15 minutes');
 end if;
end $$;

create or replace function public.bap_request_access(p_plan text)
returns jsonb language plpgsql security definer set search_path=''
as $$ declare u uuid := bap_private.require_user(); a public.bap_access; begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,417));
 if not exists(select 1 from public.bap_plans where id=p_plan and published) then raise exception 'Plan no disponible'; end if;
 select * into a from public.bap_access where user_id=u for update;
 if a.status='suspended' or a.status='rejected' then raise exception 'Contacta al soporte para revisar tu solicitud'; end if;
 if a.status='active' and a.ends_at>now() then raise exception 'Tu acceso sigue vigente; contacta al soporte para renovar'; end if;
 if a.requested_plan is not null and a.requested_at>now()-interval '10 minutes' then raise exception 'Ya recibimos tu solicitud; espera antes de actualizarla'; end if;
 insert into public.bap_access(user_id,requested_plan,status,last_seen_at) values(u,p_plan,'pending',now())
 on conflict(user_id) do update set requested_plan=p_plan,status='pending',requested_at=now(),updated_at=now();
 insert into public.bap_audit(id,actor_id,user_id,action,detail) values(gen_random_uuid(),u,u,'request',jsonb_build_object('plan',p_plan));
 return public.bap_my_access();
end $$;

create or replace function public.bap_admin_list(p_offset integer default 0,p_search text default '')
returns jsonb language plpgsql stable security definer set search_path=''
as $$ declare actor uuid := bap_private.require_admin(); begin
 if p_offset is null or p_offset<0 or p_offset>100000 or p_search is null or length(p_search)>100 then raise exception 'Consulta inválida'; end if;
 return jsonb_build_object('customers',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (
 select a.*,u.email,case when a.status='active' and a.ends_at<=now() then 'expired' else a.status end effective_status
 from public.bap_access a join auth.users u on u.id=a.user_id
 where u.email_confirmed_at is not null and u.email ilike '%' || replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_') || '%' escape '\'
 order by a.last_seen_at desc nulls last,a.requested_at desc,a.user_id limit 50 offset p_offset) q),
 'summary',(select jsonb_build_object('total',count(*),'pending',count(*) filter(where a.status='pending'),
 'active',count(*) filter(where a.status='active' and a.starts_at<=now() and a.ends_at>now()),
 'expired',count(*) filter(where a.status='active' and a.ends_at<=now()),
 'suspended',count(*) filter(where a.status='suspended'),
 'payments_pen',coalesce((select sum(amount_pen) from public.bap_payments),0))
 from public.bap_access a join auth.users u on u.id=a.user_id where u.email_confirmed_at is not null),
 'plans',(select coalesce(jsonb_agg(to_jsonb(p) order by p.days),'[]') from public.bap_plans p),
 'enforcement',(select enforcement from public.bap_commercial_settings where id),
 'audit',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select action,detail,created_at from public.bap_audit order by created_at desc limit 30) q));
end $$;
revoke all on function public.bap_register_customer(),public.bap_request_access(text),public.bap_admin_list(integer,text) from public,anon,authenticated;
grant execute on function public.bap_register_customer(),public.bap_request_access(text),public.bap_admin_list(integer,text) to authenticated;
commit;
